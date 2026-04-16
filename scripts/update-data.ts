/**
 * Update components.json from a new @nutui/nutui-react-taro tarball
 * Usage: npx tsx scripts/update-data.ts <version>
 * e.g.:  npx tsx scripts/update-data.ts 3.0.19
 */
import { execSync } from "child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { join } from "path";

const version = process.argv[2];
if (!version) {
  console.error("Usage: npx tsx scripts/update-data.ts <version>");
  process.exit(1);
}

const tmpDir = `/tmp/nutui-taro-${version}`;
const tarball = `/tmp/nutui-nutui-react-taro-${version}.tgz`;

// 1. Download
console.log(`Downloading @nutui/nutui-react-taro@${version}...`);
if (!existsSync(tarball)) {
  execSync(`npm pack @nutui/nutui-react-taro@${version} --pack-destination /tmp`, { cwd: "/tmp" });
}

// 2. Extract
console.log("Extracting...");
if (existsSync(tmpDir)) {
  execSync(`rm -rf ${tmpDir}`);
}
mkdirSync(tmpDir);
execSync(`tar -xf ${tarball} -C ${tmpDir}`, { stdio: "pipe" });

const pkgDir = join(tmpDir, "package");
const specDir = join(pkgDir, "dist/es/types/spec");

if (!existsSync(specDir)) {
  console.error(`Spec dir not found: ${specDir}`);
  process.exit(1);
}

// 3. Parse
const categories: Record<string, string[]> = {
  "基础组件": ["button", "cell", "configprovider", "icon", "image", "overlay"],
  "布局组件": ["divider", "grid", "layout", "safearea", "space", "sticky", "row", "col", "griditem"],
  "导航组件": ["backtop", "elevator", "fixednav", "hoverbutton", "navbar", "sidebar", "tabbar", "tabs", "sidebaritem", "tabbaritem", "tabpane"],
  "数据录入": ["address", "calendar", "calendarcard", "cascader", "checkbox", "datepicker", "datepickerview", "form", "formitem", "input", "inputnumber", "menu", "menuitem", "numberkeyboard", "picker", "pickerview", "radio", "radiogroup", "range", "rate", "searchbar", "shortpassword", "signature", "switch", "textarea", "uploader"],
  "操作反馈": ["actionsheet", "badge", "dialog", "drag", "empty", "loading", "notify", "popover", "popup", "toast", "tour"],
  "数据展示": ["animatingnumbers", "avatar", "avatarcropper", "avatargroup", "badge", "card", "collapse", "collapseitem", "countdown", "countup", "divider", "ellipsis", "empty", "imagepreview", "indicator", "infiniteloading", "noticebar", "pagination", "price", "progress", "skeleton", "step", "steps", "swipe", "swiper", "swiperitem", "table", "tag", "timedetail", "timeselect", "trendarrow", "virtuallist", "watermark", "barrage", "audio", "video", "lottie", "circleprogress", "resultpage", "animate"],
  "高级组件": ["resultpage"],
  "业务组件": ["tour"],
};

function inferCategory(name: string): string {
  for (const [cat, comps] of Object.entries(categories)) {
    if (comps.some(c => c.toLowerCase() === name.toLowerCase())) return cat;
  }
  return "其他";
}

function parseSpec(content: string) {
  const props: { name: string; type: string; required: boolean; description: string }[] = [];
  const lines = content.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (line.startsWith("/**") && i + 1 < lines.length) {
      const descLines: string[] = [];
      let j = i + 1;
      while (j < lines.length && !lines[j].trim().startsWith("*/")) {
        const stripped = lines[j].trim();
        if (stripped.startsWith("*")) {
          descLines.push(stripped.replace(/^\* ?/, "").trim());
        }
        j++;
      }
      const desc = descLines.join(" ").trim();
      let k = j + 1;
      while (k < lines.length && !lines[k].trim()) k++;
      const propLine = lines[k]?.trim() ?? "";
      const match = propLine.match(/^(\w+)(\?)?:\s*([^;]+)/);
      if (match) {
        props.push({
          name: match[1],
          type: match[3].trim(),
          required: match[2] !== "?",
          description: desc,
        });
      }
      i = k + 1;
    } else {
      i++;
    }
  }
  return props;
}

const components: { name: string; category: string; props: ReturnType<typeof parseSpec>; docUrl: string }[] = [];

for (const fname of readdirSync(specDir)) {
  const basePath = join(specDir, fname, "base.d.ts");
  if (!existsSync(basePath)) continue;
  const content = readFileSync(basePath, "utf-8");
  const props = parseSpec(content);
  components.push({
    name: fname,
    category: inferCategory(fname),
    props,
    docUrl: `https://nutui.jd.com/taro/react/3x/#/zh-CN/component/${fname}`,
  });
}

components.sort((a, b) => a.name.localeCompare(b.name));

const output = { version, components };
const outPath = join(process.cwd(), "components.json");
writeFileSync(outPath, JSON.stringify(output, null, 2), "utf-8");

// Cleanup
execSync(`rm -rf ${tmpDir}`);

console.log(`Updated components.json with ${components.length} components from v${version}`);
const cats: Record<string, number> = {};
for (const c of components) {
  cats[c.category] = (cats[c.category] ?? 0) + 1;
}
for (const [cat, n] of Object.entries(cats).sort()) {
  console.log(`  ${cat}: ${n}`);
}
