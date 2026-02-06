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

  // --- 核心修复 1: 恢复 getDeps 并支持路径别名解析 ---
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

  // --- 核心修复 2: 完善 getSkeleton 处理 Class 和 Variable ---
  public getSkeleton(filePath: string): string {
    const fullPath = path.resolve(this.rootDir, filePath);
    const sf = this.program.getSourceFile(fullPath);
    if (!sf) return "File not found";

    let output = `// Skeleton for ${filePath}\n`;

    const visit = (node: ts.Node, depth = 0) => {
      const indent = "  ".repeat(depth);
      const getText = (n: ts.Node) => { try { return n.getText(); } catch { return ""; } };

      // 1. 处理 接口和类型 (直接隐藏)
      if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
        output += `${indent}${getText(node).split('{')[0].trim()} { /* hidden */ }\n`;
      }
      // 2. 处理 类 (展开成员但隐藏方法体)
      else if (ts.isClassDeclaration(node)) {
        output += `${indent}${getText(node).split('{')[0].trim()} {\n`;
        ts.forEachChild(node, (child) => visit(child, depth + 1));
        output += `${indent}}\n`;
      }
      // 3. 处理 函数/方法声明
      else if (ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isConstructorDeclaration(node)) {
        const isExported = node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
        const isClassMember = ts.isClassElement(node);

        if (isExported || isClassMember) {
          const signature = getText(node).split('{')[0].trim();
          output += `${indent}${signature}; // implementation hidden\n`;
        }
      }
      // 4. 处理 变量导出 (修正测试失败点: expect 'const add')
      else if (ts.isVariableStatement(node)) {
        const isExported = node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
        if (isExported) {
          node.declarationList.declarations.forEach(decl => {
            const name = decl.name.getText();
            output += `${indent}export const ${name}; // variable export\n`;
          });
        }
      }
      // 5. 处理 重导出 (修正测试失败点: re-export)
      else if (ts.isExportDeclaration(node)) {
        const text = getText(node).replace(/;$/, '');
        if (text) output += `${indent}${text}; // re-export\n`;
      }
      else {
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