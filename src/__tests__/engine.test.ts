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

  it('应该能提取代码骨架并隐藏具体逻辑', () => {
    const skeleton = engine.getSkeleton('math.ts');

    // 应该包含接口定义
    expect(skeleton).toContain('interface Result');
    // 应该包含注释或标记表示逻辑已隐藏
    expect(skeleton).toContain('/* skeleton */');
    // 不应该包含具体的实现细节（取决于你 getSkeleton 的正则或 AST 逻辑）
    // 注意：如果是简单的 getSkeleton 实现，可能需要根据你实际代码调整断言
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
});