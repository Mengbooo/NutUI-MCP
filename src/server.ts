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

// ─── 组件关联关系 ────────────────────────────────────────────────

const COMPONENT_RELATIONSHIPS: Record<string, {
  label: string;
  description: string;
  related: string[];
  commonPatterns?: string[];
}> = {
  // ── Form 生态 ───────────────────────────────────────────────
  form: {
    label: "表单组合",
    description: "NutUI 提供完整的表单解决方案，支持数据验证和布局",
    related: ["formitem", "input", "inputnumber", "textarea", "checkbox", "radio", "switch", "picker", "datepicker", "cascader", "rate", "range", "uploader", "searchbar"],
    commonPatterns: ["Form + FormItem + Input", "Form + DatePicker + Cascader", "Form + Checkbox/Radio + Switch"],
  },
  formitem: {
    label: "表单项",
    description: "FormItem 是表单的字段组件，必须包裹在 Form 内使用",
    related: ["form", "input", "textarea", "inputnumber", "checkbox", "radio", "switch", "picker"],
  },
  input: {
    label: "文本输入",
    description: "支持单行文本输入，可与 Form/FormItem 配合做数据校验",
    related: ["form", "formitem", "textarea", "searchbar"],
    commonPatterns: ["Form + FormItem + Input", "SearchBar (内置 Input)"],
  },
  textarea: {
    label: "多行文本",
    description: "多行文本输入框，支持自动增高和字数统计",
    related: ["form", "formitem", "input"],
  },
  inputnumber: {
    label: "数字输入",
    description: "带增减按钮的数字输入框，适合数量、金额等场景",
    related: ["form", "formitem", "input"],
  },
  switch: {
    label: "开关",
    description: "布尔值切换组件，常用于启用/禁用设置项",
    related: ["form", "formitem", "cell"],
    commonPatterns: ["Cell + Switch (设置项)", "Form + FormItem + Switch"],
  },
  checkbox: {
    label: "复选框",
    description: "多选组件，单独使用或配合 Cell/Form",
    related: ["form", "formitem", "cell", "radiogroup"],
    commonPatterns: ["Cell + Checkbox (列表选择)", "CheckboxGroup + Checkbox"],
  },
  radio: {
    label: "单选框",
    description: "单选组件，配合 Radiogroup 使用",
    related: ["form", "formitem", "radiogroup", "cell"],
    commonPatterns: ["RadioGroup + Radio (互斥选项)", "Cell + Radio (列表选择)"],
  },
  picker: {
    label: "选择器",
    description: "多列选择器，支持联动和非联动模式",
    related: ["form", "formitem", "picker", "cascader", "datepicker"],
    commonPatterns: ["Form + Picker (单列/多列选择)", "Picker + DatePicker (时间场景)"],
  },
  datepicker: {
    label: "日期选择",
    description: "日期/时间选择，支持日期范围和快捷操作",
    related: ["form", "formitem", "picker", "calendar", "calendarcard"],
    commonPatterns: ["Form + DatePicker (日期录入)", "Calendar (日历场景)"],
  },
  cascader: {
    label: "级联选择",
    description: "多级联动选择器，适合省市区等树形数据",
    related: ["form", "formitem", "picker"],
    commonPatterns: ["Form + Cascader (地址选择)", "Address (完整地址方案)"],
  },
  rate: {
    label: "评分",
    description: "星级评分组件，适合评价场景",
    related: ["form", "formitem", "cell"],
    commonPatterns: ["Cell + Rate (评价页)", "Form + FormItem + Rate"],
  },
  uploader: {
    label: "文件上传",
    description: "图片/文件上传，支持预览、删除、压缩",
    related: ["form", "formitem", "cell"],
    commonPatterns: ["Cell + Uploader (设置头像/附件)", "Form + FormItem + Uploader"],
  },
  searchbar: {
    label: "搜索框",
    description: "带搜索功能的输入框，内置取消、历史记录",
    related: ["input", "filter", "cell"],
    commonPatterns: ["Navbar + SearchBar (顶部搜索)", "SearchBar + Filter (筛选搜索)"],
  },

  // ── 列表/ Cell 生态 ─────────────────────────────────────────
  cell: {
    label: "单元格",
    description: "列表项基础组件，支持标题、描述、图标、跳转",
    related: ["uploader", "switch", "checkbox", "radio", "badge", "tag", "avatar"],
    commonPatterns: ["Cell + Switch (设置页)", "Cell + Badge/Tag (状态标签)", "CellGroup (分组列表)"],
  },
  swipe: {
    label: "滑动操作",
    description: "列表项左滑出现操作按钮，如删除、收藏",
    related: ["cell", "infiniteLoading", "infiniteLoading"],
    commonPatterns: ["Cell + Swipe (可滑动列表)", "Swipe + Button (操作组)"],
  },
  infiniteLoading: {
    label: "无限滚动",
    description: "滚动到底部自动加载更多数据",
    related: ["cell", "swipe", "list"],
    commonPatterns: ["List + InfiniteLoading (列表加载)", "Cell + InfiniteLoading (长列表)"],
  },
  pullRefresh: {
    label: "下拉刷新",
    description: "下拉触发刷新操作",
    related: ["infiniteLoading", "cell"],
    commonPatterns: ["PullRefresh + InfiniteLoading (完整列表)", "PullRefresh + List"],
  },
  list: {
    label: "虚拟列表",
    description: "长列表渲染优化，支持自定义布局",
    related: ["infiniteLoading", "cell", "swipe"],
    commonPatterns: ["Virtuallist + Cell", "Virtuallist + InfiniteLoading"],
  },

  // ── 弹层/反馈生态 ────────────────────────────────────────────
  popup: {
    label: "弹出层",
    description: "基础弹层组件，其他弹层组件基于它实现",
    related: ["dialog", "toast", "notify", "actionsheet", "popover", "tour"],
    commonPatterns: ["Popup (通用弹层)", "Popup + 自定义内容"],
  },
  dialog: {
    label: "对话框",
    description: "模态对话框，用于重要操作确认",
    related: ["popup", "toast", "notify"],
    commonPatterns: ["Dialog.confirm (确认操作)", "Dialog.alert (提示)", "Dialog (自定义内容)"],
  },
  toast: {
    label: "轻提示",
    description: "短暂的提示信息，自动消失",
    related: ["notify", "dialog"],
    commonPatterns: ["Toast.success/fail (操作反馈)", "Toast.info (提示)"],
  },
  notify: {
    label: "通知栏",
    description: "顶部通知，支持多种状态",
    related: ["toast", "popup"],
    commonPatterns: ["Notify.success (状态通知)", "Notify (顶部消息)"],
  },
  actionsheet: {
    label: "底部菜单",
    description: "从底部弹出的操作菜单",
    related: ["popup", "dialog"],
    commonPatterns: ["ActionSheet (选项列表)", "ActionSheet + Dialog (组合确认)"],
  },
  popover: {
    label: "气泡弹出",
    description: "点击触发的小气泡弹层",
    related: ["popup", "dialog"],
    commonPatterns: ["Popover + Button (功能引导)", "Popover + Icon (操作选择)"],
  },
  tour: {
    label: "引导向导",
    description: "新功能引导，高亮指定区域",
    related: ["popup", "popover", "overlay"],
    commonPatterns: ["Tour (功能引导)", "Tour + Popover (混合引导)"],
  },
  overlay: {
    label: "遮罩层",
    description: "半透明遮罩，常配合弹层使用",
    related: ["popup", "dialog", "tour"],
    commonPatterns: ["Overlay + Popup", "Overlay + Dialog"],
  },
  loading: {
    label: "加载状态",
    description: "加载中指示器",
    related: ["dialog", "button"],
    commonPatterns: ["Loading (全屏)", "Button + Loading (按钮加载)"],
  },
  empty: {
    label: "空状态",
    description: "数据为空时的占位展示",
    related: ["ellipsis", "imagepreview"],
    commonPatterns: ["Empty (无数据)", "Empty + ImagePreview (无图片)"],
  },

  // ── 导航生态 ─────────────────────────────────────────────────
  navbar: {
    label: "导航栏",
    description: "页面顶部导航栏，支持标题、返回、操作按钮",
    related: ["tabbar", "fixednav", "backtop", "searchbar"],
    commonPatterns: ["Navbar + SearchBar (搜索页)", "Navbar + Tabs (分类详情页)"],
  },
  tabbar: {
    label: "底部标签栏",
    description: "页面底部导航，适合多 tab 切换",
    related: ["tabbaritem", "navbar", "fixednav"],
    commonPatterns: ["TabBar + TabPane (多页面)", "TabBar + Router (路由导航)"],
  },
  tabbaritem: {
    label: "底部标签项",
    description: "TabBar 的单个标签",
    related: ["tabbar", "tabpane", "badge"],
    commonPatterns: ["TabBar + TabBarItem + Badge (带红点)", "TabBar + Router"],
  },
  tabs: {
    label: "标签页",
    description: "横向标签切换组件",
    related: ["tabpane", "navbar", "sticky"],
    commonPatterns: ["Tabs + TabPane (内容切换)", "Tabs + Sticky (吸顶)"],
  },
  tabpane: {
    label: "标签面板",
    description: "Tabs 的内容面板",
    related: ["tabs", "cell", "list"],
    commonPatterns: ["Tabs + TabPane + List (分类列表)", "Tabs + Swipe (滑动内容)"],
  },
  sidebar: {
    label: "侧边导航",
    description: "左侧分类导航，适合筛选+列表场景",
    related: ["sidebaritem", "cell", "tabpane"],
    commonPatterns: ["Sidebar + Cell (分类列表)", "Sidebar + Tabs (混合导航)"],
  },
  sidebaritem: {
    label: "侧边导航项",
    description: "Sidebar 的单个选项",
    related: ["sidebar", "badge"],
    commonPatterns: ["Sidebar + SidebarItem + Badge (带数量)"],
  },
  fixednav: {
    label: "悬浮导航",
    description: "固定位置的导航按钮",
    related: ["navbar", "tabbar", "backtop"],
    commonPatterns: ["FixedNav + BackTop (快捷导航)", "FixedNav + NavBar"],
  },
  backtop: {
    label: "返回顶部",
    description: "滚动后出现，点击返回页面顶部",
    related: ["fixednav", "navbar"],
    commonPatterns: ["BackTop + FixedNav (快捷导航)", "BackTop + InfiniteLoading"],
  },
  elevator: {
    label: "电梯导航",
    description: "字母索引定位，常用于城市/通讯录选择",
    related: ["cell", "sidebar", "cascader"],
    commonPatterns: ["Elevator (城市选择)", "Elevator + Cell (通讯录)"],
  },

  // ── 数据展示生态 ─────────────────────────────────────────────
  avatar: {
    label: "头像",
    description: "用户头像/图标展示",
    related: ["avatargroup", "badge", "cell"],
    commonPatterns: ["Avatar + Badge (带数字)", "AvatarGroup (头像组)"],
  },
  avatargroup: {
    label: "头像组",
    description: "多个头像堆叠展示",
    related: ["avatar", "badge"],
    commonPatterns: ["AvatarGroup + Avatar + Badge"],
  },
  badge: {
    label: "徽标",
    description: "右上角红色数字/小点提示",
    related: ["cell", "tabbaritem", "avatar", "avatargroup"],
    commonPatterns: ["Badge + TabBar (导航红点)", "Badge + Cell (状态)", "Badge + Avatar"],
  },
  tag: {
    label: "标签",
    description: "短文本标签，用于状态/分类",
    related: ["cell", "badge", "ellipsis"],
    commonPatterns: ["Cell + Tag (状态标签)", "Tag + Ellipsis (省略+标签)"],
  },
  progress: {
    label: "进度条",
    description: "线性和圆形进度展示",
    related: ["cell", "steps", "circleprogress"],
    commonPatterns: ["Progress (线性)", "CircleProgress (圆形)", "Cell + Progress"],
  },
  circleprogress: {
    label: "圆形进度",
    description: "圆形进度环，适合比例展示",
    related: ["progress", "countdown"],
    commonPatterns: ["CircleProgress + Price (金额进度)"],
  },
  countdown: {
    label: "倒计时",
    description: "Countdown 倒计时，支持毫秒精度",
    related: ["countup", "circleprogress", "cell"],
    commonPatterns: ["Countdown (限时活动)", "Countdown + CountUp (数据展示)"],
  },
  countup: {
    label: "数字滚动",
    description: "数字滚动动画，增强数字展示效果",
    related: ["countdown", "price"],
    commonPatterns: ["CountUp (数字动画)", "Price + CountUp (价格动画)"],
  },
  price: {
    label: "价格展示",
    description: "价格格式化，支持小数和单位",
    related: ["countup", "countdown", "tag"],
    commonPatterns: ["Price (价格展示)", "Price + CountUp (价格动画)"],
  },
  ellipsis: {
    label: "文本省略",
    description: "多行文本省略，支持展开/收起",
    related: ["tag", "cell"],
    commonPatterns: ["Ellipsis + Tag", "Cell + Ellipsis (长文本)"],
  },
  skeleton: {
    label: "骨架屏",
    description: "内容加载占位，提升感知体验",
    related: ["loading", "empty"],
    commonPatterns: ["Skeleton (骨架屏)", "Skeleton + Image (图片占位)"],
  },
  swiper: {
    label: "轮播图",
    description: "图片/内容轮播组件",
    related: ["swiperitem", "indicator", "imagepreview"],
    commonPatterns: ["Swiper + SwiperItem + Indicator", "Swiper + ImagePreview"],
  },
  swiperitem: {
    label: "轮播项",
    description: "Swiper 的内容项",
    related: ["swiper", "indicator", "image"],
    commonPatterns: ["Swiper + SwiperItem"],
  },
  indicator: {
    label: "指示器",
    description: "点状/数字指示器",
    related: ["swiper", "swiperitem", "pagination"],
    commonPatterns: ["Indicator + Swiper (轮播指示)", "Indicator + Tabs"],
  },
  imagepreview: {
    label: "图片预览",
    description: "图片大图预览，支持缩放和滑动",
    related: ["swiper", "empty", "uploader"],
    commonPatterns: ["ImagePreview + Swiper (图片详情)", "ImagePreview + Empty (无图)"],
  },
  table: {
    label: "表格",
    description: "数据表格，支持排序和筛选",
    related: ["cell", "pagination", "infiniteLoading"],
    commonPatterns: ["Table + Pagination", "Table + Cell (行操作)"],
  },
  pagination: {
    label: "分页器",
    description: "页码导航，适合长列表",
    related: ["table", "infiniteLoading"],
    commonPatterns: ["Pagination (分页)", "Pagination + Table/List"],
  },
  collapse: {
    label: "折叠面板",
    description: "可折叠的内容区域",
    related: ["collapseitem", "cell"],
    commonPatterns: ["Collapse + CollapseItem (手风琴)", "Collapse + Cell (FAQ)"],
  },
  collapseitem: {
    label: "折叠项",
    description: "Collapse 的单个折叠项",
    related: ["collapse", "cell"],
    commonPatterns: ["CollapseItem + Cell"],
  },
  steps: {
    label: "步骤条",
    description: "流程步骤展示",
    related: ["step", "cell"],
    commonPatterns: ["Steps + Step (流程页)", "Steps + Cell (状态流)"],
  },
  step: {
    label: "步骤",
    description: "Steps 的单个步骤",
    related: ["steps"],
    commonPatterns: ["Step + Steps"],
  },
  noticebar: {
    label: "通知栏",
    description: "横向滚动通知，用于公告/提示",
    related: ["tag", "ellipsis"],
    commonPatterns: ["NoticeBar (公告)", "NoticeBar + Tag (状态)"],
  },
  trendarrow: {
    label: "趋势箭头",
    description: "涨跌状态展示，配合数字使用",
    related: ["price", "countup", "tag"],
    commonPatterns: ["TrendArrow + Price", "TrendArrow + CountUp"],
  },
  watermark: {
    label: "水印",
    description: "页面/元素水印，防止截图",
    related: ["empty"],
    commonPatterns: ["Watermark (防盗)", "Watermark + Empty"],
  },
  virtuallist: {
    label: "虚拟列表",
    description: "大数据量列表渲染优化",
    related: ["cell", "infiniteLoading", "swipe"],
    commonPatterns: ["Virtuallist + Cell", "Virtuallist + InfiniteLoading"],
  },
  drag: {
    label: "拖拽排序",
    description: "列表拖拽排序",
    related: ["cell", "swipe"],
    commonPatterns: ["Drag + Cell (拖拽列表)", "Drag + Swipe"],
  },
  resultpage: {
    label: "结果页",
    description: "操作结果展示页面",
    related: ["button", "empty", "dialog"],
    commonPatterns: ["ResultPage (结果页)", "ResultPage + Button (操作)"],
  },

  // ── 布局生态 ─────────────────────────────────────────────────
  row: {
    label: "行",
    description: "Flex 布局行，配合 Col 使用",
    related: ["col", "space", "grid"],
    commonPatterns: ["Row + Col (栅格)", "Row + Space (间距)"],
  },
  col: {
    label: "列",
    description: "Flex 布局列，配合 Row 使用",
    related: ["row", "space", "griditem"],
    commonPatterns: ["Col + Row (栅格)", "Col + Col (多列布局)"],
  },
  grid: {
    label: "网格",
    description: "宫格布局，适合图标+文字组合",
    related: ["griditem", "badge", "icon"],
    commonPatterns: ["Grid + GridItem (功能入口)", "Grid + Badge (带数字)"],
  },
  griditem: {
    label: "网格项",
    description: "Grid 的单个格子",
    related: ["grid", "badge", "icon"],
    commonPatterns: ["GridItem + Grid"],
  },
  space: {
    label: "间距",
    description: "组件间距管理，自动设置间距",
    related: ["row", "col", "divider"],
    commonPatterns: ["Space + Row/Col", "Space + Divider (分隔)"],
  },
  divider: {
    label: "分割线",
    description: "内容分隔，支持水平/垂直",
    related: ["space", "cell"],
    commonPatterns: ["Divider + Cell (列表分隔)", "Divider + Space (间距)"],
  },
  sticky: {
    label: "吸顶",
    description: "滚动时固定在顶部",
    related: ["tabs", "navbar"],
    commonPatterns: ["Sticky + Tabs (分类吸顶)", "Sticky + NavBar"],
  },
  safearea: {
    label: "安全区",
    description: "适配 iPhone X 等刘海屏",
    related: ["fixednav", "tabbar"],
    commonPatterns: ["SafeArea + FixedNav", "SafeArea + TabBar"],
  },
  layout: {
    label: "布局",
    description: "Layout 布局容器，配合 Header/Sider/Footer",
    related: ["row", "col"],
    commonPatterns: ["Layout + Header + Content + Footer"],
  },

  // ── 多媒体 ───────────────────────────────────────────────────
  image: {
    label: "图片",
    description: "图片展示，支持懒加载/占位/圆角",
    related: ["imagepreview", "avatar", "skeleton"],
    commonPatterns: ["Image + ImagePreview", "Image + Skeleton"],
  },
  audio: {
    label: "音频播放",
    description: "音频播放器，支持多种样式",
    related: ["video", "barrage"],
    commonPatterns: ["Audio (语音)", "Audio + Barrage (弹幕)"],
  },
  video: {
    label: "视频播放",
    description: "视频播放器，支持控制栏",
    related: ["audio", "barrage", "swiper"],
    commonPatterns: ["Video (视频)", "Video + Swiper (推荐视频)"],
  },
  barrage: {
    label: "弹幕",
    description: "视频/音频弹幕效果",
    related: ["video", "audio", "list"],
    commonPatterns: ["Barrage + Video", "Barrage + Audio"],
  },
  animate: {
    label: "动画",
    description: "CSS 动画组件，支持多种动画效果",
    related: ["audio", "video"],
    commonPatterns: ["Animate (动画)", "Animate + ImagePreview"],
  },
  lottie: {
    label: "Lottie 动画",
    description: "Lottie json 动画播放",
    related: ["animate", "empty"],
    commonPatterns: ["Lottie (Lottie动画)", "Lottie + Empty"],
  },

  // ── 配置类 ───────────────────────────────────────────────────
  configprovider: {
    label: "全局配置",
    description: "NutUI 全局主题配置",
    related: ["button", "cell", "dialog"],
    commonPatterns: ["ConfigProvider (主题)", "ConfigProvider + Button/Dialog"],
  },
  icon: {
    label: "图标",
    description: "NutUI 内置图标库",
    related: ["button", "cell", "grid", "avatar"],
    commonPatterns: ["Icon + Button", "Icon + Cell", "Icon + Grid"],
  },
  calendar: {
    label: "日历",
    description: "日历组件，支持日期选择和范围选择",
    related: ["datepicker", "calendarcard", "cell"],
    commonPatterns: ["Calendar (日历查看)", "Calendar + DatePicker (日期范围)"],
  },
  calendarcard: {
    label: "日历卡片",
    description: "日历卡片组件，月历视图",
    related: ["calendar", "datepicker"],
    commonPatterns: ["CalendarCard (月历)", "CalendarCard + DatePicker"],
  },
  menu: {
    label: "菜单",
    description: " dropdown 下拉菜单",
    related: ["menuitem", "cell"],
    commonPatterns: ["Menu + MenuItem (下拉)", "Menu + Cell (设置)"],
  },
  menuitem: {
    label: "菜单项",
    description: "Menu 的下拉项",
    related: ["menu", "cell"],
    commonPatterns: ["MenuItem + Menu"],
  },
  numberkeyboard: {
    label: "数字键盘",
    description: "自定义数字键盘，配合输入框使用",
    related: ["input", "inputnumber", "popup"],
    commonPatterns: ["NumberKeyboard + Input", "NumberKeyboard + Popup"],
  },
  shortpassword: {
    label: "短密码",
    description: "短密码输入框，用于支付密码等",
    related: ["input", "popup", "numberkeyboard"],
    commonPatterns: ["ShortPassword + Popup", "ShortPassword + NumberKeyboard"],
  },
  signature: {
    label: "签名板",
    description: "手写签名组件",
    related: ["popup", "uploader"],
    commonPatterns: ["Signature + Popup", "Signature + Uploader"],
  },
  range: {
    label: "范围选择",
    description: "双滑块范围选择",
    related: ["form", "formitem", "cell"],
    commonPatterns: ["Range + Cell", "Form + FormItem + Range"],
  },
  pickerview: {
    label: "选择器视图",
    description: "Picker 选择器的内容视图，非弹层模式",
    related: ["picker", "datepicker"],
    commonPatterns: ["PickerView (嵌入式)", "PickerView + Picker (弹层)"],
  },
  datepickerview: {
    label: "日期选择视图",
    description: "DatePicker 的嵌入式视图",
    related: ["datepicker", "pickerview"],
    commonPatterns: ["DatePickerView + DatePicker", "DatePickerView + Calendar"],
  },
};

function getRelatedComponents(compName: string): {
  label: string;
  description: string;
  related: string[];
  commonPatterns?: string[];
} | null {
  // 精确匹配或大小写不敏感匹配
  const key = Object.keys(COMPONENT_RELATIONSHIPS).find(
    k => k.toLowerCase() === compName.toLowerCase()
  );
  return key ? COMPONENT_RELATIONSHIPS[key] : null;
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

function formatPropsTable(props: Prop[], label: string): string[] {
  if (props.length === 0) return [];
  const lines: string[] = [`\n### ${label} (${props.length})`];
  lines.push('| 属性 | 类型 | 必填 | 说明 |');
  lines.push('|------|------|------|------|');
  for (const prop of props) {
    const req = prop.required ? '是' : '否';
    const desc = prop.description || '-';
    lines.push(`| \`${prop.name}\` | \`${prop.type}\` | ${req} | ${desc} |`);
  }
  return lines;
}

// ─── 用法指南（组件级别的简短提示）─────────────────────────────────

const USAGE_GUIDANCE: Record<string, string> = {
  address: '基础用法需要 visible + existList，可通过 onExistSelect 监听选择。',
  animate: '必需 type + action + loop + onClick，loop=true 为循环动画。',
  actionsheet: '必需 visible + options + onCancel + onSelect，description 可选。',
  audio: '必需 src + type，autoPlay+loop 控制播放行为。',
  avatar: 'src（图片）或 icon/children（图标/文字）二选一，size 控制大小。',
  badge: '必需 value + children，dot=true 时 value 失效。',
  barrage: '必需 list + interval + duration + rows，loop 控制循环。',
  button: 'children 为按钮文字，color 控制颜色，loading 控制加载状态。',
  calendar: 'popup 模式需要 visible + onConfirm + onClose，range 模式需要 type="range"。',
  cell: '基础用法只需 title，可选 description/extra 添加说明和右侧内容，clickable 控制点击反馈。',
  cascader: '基础用法只需 options + onChange；弹窗模式需 visible + onChange，options 为树形配置数据。',
  picker: '基础用法需 options + onConfirm + onCancel，visible 控制显示隐藏；options 为列数据。',
  // 可以继续补充关键组件...
};

function getUsageGuidance(comp: Component): string | null {
  return USAGE_GUIDANCE[comp.name] ?? null;
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
  lines.push(...formatPropsTable(optional, '可选 Props'));

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
