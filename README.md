# @saber2pr/ts-context-mcp

> **TypeScript-native MCP Server**: Leveraging AST (Abstract Syntax Tree) to generate high-efficiency AI context, dependency maps, and code skeletons, providing LLMs with precise large-scale codebase awareness.

## 🌟 Key Features

Powered by the **`PromptEngine`**, this tool transforms complex TypeScript code into structured information that is easy for AI to understand while being extremely token-efficient:

* **Intelligent RepoMap**: Scans the entire project to automatically extract export symbols from all files, helping AI quickly locate functional modules.
* **AST Code Skeleton (`read_skeleton`)**: Uses the TypeScript Compiler API to strip away implementation details, leaving only interfaces, class members, and method signatures. This saves **60%-90%** of token consumption compared to reading full source code.
* **Precise Method Extraction (`get_method_body`)**: Allows AI to fetch the full implementation of a specific method or function, avoiding the need to load massive files just to understand a single logic block.
* **Deep Dependency Analysis**: Native support for `tsconfig.json` path alias resolution (e.g., `@/*`), perfectly tracing complex internal references in large projects.

---

## 🛠 Installation & Configuration

### 1. Install Dependencies

```bash
yarn add @saber2pr/ts-context-mcp
# or
npm install @saber2pr/ts-context-mcp

```

### 2. Configure in MCP Clients (e.g., Claude Desktop / Cursor)

Add the following to your MCP configuration file (e.g., `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "ts-architect": {
      "command": "node",
      "args": ["/path/to/your/project/lib/mcp.js"],
      "env": {
        "PROJECT_ROOT": "/your/target/typescript/project"
      }
    }
  }
}

```

---

## 🧰 Available Tools

| Tool Name | Description | Parameters |
| --- | --- | --- |
| `get_repo_map` | Returns the global file structure and export list (RepoMap). | None |
| `read_skeleton` | Extracts structural definitions (interfaces, classes, signatures), hiding logic. | `filePath`: Relative path |
| `analyze_deps` | Analyzes file dependencies with `tsconfig` alias resolution support. | `filePath`: Relative path |
| `get_method_body` | Fetches the full implementation of a specific method or function. | `filePath`, `methodName` |
| `read_full_code` | Reads the full source code (use only when necessary). | `filePath`: Relative path |

---

## 📖 Example Workflow

1. **Global Awareness**: AI calls `get_repo_map` and finds that `src/services/user.ts` exports a `UserService` class.
2. **Structure Preview**: AI calls `read_skeleton` and sees a `updateEmail(id: string, email: string)` method without loading 500 lines of implementation.
3. **Deep Dive**: AI decides to modify the logic and calls `get_method_body` to fetch only the `updateEmail` source code, completing the refactor with minimal token cost.

---

## 🧪 Development & Testing

This project uses `vitest` for rigorous logic verification:

```bash
# Run unit tests
yarn test

# Developer mode (watch mode)
yarn start # Automatically executes tsc --watch

```

*Test cases cover RepoMap generation, path alias resolution, class member extraction, and implementation hiding.*

---

## 📄 License

[ISC License](https://www.google.com/search?q=LICENSE)