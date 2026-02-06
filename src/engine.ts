import ts from "typescript";
import * as path from "path";
import * as fs from "fs";

export class PromptEngine {
  private program!: ts.Program;
  private checker!: ts.TypeChecker;
  private rootDir: string;

  constructor(targetDir: string) {
    this.rootDir = path.resolve(targetDir);
    this.refresh();
  }

  public getRootDir() { return this.rootDir; }

  refresh() {
    const configPath = ts.findConfigFile(this.rootDir, ts.sys.fileExists, "tsconfig.json");
    let fileNames: string[] = [];
    let options: ts.CompilerOptions = {};

    if (configPath) {
      const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
      const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(configPath));
      fileNames = parsed.fileNames;
      options = parsed.options;
    } else {
      fileNames = this.getFilesRecursive(this.rootDir);
      options = {
        allowJs: true,
        checkJs: false,
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        rootDir: this.rootDir,
      };
    }

    this.program = ts.createProgram(fileNames, options);
    this.checker = this.program.getTypeChecker();
  }

  private getFilesRecursive(dir: string, allFiles: string[] = []): string[] {
    const ignoreDirs = ['node_modules', '.git', 'dist', 'build'];
    if (!fs.existsSync(dir)) return allFiles;
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      if (fs.statSync(fullPath).isDirectory()) {
        if (ignoreDirs.includes(file)) continue;
        this.getFilesRecursive(fullPath, allFiles);
      } else if (/\.(js|jsx|ts|tsx|mjs)$/.test(file)) {
        allFiles.push(fullPath);
      }
    }
    return allFiles;
  }

  /**
   * 核心修复：提取完整实现，包括变量导出的外层语句
   */
  public getMethodImplementation(filePath: string, methodName: string): string {
    const fullPath = path.resolve(this.rootDir, filePath);
    const sf = this.program.getSourceFile(fullPath);
    if (!sf) return "File not found";

    let result = "";
    const visit = (node: ts.Node) => {
      if (result) return;

      if (
        ts.isFunctionDeclaration(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isConstructorDeclaration(node) ||
        ts.isVariableDeclaration(node)
      ) {
        const nodeName = node.name?.getText();
        if (nodeName === methodName) {
          try {
            // 如果是变量声明 (const x = ...)，我们需要拿到它的父级 VariableStatement
            // 这样才能包含 'export const' 这部分文本
            if (ts.isVariableDeclaration(node) && node.parent && node.parent.parent && ts.isVariableStatement(node.parent.parent)) {
              result = node.parent.parent.getText();
            } else {
              result = node.getText();
            }
          } catch (e) {
            result = node.getText();
          }
          return;
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(sf);
    return result || `Definition for '${methodName}' not found in ${filePath}`;
  }

  public getDeps(filePath: string) {
    const fullPath = path.resolve(this.rootDir, filePath);
    const sf = this.program.getSourceFile(fullPath);
    if (!sf) return "File not found";

    const dependencies: string[] = [];
    const options = this.program.getCompilerOptions();
    const host = ts.createCompilerHost(options);

    ts.forEachChild(sf, node => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const rawPath = node.moduleSpecifier.text;
        const resolved = ts.resolveModuleName(rawPath, fullPath, options, host);
        const resolvedPath = resolved.resolvedModule
          ? path.relative(this.rootDir, resolved.resolvedModule.resolvedFileName)
          : "External/Built-in";
        dependencies.push(`- ${rawPath} -> ${resolvedPath}`);
      }
    });
    return dependencies.length ? dependencies.join("\n") : "No local dependencies found.";
  }

  public getSkeleton(filePath: string): string {
    const fullPath = path.resolve(this.rootDir, filePath);
    const sf = this.program.getSourceFile(fullPath);
    if (!sf) return "File not found";

    let output = `// Skeleton for ${filePath}\n`;
    const visit = (node: ts.Node, depth = 0) => {
      const indent = "  ".repeat(depth);
      const getText = (n: ts.Node) => { try { return n.getText(); } catch { return ""; } };

      if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
        output += `${indent}${getText(node).split('{')[0].trim()} { /* hidden */ }\n`;
      } else if (ts.isClassDeclaration(node)) {
        output += `${indent}${getText(node).split('{')[0].trim()} {\n`;
        ts.forEachChild(node, (child) => visit(child, depth + 1));
        output += `${indent}}\n`;
      } else if (ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isConstructorDeclaration(node)) {
        const isExported = node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
        const isClassMember = ts.isClassElement(node);
        if (isExported || isClassMember) {
          const signature = getText(node).split('{')[0].trim();
          output += `${indent}${signature}; // implementation hidden\n`;
        }
      } else if (ts.isVariableStatement(node)) {
        const isExported = node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
        if (isExported) {
          node.declarationList.declarations.forEach(decl => {
            output += `${indent}export const ${decl.name.getText()}; // variable export\n`;
          });
        }
      } else if (ts.isExportDeclaration(node)) {
        const text = getText(node).replace(/;$/, '');
        if (text) output += `${indent}${text}; // re-export\n`;
      } else {
        ts.forEachChild(node, (child) => visit(child, depth));
      }
    };
    visit(sf);
    return output;
  }

  public getRepoMap() {
    const files = this.program.getSourceFiles()
      .filter(f => !f.isDeclarationFile && !f.fileName.includes("node_modules"));
    return files.map(sf => {
      const relPath = path.relative(this.rootDir, sf.fileName);
      const symbol = this.checker.getSymbolAtLocation(sf);
      let exports: string[] = [];
      if (symbol) exports = this.checker.getExportsOfModule(symbol).map(s => s.getName());
      return `[${relPath}]: ${exports.join(", ") || "none"}`;
    }).join("\n");
  }
}