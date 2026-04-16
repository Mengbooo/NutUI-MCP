# NutUI React Taro MCP Server

MCP (Model Context Protocol) Server，为 AI Agent 提供 NutUI React Taro 3.x 组件文档查询能力。

## 功能

- 列出所有组件，支持按分类筛选
- 查询组件完整 Props 说明（含中文描述）
- 全文搜索组件及属性

## 组件数据

- 来源: `@nutui/nutui-react-taro@3.0.19-cpp.26-beta.5`
- 组件数: 88 个（来自 `types/spec` 目录，含中文 JSDoc）
- 分类: 基础组件、布局组件、导航组件、数据录入、操作反馈、数据展示、其他

## 快速开始

### 1. 克隆项目

```bash
git clone https://github.com/Mengbooo/NutUI-MCP.git
cd NutUI-MCP
```

### 2. 安装依赖

```bash
npm install
```

### 3. 启动 MCP Server

```bash
npm run dev
```

看到类似输出表示启动成功：

```
MCP Server running on stdio
```

Server 会通过 stdin/stdout 通信，保持运行不要关。

## 接入 Claude Code

### 步骤一：找到项目的 .mcp.json

在你使用 Claude Code 的项目目录下，编辑 `.mcp.json` 文件。例如项目在 `/Users/qiumengbo.123/Desktop/embodio-fe/embodio-fe/`，则编辑：

```
/Users/qiumengbo.123/Desktop/embodio-fe/embodio-fe/.mcp.json
```

### 步骤二：添加 nutui 配置

```json
{
  "mcpServers": {
    "nutui": {
      "command": "/Users/qiumengbo.123/Desktop/NutUI-MCP/node_modules/.bin/tsx",
      "args": [
        "/Users/qiumengbo.123/Desktop/NutUI-MCP/src/server.ts"
      ]
    }
  }
}
```

**注意：路径必须是绝对路径**，因为 Claude Code 启动 MCP Server 时的工作目录是你当前项目目录，而不是 NutUI-MCP 目录。用 `tsx` 的绝对路径可以确保正确加载。

### 步骤三：重启 Claude Code

配置完成后，重启 Claude Code（退出再重新进入），它会自动检测并连接 MCP Server。

## 验证是否正常工作

在 Claude Code 中发送以下消息测试：

```
列出所有组件
```

如果正常，会返回组件列表。如果返回错误，检查：
- `npm run dev` 是否在运行
- `.mcp.json` 中路径是否正确
- Claude Code 是否已重启

## MCP Tools

### list_components
列出所有组件，可按分类筛选。

```json
{ "category": "基础组件" }
```

### get_component_info
查询指定组件的完整 Props 信息。

```json
{ "name": "button" }
```

### search_components
全文搜索组件及属性。

```json
{ "query": "loading", "category": "数据录入", "limit": 5 }
```

## 数据更新

当 NutUI 发布新版本时：

```bash
npx tsx scripts/update-data.ts <版本号>
# 例如：npx tsx scripts/update-data.ts 3.0.20
```

脚本会自动下载新版本 npm 包、解析组件数据、更新 `components.json`。
