"use strict";

// 生成 README 中的思源笔记架构图 SVG。
//
// 运行:
//   cd app && pnpm run gen:arch
// 产物:
//   screenshots/SiYuan_Arch.svg
//
// 四个 README(README.md 及 zh-CN / ja / tr)引用这张图。改完内容或尺寸后重跑上面的命令即可。
// 脚本以绝对坐标排版,不依赖绘图库与任何外部工具。
//
// 排版规则:
//   - 卡片宽度由文字宽度决定:先算出每张卡的基准宽,再把该行剩余宽度均分给各卡片。
//     宽窄因此与文字长度相关,稀疏行则趋于均匀,既不浪费空间也不会把短文字撑成空框。
//   - 卡片文字默认单行;字符串内含 \n 时首行用正文字号,其余行用小一号的副标题字号。
//   - 主干四层容器等宽;Kernel 内部按行排版,行标题占左侧固定宽度。
//   - 右栏自上而下依次是图例与三组外部组件,间距均分剩余高度,使右栏与主干上下两端对齐。
//   - 外部连线共三条,起点经栏间空隙转向主干右侧,折角用圆弧过渡。
//
// 关于层级划分的一个结论:接口不是独立于内核的一层。WebSocket、MCP、WebDAV/CalDAV、
// HTTP API、发布服务均由 kernel/server 与 kernel/api 实现,属于内核自身。
// 若把它们另列一层、再画一条「接口层 ↔ 内核」的关系线,两头指向的其实是同一批代码
// (server、api 包),构成自环。因此这里把它们并入 Kernel 的首行。
//
// 配色取自 Okabe & Ito 的 Color Universal Design 方案(https://jfly.uni-koeln.de/color/),
// 该方案为红绿色盲设计,避开黄绿相邻色,并以洋红代替红。
// 按该方案的建议,高饱和色只用于描边与强调,填充取低透明度淡化;
// 同时做冗余编码——外部事物一律用中性灰,与系统内部的彩色分层区分。

const fs = require("fs");
const path = require("path");

// ============================== 画布与字号 ==============================
const W = 1516;
const PAD = 32;
const TITLE_H = 68;
const TITLE = "SiYuan Architecture";

const FS_TITLE = 34;
const FS_LAYER = 20;
// 卡片正文与副标题字号。items 里的字符串含 \n 时,首行用正文字号,其余行用副标题字号。
const FS_CARD = 15;
const FS_CARD_SUB = 11;
const FS_ROW = 13;
const FS_LEGEND = 13;

// ============================== 主干布局 ==============================
const MAIN_W = 940;
// 栏间空隙需容纳虚线的垂直段与两处圆角
const COL_GAP = 72;
const SIDE_W = W - PAD * 2 - MAIN_W - COL_GAP;

// 卡片尺寸:宽度由文字决定,高度由行数与上下内边距决定
const CARD_PAD_X = 15;
const CARD_PAD_Y = 9.4;
const CARD_GAP = 8;
const LAYER_PAD_X = 16;
// 容器顶端到首行卡片的距离,即分组标题所占的垂直空间,标题基线取该区间的中点
const LAYER_PAD_TOP = 46;
const LAYER_PAD_BOTTOM = 18;
// 层间距需容纳双向箭头的两个箭头与一段箭杆,过短会让两端箭头挤在一起
const LAYER_GAP = 44;
const ROW_GAP = 8;

// Kernel 行标题占用的左侧宽度
const ROW_LABEL_W = 150;

// ============================== 侧栏与图例布局 ==============================
const S_CARD_PAD_Y = 7.4;
const S_CARD_GAP = 8;
const S_PAD_TOP = 38;
const S_PAD_BOTTOM = 16;
const S_ROW_GAP = 8;
const S_IDENT = 16;

const LEGEND_ROW_H = 28;
const LEGEND_ROW_GAP = 6;
// 三项图例与主干的关系一一对应,顺序与样式均与正文一致
const LEGEND_ITEMS = [
  {kind: "call", text: "Call / data flow"},
  {kind: "hosts", text: "Hosts / runs on"},
  {kind: "external", text: "External dependency / integration"},
];
const LEGEND_H =
  S_PAD_TOP + S_PAD_BOTTOM + LEGEND_ITEMS.length * LEGEND_ROW_H +
  (LEGEND_ITEMS.length - 1) * LEGEND_ROW_GAP;

// ============================== 配色 ==============================
// 主流程颜色比外部事物深一档,用于强调主干调用链
const INK = "#6b7280";
const INK_LIGHT = "#9ca3af";
const CARD_BG = "#ffffff";
const CARD_BORDER = "#e2e8f0";
const TEXT = "#1f2328";
const ROW_TEXT = "#6b7280";

// 各层容器的底色与描边。色相取自 Okabe-Ito 方案,底色为 12% 亮度、描边为 55%
const THEME = {
  sky: {bg: "#ebf6fc", border: "#a2d6f3"},
  blue: {bg: "#e0eef6", border: "#73b2d5"},
  vermillion: {bg: "#faece0", border: "#e8a673"},
  green: {bg: "#e0f3ee", border: "#73c9b2"},
  grey: {bg: "#efefef", border: "#b6b6b6"},
};

// ============================== 内容定义 ==============================
// 每个 row 表示一行卡片,items 即该行卡片文字,文字单行显示,不写换行符。
// Kernel 的行带 label,表示该行的职责分组。
// 层间关系。主干的相邻层之间不一定都是调用,应分开表示:
//   hosts —— 前端运行在客户端内,是容纳关系,不是调用
//   call  —— 双向调用与数据流
// Hosts / call / external 三者与图例一一对应。
// 另需注意:客户端 → 前端这条链只对桌面(Electron 子进程)与浏览器(远端内核)成立;
// Android、iOS、HarmonyOS 上内核是 //go:build mobile 的进程内库,并非前端下方的独立服务。
const FLOWS = [
  {from: "Clients", to: "Frontend (TypeScript)", kind: "hosts"},
  {from: "Frontend (TypeScript)", to: "Kernel (Go)", kind: "call"},
  {from: "Kernel (Go)", to: "Workspace & Persistence", kind: "call"},
];

const MAIN = [
  {
    name: "Clients",
    theme: "sky",
    rows: [{items: ["Desktop", "Browser", "Android", "iOS", "HarmonyOS"]}],
  },
  {
    name: "Frontend (TypeScript)",
    theme: "blue",
    // 拆成两行而非单行八张,避免为容纳单行而把画布拉得过宽
    rows: [
      {items: ["App UI", "Editor / Protyle", "Attribute View UI", "Search"]},
      {items: ["Flashcards", "AI", "Plugins", "Export Renderer"]},
    ],
  },
  {
    name: "Kernel (Go)",
    theme: "vermillion",
    rows: [
      {
        label: "Interfaces & Servers",
        items: ["WebSocket", "MCP", "WebDAV / CalDAV / CardDAV", "HTTP API", "Publish Service"],
      },
      {label: "Domain & Extensions", items: ["model", "av", "search", "agent", "bazaar", "plugin"]},
      {label: "Data & Infrastructure", items: ["treenode", "sql", "filesys", "cache"]},
      {label: "Cross-cutting", items: ["conf", "util", "apicontract", "task / job"]},
    ],
  },
  {
    name: "Workspace & Persistence",
    theme: "green",
    rows: [
      {
        items: [
          ".sy Documents",
          "Assets",
          "blocktree.db",
          "SQLite DBs / FTS5\nsiyuan.db · history.db · asset_content.db",
          "Data Repository / Snapshots",
        ],
      },
    ],
  },
];

const SIDE = [
  {
    // 这些客户端直连接口层,不经前端。CLI 不在此列,
    // 它直接调用 model 层(kernel/cli/cmd 内的调用全部是 model.xxx)
    name: "External Clients",
    theme: "grey",
    rows: [
      {items: ["Chrome Extension", "WebDAV / CalDAV Client"]},
      // 内核既作 MCP 服务端(serveMCP)也作客户端(mcpclient 连外部 MCP server),
      // 因此外部一方同样可能是客户端或服务端
      {items: ["MCP Client / Server"]},
    ],
  },
  {
    name: "Cloud Services",
    theme: "grey",
    rows: [
      {items: ["Account / Subscription", "Cloud AI"]},
      {items: ["Activation Code", "Inbox"]},
      {items: ["Block Reminder", "Upload / CDN"]},
    ],
  },
  {
    // 这一组混合了链接进内核的 Go 库(Lute、Dejavu、Riff、Gulu)与运行期分发的
    // Bazaar、插件类型声明包 Petal。两者同属外部依赖与集成,图例措辞已涵盖两类。
    // 右栏放不下第四组(间距会被压到 20px 以下),因此保持一组。
    name: "Open-source Ecosystem",
    theme: "grey",
    rows: [
      {items: ["Lute - editor engine", "Dejavu - sync engine"]},
      {items: ["Riff - spaced repetition", "Gulu - utilities"]},
      {items: ["Bazaar - packages", "Petal - plugin API"]},
    ],
  },
];

// ============================== 文字宽度估算 ==============================
// Helvetica 的字形宽度表(单位为千分之一 em)。图表内容全部是 ASCII,该表足够接近实际渲染。
// 渲染前会留出余量,生成后再用浏览器实测校验,不会出现文字溢出或换行。
const CHAR_WIDTH = {
  " ": 278, "!": 278, '"': 355, "#": 556, $: 556, "%": 889, "&": 667, "'": 191,
  "(": 333, ")": 333, "*": 389, "+": 584, ",": 278, "-": 333, ".": 278, "/": 278,
  ":": 278, ";": 278, "<": 584, "=": 584, ">": 584, "?": 556, "@": 1015,
  "[": 278, "\\": 278, "]": 278, "^": 469, _: 556, "`": 333,
  "{": 334, "|": 260, "}": 334, "~": 584,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500,
  K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611,
  U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222,
  k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278,
  u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
};
const CHAR_WIDTH_DEFAULT = 556;

// 估算文字宽度(像素)
function textWidth(text, fontSize) {
  let units = 0;
  for (const ch of String(text)) {
    if (ch >= "0" && ch <= "9") {
      units += 556;
      continue;
    }
    units += CHAR_WIDTH[ch] !== undefined ? CHAR_WIDTH[ch] : CHAR_WIDTH_DEFAULT;
  }
  return (units / 1000) * fontSize;
}

// ============================== 工具函数 ==============================
function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// 保留一位小数,避免属性值过长
function fmt(v) {
  return Number(v.toFixed(1));
}

// 分组标题的基线:使其上下的空白大致相等
function titleBaseline(top, padTop) {
  return top + (padTop + FS_LAYER * 0.7) / 2;
}

// 卡片的各行文字:字符串里的 \n 分隔多行
function cardLines(item) {
  return String(item).split("\n");
}

function lineHeight(i) {
  return (i === 0 ? FS_CARD : FS_CARD_SUB) * 1.28;
}

// 单个卡片:白底圆角矩形与居中文字,多行时整体垂直居中
function renderCard(x, y, w, h, item) {
  const lines = cardLines(item);
  const total = lines.reduce((sum, _, i) => sum + lineHeight(i), 0);
  let cursorY = y + h / 2 - total / 2;
  let text = "";
  for (let i = 0; i < lines.length; i++) {
    text +=
      `<text x="${fmt(x + w / 2)}" y="${fmt(cursorY + lineHeight(i) / 2)}" text-anchor="middle" ` +
      `dominant-baseline="central" font-size="${i === 0 ? FS_CARD : FS_CARD_SUB}" ` +
      `fill="${TEXT}">${esc(lines[i])}</text>`;
    cursorY += lineHeight(i);
  }
  return (
    `<rect x="${fmt(x)}" y="${fmt(y)}" width="${w}" height="${h}" rx="6" ` +
    `fill="${CARD_BG}" stroke="${CARD_BORDER}" stroke-width="1.5"/>${text}`
  );
}

// 卡片高度按行数与各自字号计算,再加上下内边距
function cardHeight(item, padY) {
  return cardLines(item).reduce((sum, _, i) => sum + lineHeight(i), 0) + padY * 2;
}

// 同一行的卡片等高,取该行最高的一张
function rowCardH(row, padY) {
  return Math.max(...row.items.map((item) => cardHeight(item, padY)));
}

// 一行卡片:先按文字宽度确定基准宽,再把剩余宽度均分给各卡片。多行卡片取最宽的一行。
function layoutRow(w, row, gap) {
  const natural = row.items.map((item) => {
    const widest = Math.max(
      ...cardLines(item).map((line, i) => textWidth(line, i === 0 ? FS_CARD : FS_CARD_SUB)),
    );
    return widest + CARD_PAD_X * 2;
  });
  const sum = natural.reduce((a, b) => a + b, 0) + (row.items.length - 1) * gap;
  const surplus = (w - sum) / row.items.length;
  return natural.map((n) => n + surplus);
}

function renderRow(x, y, w, row, opts) {
  const widths = layoutRow(w, row, opts.gap);
  const h = rowCardH(row, opts.padY);
  let out = "";
  let cursor = x;
  for (let i = 0; i < row.items.length; i++) {
    out += renderCard(cursor, y, widths[i], h, row.items[i]);
    cursor += widths[i] + opts.gap;
  }
  return out;
}

function mainLayerH(layer) {
  const rowsH = layer.rows.reduce((sum, row) => sum + rowCardH(row, CARD_PAD_Y), 0);
  return LAYER_PAD_TOP + LAYER_PAD_BOTTOM + rowsH + (layer.rows.length - 1) * ROW_GAP;
}

function sideLayerH(layer) {
  const rowsH = layer.rows.reduce((sum, row) => sum + rowCardH(row, S_CARD_PAD_Y), 0);
  return S_PAD_TOP + S_PAD_BOTTOM + rowsH + (layer.rows.length - 1) * S_ROW_GAP;
}

// ============================== 排版计算 ==============================
const MAIN_X = PAD;
const SIDE_X = PAD + MAIN_W + COL_GAP;
const CONTENT_Y = PAD + TITLE_H;

const MAIN_H = MAIN.reduce((sum, l) => sum + mainLayerH(l), 0) + (MAIN.length - 1) * LAYER_GAP;
// 取整,避免卡片高度带小数时画布出现非整数尺寸
const H = Math.ceil(PAD + TITLE_H + MAIN_H + PAD);

// 图例与三组外部组件组成右栏的四个单元。间距只分配在相邻单元之间(共 3 处),
// 末端不再额外留空,因此最后一组的底边与主干底边对齐,间距也随之变大。
const SIDE_SLOTS = SIDE.length + 1;
const SIDE_SUM = SIDE.reduce((sum, l) => sum + sideLayerH(l), 0) + LEGEND_H;
const SIDE_GAP = (MAIN_H - SIDE_SUM) / (SIDE_SLOTS - 1);

// ============================== 绘制 ==============================
const parts = [];

parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`);
parts.push(
  `<text x="${fmt(W / 2)}" y="${fmt(PAD + 34)}" text-anchor="middle" font-size="${FS_TITLE}" ` +
    `font-weight="700" fill="${TEXT}">${TITLE}</text>`,
);

// 各层容器记录自身的纵向位置与高度,供层间箭头与外部连线定位
const mainTops = {};
let cursorY = CONTENT_Y;
for (const layer of MAIN) {
  mainTops[layer.name] = {y: cursorY, h: mainLayerH(layer)};
  cursorY += mainLayerH(layer) + LAYER_GAP;
}

// 生成前先检查每行是否放得下,放不下时明确报出,避免静默溢出
function checkRowFit(name, row, avail) {
  const needed = row.items.reduce((a, item) => {
    const widest = Math.max(
      ...cardLines(item).map((line, i) => textWidth(line, i === 0 ? FS_CARD : FS_CARD_SUB)),
    );
    return a + widest + CARD_PAD_X * 2;
  }, 0) + (row.items.length - 1) * CARD_GAP;
  if (needed > avail) {
    console.warn(`警告:${name} 的某行内容宽 ${fmt(needed)} 超出可用宽 ${fmt(avail)}`);
  }
}

for (const layer of MAIN) {
  const contentW = MAIN_W - LAYER_PAD_X * 2;
  for (const row of layer.rows) {
    checkRowFit(layer.name, row, row.label ? contentW - ROW_LABEL_W : contentW);
  }
}
for (const layer of SIDE) {
  const contentW = SIDE_W - LAYER_PAD_X * 2;
  for (const row of layer.rows) {
    checkRowFit(layer.name, row, contentW);
  }
}

for (const layer of MAIN) {
  const top = mainTops[layer.name];
  const theme = THEME[layer.theme];
  parts.push(
    `<rect x="${MAIN_X}" y="${fmt(top.y)}" width="${MAIN_W}" height="${top.h}" rx="10" ` +
      `fill="${theme.bg}" stroke="${theme.border}" stroke-width="2"/>`,
  );
  parts.push(
    `<text x="${MAIN_X + S_IDENT}" y="${fmt(titleBaseline(top.y, LAYER_PAD_TOP))}" ` +
      `font-size="${FS_LAYER}" font-weight="700" fill="${TEXT}">${esc(layer.name)}</text>`,
  );

  let rowY = top.y + LAYER_PAD_TOP;
  for (const row of layer.rows) {
    const contentX = MAIN_X + LAYER_PAD_X;
    const contentW = MAIN_W - LAYER_PAD_X * 2;
    const rowH = rowCardH(row, CARD_PAD_Y);
    let itemsX = contentX;
    let itemsW = contentW;
    if (row.label) {
      parts.push(
        `<text x="${contentX}" y="${fmt(rowY + rowH / 2)}" dominant-baseline="central" ` +
          `font-size="${FS_ROW}" font-weight="700" fill="${ROW_TEXT}">${esc(row.label)}</text>`,
      );
      itemsX = contentX + ROW_LABEL_W;
      itemsW = contentW - ROW_LABEL_W;
    }
    parts.push(renderRow(itemsX, rowY, itemsW, row, {gap: CARD_GAP, padY: CARD_PAD_Y}));
    rowY += rowH + ROW_GAP;
  }
}

// 侧栏单元:图例固定在右上角,其余三组自上而下顺次排列
function renderSideLayer(layer, y, h) {
  const theme = THEME[layer.theme];
  let out =
    `<rect x="${SIDE_X}" y="${fmt(y)}" width="${SIDE_W}" height="${h}" rx="10" ` +
    `fill="${theme.bg}" stroke="${theme.border}" stroke-width="2"/>` +
    `<text x="${SIDE_X + S_IDENT}" y="${fmt(titleBaseline(y, S_PAD_TOP))}" ` +
    `font-size="${FS_LAYER}" font-weight="700" fill="${TEXT}">${esc(layer.name)}</text>`;
  let rowY = y + S_PAD_TOP;
  for (const row of layer.rows) {
    out += renderRow(SIDE_X + LAYER_PAD_X, rowY, SIDE_W - LAYER_PAD_X * 2, row, {
      gap: S_CARD_GAP,
      padY: S_CARD_PAD_Y,
    });
    rowY += rowCardH(row, S_CARD_PAD_Y) + S_ROW_GAP;
  }
  return out;
}

function renderLegend(y) {
  // 图例是说明性内容而非架构单元,因此不画背景与边框,以免与右栏三组并列。
  // 文字左对齐、与各组标题对齐,样线右对齐,使两侧各形成一条整齐的边缘。
  let out =
    `<text x="${SIDE_X + S_IDENT}" y="${fmt(titleBaseline(y, S_PAD_TOP))}" ` +
    `font-size="${FS_LAYER}" font-weight="700" fill="${TEXT}">Legend</text>`;
  const sampleRight = SIDE_X + SIDE_W - S_IDENT;
  const sampleLen = 44;
  for (let i = 0; i < LEGEND_ITEMS.length; i++) {
    const item = LEGEND_ITEMS[i];
    const lineY = y + S_PAD_TOP + LEGEND_ROW_H / 2 + i * (LEGEND_ROW_H + LEGEND_ROW_GAP);
    const x1 = sampleRight - sampleLen;
    let stroke = INK;
    let dash = "";
    let markers = "";
    if (item.kind === "call") {
      markers = ' marker-start="url(#arrow)" marker-end="url(#arrow)"';
    } else if (item.kind === "external") {
      stroke = INK_LIGHT;
      dash = ' stroke-dasharray="6 4"';
      markers = ' marker-start="url(#arrow-light)" marker-end="url(#arrow-light)"';
    }
    out +=
      `<path d="M ${x1} ${fmt(lineY)} L ${sampleRight} ${fmt(lineY)}" stroke="${stroke}" ` +
      `stroke-width="2" fill="none" stroke-linecap="round"${dash}${markers}/>` +
      `<text x="${SIDE_X + S_IDENT}" y="${fmt(lineY)}" dominant-baseline="central" ` +
      `font-size="${FS_LEGEND}" fill="${ROW_TEXT}">${esc(item.text)}</text>`;
  }
  return out;
}

let sideY = CONTENT_Y;
const sideTops = [];
parts.push(renderLegend(sideY));
sideY += LEGEND_H + SIDE_GAP;
for (const layer of SIDE) {
  const h = sideLayerH(layer);
  sideTops.push({y: sideY, h: h});
  parts.push(renderSideLayer(layer, sideY, h));
  sideY += h + SIDE_GAP;
}

// ============================== 主干层间关系 ==============================
// 按 FLOWS 的定义绘制。hosts 是容纳关系,用无箭头的细线;call 是双向调用与数据流。
const arrowX = MAIN_X + Math.round(MAIN_W * 0.5);
for (const flow of FLOWS) {
  const from = mainTops[flow.from];
  const to = mainTops[flow.to];
  const y1 = from.y + from.h + 3;
  const y2 = to.y - 3;
  const markers =
    flow.kind === "call" ? ' marker-start="url(#arrow)" marker-end="url(#arrow)"' : "";
  parts.push(
    `<path d="M ${arrowX} ${fmt(y1)} L ${arrowX} ${fmt(y2)}" stroke="${INK}" ` +
      `stroke-width="2" fill="none"${markers}/>`,
  );
}

// ============================== 外部连线 ==============================
// 连线自右栏单元左边出发,经栏间空隙转向主干容器右侧。
//
// 默认走正交折线,垂直段共用栏间空隙的水平中线,视觉上合并成一条纵向主线,
// 每段分别接上不同的水平线。共用同一横坐标的前提是各条线的纵向区间互不重叠,
// 否则垂直段会重叠、并与其他线的水平段相交,所以生成前检查一遍(见下)。
//
// 两个拐角用二次曲线过渡,不用直角。表达式里的符号不能写错:圆弧切点落在水平段的哪一侧
// 由该水平段的走向决定,若一律用加号,线会先向外凸出再折回,落点成为尖角。
//
// 若起止高度相差不大,两次拐弯反而显得局促,此时可给该条线加 straight:
// 直接画一段两端等高的直线段,不占用栏间空隙的竖直主线。
const ELBOW_X = MAIN_X + MAIN_W + COL_GAP / 2;
const ELBOW_RADIUS = 12;

// 三组外部组件都指向 Kernel:接口层并入 Kernel 后,外部组件的对端就是内核本身。
// offset 用于在目标层上错开落点,必须与起点高度保持同序(起点越高、落点越高),
// 否则共用垂直段时两条线的横竖段会相交;offset 还要让纵向区间足够长,
// 因为圆弧半径受区间长度的一半约束,区间过短会把圆弧压得比另两条小。
const EXT_LINKS = [
  {sideIndex: 0, targetLayer: "Kernel (Go)", both: true, offset: -70},
  // Cloud Services 与 Kernel 的纵向位置接近,直线连接比两次拐弯更干净
  {sideIndex: 1, targetLayer: "Kernel (Go)", both: true, straight: true},
  {sideIndex: 2, targetLayer: "Kernel (Go)", both: true, offset: 70},
];

const linkSpans = [];
for (const link of EXT_LINKS) {
  const slot = sideTops[link.sideIndex];
  const fromY = slot.y + slot.h / 2;
  const target = mainTops[link.targetLayer];
  // 直线段对准起点高度,不经过栏间空隙的竖直主线;其余按 offset 在目标层上错开落点
  const toY = link.straight ? fromY : target.y + target.h / 2 + link.offset;
  linkSpans.push({fromY: fromY, toY: toY});

  // 两端都留出空隙:marker-end 的尖端会越出端点 2px,若端点贴在边框上则箭头会压住边框。
  // 起点的处理分两种:有起始箭头的双向线要向右栏一侧内收,否则箭头会压住容器边框;
  // 单向线没有起始箭头,起点直接接在边框上,避免线条与容器脱开。
  const START_INSET = 5;
  const startX = link.both ? SIDE_X - START_INSET : SIDE_X;
  const targetX = MAIN_X + MAIN_W + 6;

  let d;
  if (link.straight) {
    // 落点需落在目标容器内部,太靠近上下边缘会贴着边框
    const margin = 8;
    if (toY < target.y + margin || toY > target.y + target.h - margin) {
      console.warn(
        `警告:${SIDE[link.sideIndex].name} 的直线落点 ${fmt(toY)} 不在 ` +
          `${link.targetLayer} 的可用范围内(${fmt(target.y + margin)}-${fmt(target.y + target.h - margin)})`,
      );
    }
    d = `M ${fmt(startX)} ${fmt(fromY)} L ${targetX} ${fmt(toY)}`;
  } else {
    const sign1 = Math.sign(ELBOW_X - startX);
    const sign2 = Math.sign(targetX - ELBOW_X);
    const dirY = Math.sign(toY - fromY);
    const r = Math.max(
      0,
      Math.min(
        ELBOW_RADIUS,
        Math.abs(ELBOW_X - startX) / 2,
        Math.abs(toY - fromY) / 2,
        Math.abs(targetX - ELBOW_X) / 2,
      ),
    );
    d =
      `M ${fmt(startX)} ${fmt(fromY)} ` +
      `L ${fmt(ELBOW_X - sign1 * r)} ${fmt(fromY)} ` +
      `Q ${fmt(ELBOW_X)} ${fmt(fromY)} ${fmt(ELBOW_X)} ${fmt(fromY + dirY * r)} ` +
      `L ${fmt(ELBOW_X)} ${fmt(toY - dirY * r)} ` +
      `Q ${fmt(ELBOW_X)} ${fmt(toY)} ${fmt(ELBOW_X + sign2 * r)} ${fmt(toY)} ` +
      `L ${targetX} ${fmt(toY)}`;
  }

  parts.push(
    `<path d="${d}" ` +
      `stroke="${INK_LIGHT}" stroke-width="2" fill="none" stroke-dasharray="6 4" ` +
      `marker-end="url(#arrow-light)"${link.both ? ' marker-start="url(#arrow-light)"' : ""}/>`,
  );
}

// 共用垂直段的前提是纵向区间两两不重叠
for (let i = 0; i < linkSpans.length; i++) {
  for (let j = i + 1; j < linkSpans.length; j++) {
    const a = linkSpans[i];
    const b = linkSpans[j];
    const aLo = Math.min(a.fromY, a.toY);
    const aHi = Math.max(a.fromY, a.toY);
    const bLo = Math.min(b.fromY, b.toY);
    const bHi = Math.max(b.fromY, b.toY);
    if (aLo < bHi && bLo < aHi) {
      console.warn(
        `警告:外部连线的纵向区间重叠(${fmt(aLo)}-${fmt(aHi)} 与 ${fmt(bLo)}-${fmt(bHi)}),` +
          `共用垂直段时会相交`,
      );
    }
  }
}

// ============================== 组装 SVG ==============================
const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, " +
  "'PingFang SC', 'Microsoft YaHei', sans-serif";

const svg =
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" ` +
  `font-family="${FONT_STACK}">\n` +
  `<defs>` +
  `<marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" ` +
  `orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${INK}"/></marker>` +
  `<marker id="arrow-light" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" ` +
  `orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${INK_LIGHT}"/></marker>` +
  `</defs>\n` +
  parts.join("\n") +
  `\n</svg>\n`;

// 输出到仓库根目录的 screenshots,路径基于脚本自身位置解析,
// 因此从 app/ 还是从仓库根目录运行都一样。
const outFile = path.resolve(__dirname, "..", "screenshots", "SiYuan_Arch.svg");
fs.writeFileSync(outFile, svg, "utf8");

console.log(`已生成 ${outFile}`);
console.log(`画布 ${W} x ${H},主干高 ${MAIN_H},右栏单元间距 ${fmt(SIDE_GAP)}`);
