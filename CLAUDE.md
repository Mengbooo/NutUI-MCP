# NutUI React Taro MCP Server

AI Agent 工具，用于查询 NutUI React Taro 3.x 组件的文档和 Props 信息。

## 项目结构

- `src/server.ts` - MCP Server 实现（使用 @modelcontextprotocol/sdk）
- `components.json` - 组件元数据（从 npm 包 types/spec 目录自动生成）
- `package.json` - ESM 项目，TypeScript + tsx

## MCP Tools

| Tool | 说明 |
|------|------|
| `list_components` | 列出所有/指定分类的组件 |
| `get_component_info` | 查询组件 Props 详情 |
| `search_components` | 全文搜索组件和属性 |

## 关键约定

- 组件数据来自 `@nutui/nutui-react-taro@3.0.18` 的 `types/spec/*/base.d.ts` 文件
- 中文 JSDoc 描述是最重要的内容来源
- 文档 URL 模板: `https://nutui.jd.com/taro/react/3x/#/zh-CN/component/{name}`
- 组件按官方文档分类：基础组件、布局组件、导航组件、数据录入、操作反馈、数据展示

## 启动方式

```bash
npm run dev  # tsx watch 模式
npm start    # node 直接运行
```

## 数据更新流程

当 NutUI 更新版本时：
1. `npm pack @nutui/nutui-react-taro@<新版本>`
2. 解压 tarball
3. 从 `dist/es/types/spec/*/base.d.ts` 提取所有组件 JSDoc 和 props
4. 运行生成脚本更新 `components.json`
