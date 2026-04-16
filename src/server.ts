import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const componentsData = JSON.parse(
  readFileSync(join(__dirname, "../components.json"), "utf-8")
);

interface Component {
  name: string;
  category: string;
  props: Prop[];
  docUrl: string;
}

interface Prop {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

// ─── Tool Definitions ────────────────────────────────────────────────

const TOOLS: Tool[] = [
  {
    name: "list_components",
    description:
      "列出 NutUI React Taro 3.x 所有组件，可按分类筛选。返回组件名称、中文分类名、文档链接。",
    inputSchema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          description: "可选，筛选特定分类：基础组件|布局组件|导航组件|数据录入|操作反馈|数据展示",
        },
      },
    },
  },
  {
    name: "get_component_info",
    description:
      "查询指定 NutUI 组件的详细信息，包括所有 Props（名称、类型、是否必填、中文描述）。",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "组件名称（英文），如 button、cell、dialog",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "search_components",
    description:
      "搜索 NutUI 组件，支持按组件名、属性名、描述全文搜索，返回匹配组件及其 Prop 匹配信息。",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "搜索关键词，可匹配组件名、Prop 名、Prop 类型或描述文本",
        },
        category: {
          type: "string",
          description: "可选，限定分类搜索",
        },
        limit: {
          type: "number",
          description: "最多返回结果数，默认 10",
        },
      },
      required: ["query"],
    },
  },
];

// ─── Tool Handlers ──────────────────────────────────────────────────

function listComponents(category?: string): string {
  let components = componentsData.components as Component[];

  if (category) {
    components = components.filter(
      (c) => c.category === category || c.category.includes(category)
    );
  }

  const grouped: Record<string, Component[]> = {};
  for (const comp of components) {
    if (!grouped[comp.category]) grouped[comp.category] = [];
    grouped[comp.category].push(comp);
  }

  const lines: string[] = [
    `NutUI React Taro 3.x 组件列表（共 ${components.length} 个）\n`,
  ];

  for (const [cat, comps] of Object.entries(grouped).sort()) {
    lines.push(`## ${cat} (${comps.length})`);
    for (const c of comps) {
      lines.push(
        `  - **${c.name}** | Props: ${c.props.length} | ${c.docUrl}`
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

function getComponentInfo(name: string): string {
  const comp = componentsData.components.find(
    (c: Component) =>
      c.name.toLowerCase() === name.toLowerCase() ||
      c.name.toLowerCase().includes(name.toLowerCase())
  ) as Component | undefined;

  if (!comp) {
    return `未找到组件: ${name}`;
  }

  const lines: string[] = [
    `## ${comp.name}`,
    `分类: ${comp.category}`,
    `文档: ${comp.docUrl}\n`,
    `Props (${comp.props.length}):\n`,
    "| 属性 | 类型 | 必填 | 说明 |",
    "|------|------|------|------|",
  ];

  for (const prop of comp.props) {
    const req = prop.required ? "是" : "否";
    const desc = prop.description || "-";
    lines.push(`| \`${prop.name}\` | \`${prop.type}\` | ${req} | ${desc} |`);
  }

  return lines.join("\n");
}

function searchComponents(
  query: string,
  category?: string,
  limit = 10
): string {
  const q = query.toLowerCase();
  let components = componentsData.components as Component[];

  if (category) {
    components = components.filter((c) =>
      c.category.includes(category)
    );
  }

  type Scored = { comp: Component; score: number; matchedProps: string[] };

  const results: Scored[] = [];

  for (const comp of components) {
    let score = 0;
    const matchedProps: string[] = [];

    if (comp.name.toLowerCase().includes(q)) score += 10;

    for (const prop of comp.props) {
      if (prop.name.toLowerCase().includes(q)) {
        score += 5;
        matchedProps.push(`prop:${prop.name}`);
      }
      if (prop.type.toLowerCase().includes(q)) {
        score += 3;
        matchedProps.push(`type:${prop.name}=${prop.type}`);
      }
      if (prop.description.toLowerCase().includes(q)) {
        score += 2;
        matchedProps.push(`desc:${prop.name}`);
      }
    }

    if (comp.category.toLowerCase().includes(q)) score += 5;

    if (score > 0) {
      results.push({ comp, score, matchedProps });
    }
  }

  results.sort((a, b) => b.score - a.score);
  const top = results.slice(0, limit);

  if (top.length === 0) {
    return `没有找到匹配 "${query}" 的组件`;
  }

  const lines: string[] = [
    `搜索 "${query}"，找到 ${top.length} 个结果：\n`,
  ];

  for (const { comp, score, matchedProps } of top) {
    lines.push(
      `## ${comp.name} [${comp.category}] (得分: ${score})`
    );
    lines.push(`文档: ${comp.docUrl}`);
    if (matchedProps.length > 0) {
      lines.push(`匹配: ${matchedProps.join(", ")}`);
    }
    lines.push(`Props数: ${comp.props.length}\n`);
  }

  return lines.join("\n");
}

// ─── Server Bootstrap ───────────────────────────────────────────────

const server = new Server(
  { name: "nutui-react-taro-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, () => {
  return { tools: TOOLS };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: string;

    switch (name) {
      case "list_components":
        result = listComponents(args?.category as string | undefined);
        break;
      case "get_component_info":
        if (!args?.name) {
          result = "错误: 缺少 name 参数";
        } else {
          result = getComponentInfo(args.name as string);
        }
        break;
      case "search_components":
        if (!args?.query) {
          result = "错误: 缺少 query 参数";
        } else {
          result = searchComponents(
            args.query as string,
            args.category as string | undefined,
            args.limit as number | undefined
          );
        }
        break;
      default:
        result = `未知工具: ${name}`;
    }

    return {
      content: [{ type: "text", text: result }],
    };
  } catch (err) {
    return {
      content: [{ type: "text", text: `Error: ${err}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
