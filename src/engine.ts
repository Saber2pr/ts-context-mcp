
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

  /**
   * 提取代码骨架 (Skeleton)
   * 核心逻辑：保留声明签名（Interface, Class, Function, Variable），隐藏大括号内的具体实现。
   */
  public getSkeleton(filePath: string): string {
    const fullPath = path.resolve(this.rootDir, filePath);
    const sf = this.program.getSourceFile(fullPath);
    if (!sf) return "File not found";

    let output = `// Skeleton for ${filePath}\n`;

    const visit = (node: ts.Node) => {
      // 1. 处理 接口 (Interface) 和 类型别名 (Type Alias)
      if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
        const header = node.getText().split('{')[0].trim();
        output += `${header} { /* implementation hidden */ }\n`;
      }

      // 2. 处理 类 (Class)
      // 注意：这里不直接截断，而是保留类头并递归访问内部成员
      else if (ts.isClassDeclaration(node)) {
        const header = node.getText().split('{')[0].trim();
        output += `${header} {\n`;
        ts.forEachChild(node, visit); // 递归处理内部的构造函数、方法等
        output += `}\n`;
      }

      // 3. 处理 类成员 (方法、构造函数) 或 导出的独立函数
      else if (
        (ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node) || ts.isFunctionDeclaration(node)) &&
        (node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) || ts.isClassElement(node))
      ) {
        const signature = node.getText().split('{')[0].trim();
        // 如果是在类内部，增加缩进
        const indent = ts.isClassElement(node) ? "  " : "";
        output += `${indent}${signature}; // implementation hidden\n`;
      }

      // 4. 处理 变量导出 (export const/let ...)
      else if (ts.isVariableStatement(node) && node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
        node.declarationList.declarations.forEach(decl => {
          const name = decl.name.getText();
          const type = decl.type ? `: ${decl.type.getText()}` : "";
          output += `export const ${name}${type}; // variable export\n`;
        });
      }

      // 5. 处理 重导出 (export * from ... / export { x } from ...)
      else if (ts.isExportDeclaration(node)) {
        const text = node.getText().replace(/;$/, ''); // 安全起见，去掉自带的分号再统一处理
        output += `${text}; // re-export\n`;
      }

      // 6. 兜底逻辑：对于其他节点类型（如模块、命名空间），继续向下寻找
      else {
        ts.forEachChild(node, visit);
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

  /**
   * 精准获取某个类的方法或函数的完整实现
   */
  public getMethodImplementation(filePath: string, methodName: string): string {
    const fullPath = path.resolve(this.rootDir, filePath);
    const sf = this.program.getSourceFile(fullPath);
    if (!sf) return "File not found";

    let result = "";

    const visit = (node: ts.Node) => {
      if (
        (ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isConstructorDeclaration(node)) &&
        node.name?.getText() === methodName
      ) {
        result = node.getText(); // 获取包含方法体在内的完整代码
        return;
      }
      ts.forEachChild(node, visit);
    };

    visit(sf);
    return result || `Method '${methodName}' not found in ${filePath}`;
  }
}
