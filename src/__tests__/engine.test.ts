import { describe, it, expect, beforeEach } from 'vitest';
import { PromptEngine } from '../engine';
import * as path from 'path';
import * as fs from 'fs';

describe('PromptEngine Core Logic', () => {
  const fixtureDir = path.resolve(__dirname, './fixtures');
  let engine: PromptEngine;

  beforeEach(() => {
    // 确保测试前 fixture 目录存在 tsconfig
    const tsconfig = {
      compilerOptions: { target: "esnext", module: "commonjs", esModuleInterop: true }
    };
    fs.writeFileSync(path.join(fixtureDir, 'tsconfig.json'), JSON.stringify(tsconfig));

    engine = new PromptEngine(fixtureDir);
  });

  it('应该能生成正确的 RepoMap', () => {
    const repoMap = engine.getRepoMap();

    // 验证是否包含了我们的 fixture 文件
    expect(repoMap).toContain('math.ts');
    expect(repoMap).toContain('app.ts');

    // 验证是否提取到了导出符号
    expect(repoMap).toContain('add');
    expect(repoMap).toContain('Result');
    expect(repoMap).toContain('run');
  });

  it('当文件不存在时应返回错误提示', () => {
    const result = engine.getSkeleton('not-exist.ts');
    expect(result).toBe('File not found');
  });

  it('应该能解析 tsconfig 中的路径别名', () => {
    // 1. 设置带 alias 的 tsconfig
    const tsconfig = {
      compilerOptions: {
        baseUrl: ".",
        paths: { "@/*": ["src/*"] }
      }
    };
    fs.writeFileSync(path.join(fixtureDir, 'tsconfig.json'), JSON.stringify(tsconfig));

    // 2. 创建目录和文件
    const srcDir = path.join(fixtureDir, 'src');
    if (!fs.existsSync(srcDir)) fs.mkdirSync(srcDir);

    fs.writeFileSync(path.join(srcDir, 'utils.ts'), 'export const tool = 1;');
    fs.writeFileSync(path.join(fixtureDir, 'app2.ts'), "// @ts-ignore\nimport { tool } from '@/utils';");

    engine.refresh();

    // 3. 验证 getDeps
    const deps = engine.getDeps('app2.ts');

    // 验证是否成功解析了别名
    expect(deps).toContain('@/utils');
    expect(deps).toContain('src/utils.ts'); // 验证 resolved 路径
  });

  it('应该能提取代码骨架并隐藏具体逻辑', () => {
    const skeleton = engine.getSkeleton('math.ts');

    // 1. 验证关键定义是否被保留
    expect(skeleton).toContain('interface Result');
    expect(skeleton).toContain('const add');

    // 2. 验证隐藏标记 (使用正则同时匹配你代码中定义的两种新标记)
    const hiddenPattern = /\/\* implementation hidden \*\/|\/\/ variable export/;
    expect(skeleton).toMatch(hiddenPattern);

    // 3. 确保具体的逻辑代码 (a + b) 没有泄露
    expect(skeleton).not.toContain('a + b');
  });

  it('应该能提取类（Class）的成员签名并隐藏方法体', () => {
    // 1. 准备包含复杂类结构的测试文件
    const classContent = `
      export class Calculator {
        private base: number = 0;
        
        constructor(val: number) {
          this.base = val;
        }

        public add(x: number): number {
          const result = this.base + x;
          return result;
        }

        private clear() {
          this.base = 0;
        }
      }
    `;
    const testFilePath = path.join(fixtureDir, 'class-test.ts');
    fs.writeFileSync(testFilePath, classContent);

    // 2. 刷新引擎以感知新文件
    engine.refresh();

    // 3. 执行提取
    const skeleton = engine.getSkeleton('class-test.ts');

    // --- 断言验证 ---

    // A. 验证类声明头部是否正确保留
    expect(skeleton).toContain('export class Calculator {');

    // B. 验证构造函数签名是否被提取 (注意由于代码逻辑，前面会有 2 个空格缩进)
    expect(skeleton).toContain('  constructor(val: number); // implementation hidden');

    // C. 验证带返回类型的公有方法签名
    expect(skeleton).toContain('  public add(x: number): number; // implementation hidden');

    // D. 验证私有方法签名
    expect(skeleton).toContain('  private clear(); // implementation hidden');

    // E. 验证安全性：内部逻辑（实现细节）必须被隐藏
    expect(skeleton).not.toContain('this.base = val');
    expect(skeleton).not.toContain('const result = this.base + x');
    expect(skeleton).not.toContain('return result');

    // F. 验证类的大括号结构是否闭合
    // F. 验证类的大括号结构是否闭合 (匹配以 } 结尾，忽略末尾换行)
    expect(skeleton.trim()).toMatch(/\}$/);
  });

  it('当提取包含重导出的文件时，应识别 re-export 标记', () => {
    const indexPath = path.join(fixtureDir, 'index.ts');
    fs.writeFileSync(indexPath, "export * from './math';\nexport { run } from './app';");

    engine.refresh();
    const skeleton = engine.getSkeleton('index.ts');

    expect(skeleton).toContain("export * from './math'; // re-export");
    expect(skeleton).toContain("export { run } from './app'; // re-export");
  });
});