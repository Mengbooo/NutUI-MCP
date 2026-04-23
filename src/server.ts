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

// ─── Helpers ────────────────────────────────────────────────────────

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
const componentsData = JSON.parse(
  readFileSync(join(__dirname, "../components.json"), "utf-8")
);
const relationshipsData: Record<string, {
  label: string;
  description: string;
  related: string[];
  commonPatterns?: string[];
}> = JSON.parse(
  readFileSync(join(__dirname, "./data/relationships.json"), "utf-8")
);
const usageGuidanceData: Record<string, string> = JSON.parse(
  readFileSync(join(__dirname, "./data/usage-guidance.json"), "utf-8")
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
      "列出 NutUI React Taro 3.x 所有组件，可按分类筛选。返回组件名称、中文分类名、文档链接。\n\n使用建议：\n- 不带 category 参数列出全部，了解项目中有哪些可用组件\n- 配合 Agent 的任务上下文，先确认组件存在再查询详情",
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
      "查询指定 NutUI 组件的详细信息，包括 Props（名称、类型、是否必填、中文描述）。Props 会自动分为【核心】和【可选】两组，核心Props 是大多数场景需要的，可选Props 按需配置，不必全部传入。\n\n使用建议：\n- 组件名必须精确匹配（如 button、cell、dialog），不要模糊搜索\n- 优先使用【核心 Props】构建基础功能，可选 Props 按需添加\n- 组件有自带用法指南（显示在返回结果开头），请先阅读\n- 必填=否 表示该 prop 有默认值，不是一定要传\n- 查看完整文档和 demo 请访问返回结果中的 docUrl",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "组件名称（英文），如 button、cell、dialog（必须是精确名称，不要模糊匹配）",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "search_components",
    description:
      "搜索 NutUI 组件，支持按组件名、属性名、描述全文搜索，返回匹配组件及其 Prop 匹配信息。结果按【匹配等级】排序：exact(精确)>prefix(前缀)>boundary(词边界)>substring(子串)>prop(仅属性)。\n\n使用建议：\n- 搜索组件名时优先看第一结果，🎯 exact 匹配才是你要的组件\n- 如果搜 picker 第一个是 datepicker（子串匹配），说明你要的 picker 不在结果里\n- Prop 匹配仅作参考，不表示该组件适合你的场景\n- 搜索效果不佳时，用 list_components 列出全量再人工判断",
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

// ─── 常用 Prop 识别 ────────────────────────────────────────────────

const COMMON_PROP_PATTERNS = [
  'visible', 'title', 'options', 'value', 'defaultValue', 'children',
  'placeholder', 'disabled', 'loading', 'type', 'size', 'color',
  'onChange', 'onClick', 'onConfirm', 'onCancel', 'onClose',
  'data', 'list', 'content', 'text', 'icon',
];

function isCommonProp(prop: Prop): boolean {
  const name = prop.name.toLowerCase();
  // 命中最见 prop 名
  if (COMMON_PROP_PATTERNS.some((p) => name === p || name.startsWith(p))) {
    return true;
  }
  // onXxx 事件回调通常是必要的
  if (name.startsWith('on') && name.length > 3) return true;
  return false;
}


function getRelatedComponents(compName: string): {
  label: string;
  description: string;
  related: string[];
  commonPatterns?: string[];
} | null {
  // 精确匹配或大小写不敏感匹配
  const key = Object.keys(relationshipsData).find(
    k => k.toLowerCase() === compName.toLowerCase()
  );
  return key ? relationshipsData[key] : null;
}

function formatRelatedComponents(info: ReturnType<typeof getRelatedComponents>, allComps: Component[]): string[] {
  if (!info) return [];

  const lines: string[] = [];
  lines.push(`\n---\n`);
  lines.push(`\n### 🔗 ${info.label}\n`);
  lines.push(`> ${info.description}\n`);

  // 过滤出实际存在的组件
  const validRelated = info.related.filter(name =>
    allComps.some(c => c.name.toLowerCase() === name.toLowerCase())
  );

  if (validRelated.length > 0) {
    lines.push(`**相关组件**: ${validRelated.map(n => `\`${n}\``).join(' | ')}\n`);
  }

  if (info.commonPatterns && info.commonPatterns.length > 0) {
    lines.push(`**常见搭配**:`);
    for (const pattern of info.commonPatterns) {
      lines.push(`  - ${pattern}`);
    }
    lines.push('');
  }

  return lines;
}

// ─── Props 分组 ────────────────────────────────────────────────────

type PropGroup = { core: Prop[]; optional: Prop[] };

function groupProps(props: Prop[]): PropGroup {
  const core: Prop[] = [];
  const optional: Prop[] = [];
  for (const prop of props) {
    if (isCommonProp(prop)) {
      core.push(prop);
    } else {
      optional.push(prop);
    }
  }
  // core 按 name 长度排序（短的在前）
  core.sort((a, b) => a.name.length - b.name.length);
  return { core, optional };
}

function formatPropsTable(props: Prop[], label: string, isOptional = false): string[] {
  if (props.length === 0) return [];
  const lines: string[] = [`\n### ${label} (${props.length})`];
  lines.push('| 属性 | 类型 | 必填 | 说明 |');
  lines.push('|------|------|------|------|');
  for (const prop of props) {
    // optional 组的 props 统一标注"否"（它们本来就按需使用）
    const req = isOptional ? '否' : (prop.required ? '是' : '否');
    const desc = prop.description || '-';
    lines.push(`| \`${prop.name}\` | \`${prop.type}\` | ${req} | ${desc} |`);
  }
  return lines;
}


function getUsageGuidance(comp: Component): string | null {
  return usageGuidanceData[comp.name] ?? null;
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

  const { core, optional } = groupProps(comp.props);
  const guidance = getUsageGuidance(comp);

  const lines: string[] = [
    `## ${comp.name}`,
    `分类: ${comp.category}`,
    `文档: ${comp.docUrl}`,
  ];

  if (guidance) {
    lines.push(`\n> 💡 基础用法: ${guidance}`);
  }

  lines.push(`\n**提示**: Props 分为"核心"和"可选"两组。核心Props 是大多数场景需要的；可选Props 按需设置，不必全部传入。`);

  lines.push(...formatPropsTable(core, '核心 Props'));
  lines.push(...formatPropsTable(optional, '可选 Props', true));

  // 添加组件关联关系
  const relatedInfo = getRelatedComponents(comp.name);
  lines.push(...formatRelatedComponents(relatedInfo, componentsData.components));

  return lines.join('\n');
}

function searchComponents(
  query: string,
  category?: string,
  limit = 10
): string {
  const q = query.toLowerCase().trim();
  if (!q) return '请提供搜索关键词';

  let components = componentsData.components as Component[];

  if (category) {
    components = components.filter((c) =>
      c.category.includes(category)
    );
  }

  type MatchType = 'exact' | 'prefix' | 'boundary' | 'substring' | 'prop';
  type Scored = {
    comp: Component;
    score: number;
    matchType: MatchType;
    matchedProps: { name: string; type: 'name' | 'type' | 'desc' }[];
  };

  const results: Scored[] = [];

  for (const comp of components) {
    let score = 0;
    let matchType: MatchType = 'substring';
    const matchedProps: Scored['matchedProps'] = [];

    // ── 组件名匹配（分级加权）──────────────────────────────
    const compName = comp.name.toLowerCase();

    if (compName === q) {
      // 精确匹配（不区分大小写）
      score += 100;
      matchType = 'exact';
    } else if (compName.startsWith(q)) {
      // 前缀匹配
      score += 60;
      matchType = 'prefix';
    } else if (compName.includes(q)) {
      // 子串匹配（仅当不含更优匹配时才加分）
      // 如果 query 长度 > 3，子串匹配降权（避免 picker 匹配到 datepicker）
      score += q.length > 3 ? 15 : 30;
      if (matchType === 'substring') matchType = 'substring';
    }

    // 单词边界匹配（query 是独立的单词）
    const wordBoundaryRegex = new RegExp(`(^|_)${escapeRegex(q)}($|_|s)`, 'i');
    if (wordBoundaryRegex.test(compName)) {
      score += 45;
      if (matchType === 'substring') matchType = 'boundary';
    }

    // ── Prop 匹配 ─────────────────────────────────────────
    for (const prop of comp.props) {
      const pName = prop.name.toLowerCase();
      const pType = prop.type.toLowerCase();
      const pDesc = prop.description.toLowerCase();

      if (pName === q) {
        score += 20;
        matchedProps.push({ name: prop.name, type: 'name' });
      } else if (pName.startsWith(q)) {
        score += 10;
        matchedProps.push({ name: prop.name, type: 'name' });
      } else if (pName.includes(q)) {
        score += 5;
        matchedProps.push({ name: prop.name, type: 'name' });
      }

      if (pType.includes(q)) {
        score += 3;
      }
      if (pDesc.includes(q)) {
        score += 2;
      }
    }

    // 分类匹配
    if (comp.category.toLowerCase().includes(q)) score += 5;

    if (score > 0) {
      results.push({ comp, score, matchType, matchedProps });
    }
  }

  // ── 二次排序：matchType 优先级 > score ──────────────────
  const typePriority: Record<MatchType, number> = {
    exact: 4,
    prefix: 3,
    boundary: 2,
    substring: 1,
    prop: 0,
  };

  results.sort((a, b) => {
    if (a.matchType !== b.matchType) {
      return typePriority[b.matchType] - typePriority[a.matchType];
    }
    // 同类型按评分排，评分相同时 props 少的排前面（减少干扰）
    if (b.score !== a.score) return b.score - a.score;
    return a.comp.props.length - b.comp.props.length;
  });

  const top = results.slice(0, limit);

  if (top.length === 0) {
    return `没有找到匹配 "${query}" 的组件`;
  }

  const lines: string[] = [
    `搜索 "${query}"，找到 ${top.length} 个结果（按相关性排序）：\n`,
    '> 💡 匹配等级：exact=精确 > prefix=前缀 > boundary=词边界 > substring=子串 > prop=仅属性匹配',
    '',
  ];

  for (const { comp, score, matchType, matchedProps } of top) {
    const typeLabel: Record<MatchType, string> = {
      exact: '🎯 exact',
      prefix: '🔗 prefix',
      boundary: '📌 boundary',
      substring: '🔍 substring',
      prop: '⚙️ prop',
    };
    lines.push(`## ${comp.name} [${comp.category}] ${typeLabel[matchType]}`);
    lines.push(`文档: ${comp.docUrl}`);
    if (matchedProps.length > 0) {
      const propList = matchedProps.map((p) => `\`${p.name}\``).join(', ');
      lines.push(`属性匹配: ${propList}`);
    }
    lines.push(`Props数: ${comp.props.length} | 得分: ${score}\n`);
  }

  return lines.join('\n');
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
