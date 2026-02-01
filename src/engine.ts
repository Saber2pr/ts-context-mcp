
import ts from "typescript";
import * as path from "path";

// 保持我们硬核的 PromptEngine 逻辑不变
export class PromptEngine {
  private program!: ts.Program;
  private checker!: ts.TypeChecker;
  private rootDir: string;

  constructor(targetDir: string) {
    this.rootDir = path.resolve(targetDir);
    this.refresh();
  }

  public getRootDir() {
    return this.rootDir;
  }

  refresh() {
    const configPath = ts.findConfigFile(this.rootDir, ts.sys.fileExists, "tsconfig.json");
    if (!configPath) throw new Error("Missing tsconfig.json");
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(configPath));
    this.program = ts.createProgram(parsed.fileNames, parsed.options);
    this.checker = this.program.getTypeChecker();
  }

  public getRepoMap() {
    const files = this.program.getSourceFiles()
      .filter(f => !f.isDeclarationFile && !f.fileName.includes("node_modules"));

    return files.map(sf => {
      const relPath = path.relative(this.rootDir, sf.fileName);
      const moduleSymbol = this.checker.getSymbolAtLocation(sf);

      let exportNames: string[] = [];
      if (moduleSymbol) {
        // 使用 checker 提供的标准方法获取导出符号
        const exports = this.checker.getExportsOfModule(moduleSymbol);
        exportNames = exports.map(s => s.getName());
      }

      return `[${relPath}]: ${exportNames.join(", ") || "none"}`;
    }).join("\n");
  }

  // src/engine.ts

  public getSkeleton(filePath: string): string {
    const fullPath = path.resolve(this.rootDir, filePath);
    const sf = this.program.getSourceFile(fullPath);
    if (!sf) return "File not found";

    let output = `// Skeleton for ${filePath}\n`;

    const visit = (node: ts.Node) => {
      try {
        // 安全获取文本的辅助函数
        const getNodeText = (n: ts.Node) => {
          try { return n.getText(); } catch { return ""; }
        };

        // 1. 处理 接口 和 类型别名
        if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
          const text = getNodeText(node);
          const header = text ? text.split('{')[0].trim() : "declaration";
          output += `${header} { /* implementation hidden */ }\n`;
        }

        // 2. 处理 类
        else if (ts.isClassDeclaration(node)) {
          const text = getNodeText(node);
          const header = text ? text.split('{')[0].trim() : "class";
          output += `${header} {\n`;
          ts.forEachChild(node, visit);
          output += `}\n`;
        }

        // 3. 处理 类成员或函数
        else if (
          (ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node) || ts.isFunctionDeclaration(node)) &&
          (node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) || ts.isClassElement(node))
        ) {
          const text = getNodeText(node);
          const signature = text ? text.split('{')[0].trim() : "method";
          const indent = ts.isClassElement(node) ? "  " : "";
          output += `${indent}${signature}; // implementation hidden\n`;
        }

        // 4. 处理 变量导出 (最容易出 undefined 的地方)
        else if (ts.isVariableStatement(node) && node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
          node.declarationList.declarations.forEach(decl => {
            // 增加对 decl.name 的安全检查
            const name = decl.name ? getNodeText(decl.name) : "unknown";
            const type = decl.type ? `: ${getNodeText(decl.type)}` : "";
            output += `export const ${name}${type}; // variable export\n`;
          });
        }

        // 5. 处理 重导出
        else if (ts.isExportDeclaration(node)) {
          const text = getNodeText(node);
          if (text) {
            const formatted = text.replace(/;$/, '');
            output += `${formatted}; // re-export\n`;
          }
        }

        // 6. 递归向下
        else {
          ts.forEachChild(node, visit);
        }
      } catch (e) {
        // 如果单个节点解析彻底失败，记录日志但不中断程序
        output += `// [Parser Error] skipped a node in ${filePath}\n`;
      }
    };

    visit(sf);
    return output || "// No structural definitions found.";
  }

  public getDeps(filePath: string) {
    const fullPath = path.resolve(this.rootDir, filePath);
    const sf = this.program.getSourceFile(fullPath);
    if (!sf) return "File not found";

    const dependencies: { raw: string; resolved: string | undefined }[] = [];

    // 获取编译器选项以进行路径解析
    const options = this.program.getCompilerOptions();
    const host = ts.createCompilerHost(options);

    ts.forEachChild(sf, node => {
      // 处理 import 和 export ... from 语句
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {

        const rawPath = node.moduleSpecifier.text;

        // 核心：解析模块路径 (处理 @/ 等别名)
        const resolved = ts.resolveModuleName(
          rawPath,
          fullPath,
          options,
          host
        );

        let resolvedPath = undefined;
        if (resolved.resolvedModule) {
          // 转换为相对于根目录的路径，方便 AI 调用其他工具
          resolvedPath = path.relative(this.rootDir, resolved.resolvedModule.resolvedFileName);
        }

        dependencies.push({
          raw: rawPath,
          resolved: resolvedPath
        });
      }
    });

    // 格式化输出给 AI
    if (dependencies.length === 0) return "No local dependencies found.";

    return dependencies
      .map(d => `- ${d.raw} -> ${d.resolved || "External/Built-in"}`)
      .join("\n");
  }

  public getMethodImplementation(filePath: string, methodName: string): string {
    const fullPath = path.resolve(this.rootDir, filePath);
    const sf = this.program.getSourceFile(fullPath);
    if (!sf) return "File not found";

    let result = "";

    const visit = (node: ts.Node) => {
      if (result) return; // 找到后停止搜索

      // 检查是否为：函数声明、方法声明、构造函数、或者变量声明
      if (
        ts.isFunctionDeclaration(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isConstructorDeclaration(node) ||
        ts.isVariableDeclaration(node)
      ) {
        // 核心修复：安全地获取节点名称
        // 某些节点（如匿名函数导出）可能没有 name 属性
        const nodeName = node.name ? node.name.getText() : undefined;

        if (nodeName === methodName) {
          try {
            // 使用 getText() 时也增加 try-catch，防止底层偏移错误
            result = node.getText();
          } catch (e) {
            result = `// Error: Found '${methodName}' but could not retrieve source text.`;
          }
          return;
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(sf);
    return result || `Definition for '${methodName}' not found in ${filePath}`;
  }
}
