# NutUI React Taro MCP Server

MCP (Model Context Protocol) Server，为 AI Agent 提供 NutUI React Taro 3.x 组件文档查询能力。

## 组件数据

- 来源: `@nutui/nutui-react-taro@3.0.19-cpp.26-beta.5`
- 组件数: 88 个（来自 `types/spec` 目录的 TypeScript 定义，含中文 JSDoc）
- 分类: 基础组件、布局组件、导航组件、数据录入、操作反馈、数据展示、其他

## MCP Tools

### `list_components`
列出所有组件，可按分类筛选。

```json
{ "category": "基础组件" }
```

### `get_component_info`
查询指定组件的完整 Props 信息。

```json
{ "name": "button" }
```

### `search_components`
全文搜索组件及属性。

```json
{ "query": "loading", "category": "数据录入", "limit": 5 }
```

## 单独运行（调试用）

```bash
cd /Users/qiumengbo.123/Desktop/NutUI-MCP
npm run dev    # tsx watch 模式
```

## 接入 Claude Code

在项目的 `.mcp.json` 按照安装位置中添加配置：

```json
{
  "mcpServers": {
    "nutui": {
    "command": "~/Desktop/NutUI-MCP/node_modules/.bin/tsx",
      "args": [
        "~/Desktop/NutUI-MCP/src/server.ts"
      ]
    }
  }
}
```

**注意：** 必须使用 `tsx` 二进制文件的**绝对路径**，而非 `node --import tsx`。原因是 Node.js 的 `--import` 会在**当前工作目录**（即 Claude Code 所在项目目录）下查找 `tsx` 模块，如果当前项目没有安装 tsx 就会报错。用绝对路径直接调用 `tsx` 可绕过模块解析。

配置完成后重启 Claude Code 即可自动连接。

## 数据更新

当 NutUI 发布新版本时：

```bash
cd /Users/qiumengbo.123/Desktop/NutUI-MCP
npx tsx scripts/update-data.ts <版本号>
# 例如：npx tsx scripts/update-data.ts 3.0.19-cpp.26-beta.5
```

脚本会自动下载新版本 npm 包、解析组件数据、更新 `components.json`。
