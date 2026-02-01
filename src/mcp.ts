import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { PromptEngine } from "./engine.js";
import * as path from "path";
import * as fs from "fs";

/**
 * 路径安全检查辅助函数
 */
function getSafePath(rootDir: string, relativePath: string): string {
  const absolutePath = path.resolve(rootDir, relativePath);
  if (!absolutePath.startsWith(rootDir)) {
    throw new Error(`Security Alert: Path traversal detected. Access denied for ${relativePath}`);
  }
  return absolutePath;
}

// 1. 确定根目录：优先从环境变量读取，适合 MCP 托管环境
const projectRoot = path.resolve(process.env.PROJECT_ROOT || process.cwd());
const engine = new PromptEngine(projectRoot);

const server = new McpServer({
  name: "ts-architect",
  version: "1.1.0"
});

// --- 修复后的工具注册逻辑 ---

// 工具 1: 项目地图
server.registerTool(
  "get_repo_map",
  {
    description: "获取项目全局文件结构及导出清单 (RepoMap)",
    inputSchema: z.object({}) // 即使没有参数，也建议显式定义空对象
  },
  async () => {
    engine.refresh();
    return { content: [{ type: "text", text: engine.getRepoMap() }] };
  }
);

// 工具 2: 依赖追踪
server.registerTool(
  "analyze_deps",
  {
    description: "分析指定文件的依赖关系，支持 tsconfig 路径别名解析",
    inputSchema: z.object({
      filePath: z.string().describe("相对于根目录的文件路径 (如 src/app.ts)")
    })
  },
  async ({ filePath }) => ({
    content: [{ type: "text", text: engine.getDeps(filePath) }]
  })
);

// 工具 3: 提取骨架
server.registerTool(
  "read_skeleton",
  {
    description: "提取文件的结构定义（接口、类型、导出签名），忽略具体实现细节以节省 Token",
    inputSchema: z.object({
      filePath: z.string().describe("文件相对路径")
    })
  },
  async ({ filePath }) => ({
    content: [{ type: "text", text: engine.getSkeleton(filePath) }]
  })
);

// 工具 4: 读取全文
server.registerTool(
  "read_full_code",
  {
    description: "读取文件的完整源代码。仅在需要了解具体逻辑或进行代码修改时调用",
    inputSchema: z.object({
      filePath: z.string().describe("文件相对路径")
    })
  },
  async ({ filePath }) => {
    try {
      const safePath = getSafePath(engine.getRootDir(), filePath);
      const content = fs.readFileSync(safePath, "utf-8");
      return { content: [{ type: "text", text: content }] };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Error reading file: ${error.message}` }],
        isError: true
      };
    }
  }
);
// 3. 建立连接
const transport = new StdioServerTransport();
server.connect(transport);