
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

  getSkeleton(filePath: string) {
    const sf = this.program.getSourceFile(path.resolve(this.rootDir, filePath));
    if (!sf) return "File not found";
    let output = "";
    ts.forEachChild(sf, node => {
      if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isClassDeclaration(node)) {
        output += node.getText().split('{')[0] + "{ /* skeleton */ }\n";
      }
    });
    return output || "Logic-only file";
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
}
