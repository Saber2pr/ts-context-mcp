import ts from 'typescript/lib/typescript';
import * as path from 'path';
import * as fs from 'fs';

export class PromptEngine {
  private program?: ts.Program;
  private checker?: ts.TypeChecker;
  private rootDir: string;

  constructor(targetDir: string) {
    try {
      this.rootDir = targetDir ? path.resolve(targetDir) : process.cwd();
      if (!fs.existsSync(this.rootDir)) {
        this.rootDir = process.cwd();
      }
    } catch {
      this.rootDir = '/';
    }
    this.refresh();
  }

  getRootDir() {
    return this.rootDir;
  }
  refresh() {
    try {
      // 必须在每次 refresh 时重新寻找配置文件，以获取测试脚本动态写入的 paths
      const configPath = ts.findConfigFile(this.rootDir, ts.sys.fileExists, 'tsconfig.json');

      let options: ts.CompilerOptions = {
        allowJs: true,
        checkJs: false,
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        rootDir: this.rootDir,
        skipLibCheck: true,
        noEmit: true
      };

      let fileNames: string[] = [];

      if (configPath) {
        const configContent = ts.readConfigFile(configPath, ts.sys.readFile);
        const parsedConfig = ts.parseJsonConfigFileContent(
          configContent.config,
          ts.sys,
          path.dirname(configPath)
        );
        options = parsedConfig.options;
        fileNames = parsedConfig.fileNames;
      } else {
        fileNames = this.getFilesRecursive(this.rootDir);
      }

      this.program = ts.createProgram(fileNames, options);
      this.checker = this.program.getTypeChecker();
    } catch (err) {
      console.error('[PromptEngine] Refresh failed:', err);
    }
  }

  private getFilesRecursive(dir: string, allFiles: string[] = [], depth = 0): string[] {
    const MAX_DEPTH = 10;
    const ignoreDirs = ['node_modules', '.git', 'dist', 'build', '.vscode'];
    if (depth > MAX_DEPTH) return allFiles;
    try {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        if (ignoreDirs.includes(file)) continue;
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          this.getFilesRecursive(fullPath, allFiles, depth + 1);
        } else if (/\.(js|jsx|ts|tsx)$/.test(file)) {
          allFiles.push(fullPath);
        }
      }
    } catch { }
    return allFiles;
  }

  // 修复 1: 补全测试要求的 getRepoMap 方法
  getRepoMap(): string {
    if (!this.program || !this.checker) return "Program not initialized";
    const files = this.program.getSourceFiles().filter(f => !f.isDeclarationFile && !f.fileName.includes('node_modules'));
    return files.map(sf => {
      const relPath = path.relative(this.rootDir, sf.fileName);
      const symbol = this.checker!.getSymbolAtLocation(sf);
      let exports: string[] = [];
      if (symbol) exports = this.checker!.getExportsOfModule(symbol).map(s => s.getName());
      return `[${relPath}]: ${exports.join(', ') || 'none'}`;
    }).join('\n');
  }

  // 修复 2: 统一错误提示文本以符合测试断言
  getMethodImplementation(filePath: string, methodName: string): string {
    const fullPath = path.resolve(this.rootDir, filePath);
    if (!fs.existsSync(fullPath)) return `File not found`;

    try {
      const sf = this.program?.getSourceFile(fullPath);
      if (sf) {
        let result = '';
        const visit = (node: ts.Node) => {
          if (result) return;
          if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node) || ts.isVariableDeclaration(node)) && node.name?.getText() === methodName) {
            if (ts.isVariableDeclaration(node) && node.parent?.parent && ts.isVariableStatement(node.parent.parent)) {
              result = node.parent.parent.getText();
            } else {
              result = node.getText();
            }
            return;
          }
          ts.forEachChild(node, visit);
        };
        visit(sf);
        if (result) return result;
      }
      // 保持测试要求的返回格式
      return `Definition for '${methodName}' not found in ${filePath}`;
    } catch {
      return `Definition for '${methodName}' not found in ${filePath}`;
    }
  }

  getDeps(filePath: string): string {
    const fullPath = path.resolve(this.rootDir, filePath);
    const sf = this.program?.getSourceFile(fullPath);
    if (!sf) return "File not found";

    const dependencies: string[] = [];
    const options = this.program!.getCompilerOptions();

    // 关键修复：创建一个能够感知测试环境物理路径的 Host
    const moduleResolutionHost: ts.ModuleResolutionHost = {
      fileExists: ts.sys.fileExists,
      readFile: ts.sys.readFile,
      realpath: ts.sys.realpath,
      directoryExists: ts.sys.directoryExists,
      getCurrentDirectory: () => this.rootDir, // 强制锁定为当前项目根目录
      getDirectories: ts.sys.getDirectories,
    };

    ts.forEachChild(sf, node => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {

        const rawPath = node.moduleSpecifier.text;

        // 执行路径解析
        const resolved = ts.resolveModuleName(
          rawPath,
          fullPath,
          options,
          moduleResolutionHost
        );

        if (resolved.resolvedModule) {
          // 获取相对于 rootDir 的相对路径
          let relResolved = path.relative(this.rootDir, resolved.resolvedModule.resolvedFileName);

          // 路径标准化：
          // 1. 统一分隔符为 '/' (处理 Windows)
          // 2. 移除 './' 前缀 (保持一致性)
          const normalizedPath = relResolved.split(path.sep).join('/').replace(/^\.\//, '');

          dependencies.push(`- ${rawPath} -> ${normalizedPath}`);
        } else {
          dependencies.push(`- ${rawPath} -> External Library`);
        }
      }
    });
    return dependencies.length ? dependencies.join('\n') : 'No local dependencies found.';
  }

  // 修复 3: 优化骨架提取逻辑，保留 export 关键字和 re-export 标记
  getSkeleton(filePath: string): string {
    const fullPath = path.resolve(this.rootDir, filePath);
    const sf = this.program?.getSourceFile(fullPath);
    if (!sf) return fs.existsSync(fullPath) ? `// Skeleton Error` : `File not found`;

    let output = `// Skeleton for ${filePath}\n`;
    const visit = (node: ts.Node, depth = 0) => {
      const indent = '  '.repeat(depth);
      const getText = (n: ts.Node) => n.getText();

      if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
        output += `${indent}${getText(node).split('{')[0].trim()} { /* ... */ }\n`;
      } else if (ts.isClassDeclaration(node)) {
        const modifiers = node.modifiers?.map(m => m.getText()).join(' ') || '';
        output += `${indent}${modifiers ? modifiers + ' ' : ''}class ${node.name?.getText() || 'Anonymous'} {\n`;
        ts.forEachChild(node, child => visit(child, depth + 1));
        output += `${indent}}\n`;
      } else if (ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isConstructorDeclaration(node)) {
        const signature = getText(node).split('{')[0].trim();
        output += `${indent}${signature}; // implementation hidden\n`;
      } else if (ts.isVariableStatement(node)) {
        // 修复测试：保留 export const add 这种变量导出
        const modifiers = node.modifiers?.map(m => m.getText()).join(' ') || '';
        if (modifiers.includes('export')) {
          node.declarationList.declarations.forEach(decl => {
            output += `${indent}${modifiers} const ${decl.name.getText()}; // variable export\n`;
          });
        }
      } else if (ts.isExportDeclaration(node)) {
        // 修复测试：识别并标记 re-export
        output += `${indent}${getText(node).replace(/;$/, '')}; // re-export\n`;
      } else {
        ts.forEachChild(node, child => visit(child, depth));
      }
    };
    visit(sf);
    return output;
  }
}