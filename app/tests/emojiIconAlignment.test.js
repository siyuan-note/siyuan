// 校验 emoji 图标槽与「相邻文字的视觉中心」对齐。
// 图标旁边是文字，因此参照物是文字墨迹中心，而不是图标框中心：
// 中文在 14px/28px 行盒里的墨迹中心比行盒中心高约 1.25px，若只让字形居中于图标框，看起来仍然偏低。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const root = path.resolve(__dirname, "..");
const GLYPH = "\u{1F4C4}";
const TEXT = "\u6587\u6863";
const TREE_ICONS = {file: "1f4c4", notebook: "1f5c3", lock: "1f512", rocket: "1f680", person: "1f9d1"};
// 以 2 倍设备像素比采样，把 1x 抗锯齿带来的 1px 量化误差降到 0.5px 以内
const SCALE = 2;
// 与相邻文字对齐的容差；未标定的平台（内置 Noto 分支）放宽
const TEXT_TOLERANCE = 0.75;
const UNCALIBRATED_TOLERANCE = 1.5;
// 独立格子里没有文字可参照，度量按文字对齐标定后会略微上移，这里只限制在可见范围内
const STANDALONE_TOLERANCE = 2;

const icon = () => `<span class="b3-list-item__icon" id="icon">${GLYPH}</span>`;
const text = (className) => `<span class="${className}" id="text">${TEXT}</span>`;

// 每个图标位使用最贴近真实标记的结构；reference 指明该位置的对齐参照物
const SITES = [
    {name: "document tree icon", reference: "text",
        markup: `<div class="file-tree sy__file"><ul class="b3-list"><li class="b3-list-item" id="row">
            ${icon()}${text("b3-list-item__text")}</li></ul></div>`},
    {name: "document tree graphic", reference: "text",
        markup: `<ul class="b3-list"><li class="b3-list-item" id="row">
            <span class="b3-list-item__graphic" id="icon">${GLYPH}</span>
            ${text("b3-list-item__text")}</li></ul>`},
    {name: "tab icon", reference: "text",
        markup: `<div class="layout-tab-bar"><div class="item" id="row">
            <span class="item__icon" id="icon">${GLYPH}</span>
            ${text("item__text")}</div></div>`},
    {name: "hint emoji", reference: "text",
        markup: `<div class="b3-menu"><button class="b3-menu__item" id="row">
            <span class="b3-menu__emoji" id="icon">${GLYPH}</span>
            ${text("b3-menu__label")}</button></div>`},
    {name: "database cell icon", reference: "text",
        markup: `<div class="av"><div class="av__row"><div class="av__cell av__cell--header" id="row">
            <span class="av__cellheadericon" id="icon">${GLYPH}</span>
            ${text("av__celltext")}</div></div></div>`},
    {name: "mobile tab icon", reference: "text", entry: "mobile",
        markup: `<div class="mobile-tabs"><div class="mobile-tabs__item" id="row">
            <span class="mobile-tabs__item-icon" id="icon">${GLYPH}</span>
            ${text("mobile-tabs__item-title")}</div></div>`},
    {name: "emoji picker cell", reference: "box",
        markup: `<div class="emojis"><div class="emojis__content" id="row">
            <button class="emojis__item" id="icon">${GLYPH}</button></div></div>`},
    {name: "emoji category icon", reference: "box",
        markup: `<div class="emojis"><div class="emojis__types" id="row">
            <button class="emojis__type" id="icon">${GLYPH}</button></div></div>`},
    {name: "document background icon", reference: "box",
        markup: `<div class="protyle-background" id="row">
            <span class="protyle-background__icon" id="icon">${GLYPH}</span></div>`},
];

const getFileTreeIconHTML = (iconValue, defaultIcon, className = "", needSpan = false, useSVGDefaultIcon) => {
    const ts = require("typescript");
    globalThis.window = {siyuan: {config: {fileTree: {useSVGDefaultIcon: false}},
        storage: {"local-images": {note: TREE_ICONS.notebook, folder: "1f4d1", file: TREE_ICONS.file}}}};
    // 该测试只关心几何对齐，Sanitize 用直通实现即可。
    globalThis.Lute = {Sanitize: html => html};
    const modules = {"../constants": {Constants: {LOCAL_IMAGES: "local-images"}}};
    for (const [name, file] of [["../util/escape", "src/util/escape.ts"], ["./iconValue", "src/emoji/iconValue.ts"],
        ["fileTree", "src/emoji/fileTreeIcon.ts"]]) {
        const exports = {};
        new Function("exports", "require", ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
            compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021},
        }).outputText)(exports, id => modules[id]);
        modules[name] = exports;
    }
    return modules.fileTree.getFileTreeIconHTML(iconValue, defaultIcon, className, needSpan, useSVGDefaultIcon);
};

// 文字必须使用与产品相同的字体栈，否则测到的文字墨迹中心没有参考价值
const themeVars = () => fs.readFileSync(path.join(root, "appearance/themes/daylight/theme.css"), "utf8")
    .match(/--b3-font-family[-a-z]*: [^;]+;/g).join(" ");

const buildPage = ({css, fontStyle, servePath, body, rowClass = ""}) => {
    // Emojis Additional 只补充 Unicode 17 新增码位，不覆盖图标字符。它在 file:// 离屏页面里会被错误地
    // 分配给图标文本且不绘制（产品由 HTTP 提供字体，不存在此情况），因此测试页排除该 face。
    const fontCSS = fontStyle("windows11", servePath)
        .replace(/@font-face \{[^}]*font-family: "Emojis Additional";[^}]*\}/, "");
    return `<!doctype html><meta charset="utf-8">
<style>${fontCSS}</style>
<style>:root { ${themeVars()} }</style>
<style>${css}</style>
<style>
body { margin: 0; padding: 20px; background: #808080; font-size: 14px; }
.file-tree { width: 320px; }
.measure-list { width: 220px; }
${rowClass}
</style>
<body class="body--windows">${body}</body>`;
};

const inkIn = (bitmap, size, fromX, toX, fromY, toY) => {
    let minY = toY, maxY = -1;
    for (let y = fromY; y < toY; y++) {
        for (let x = fromX; x < toX; x++) {
            const offset = (y * size.width + x) * 4;
            if (Math.abs(bitmap[offset + 2] - 128) + Math.abs(bitmap[offset + 1] - 128) +
                Math.abs(bitmap[offset] - 128) > 40) {
                if (y < minY) {
                    minY = y;
                }
                if (y > maxY) {
                    maxY = y;
                }
            }
        }
    }
    assert.ok(maxY >= 0, "icon ink is rendered");
    return {top: minY / SCALE, bottom: maxY / SCALE, center: (minY + maxY) / SCALE / 2};
};

const measure = async (win, selector) => {
    const geometry = await win.webContents.executeJavaScript(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) { return null; }
      const rect = element.getBoundingClientRect();
      return {x: rect.x, y: rect.y, width: rect.width, height: rect.height,
        fontFamily: getComputedStyle(element).fontFamily,
        fontSize: getComputedStyle(element).fontSize,
        childTag: element.firstElementChild && element.firstElementChild.tagName};
    })()`);
    assert.ok(geometry, `${selector} exists`);
    return {...geometry, selector};
};

const inkOf = (bitmap, size, geometry) => inkIn(bitmap, size,
    Math.round(geometry.x * SCALE), Math.round((geometry.x + geometry.width) * SCALE),
    Math.round(geometry.y * SCALE), Math.round((geometry.y + geometry.height) * SCALE));

const runElectron = async () => {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", path.join(process.argv[2], "profile"));
    app.commandLine.appendSwitch("disable-gpu");
    app.commandLine.appendSwitch("force-device-scale-factor", String(SCALE));
    await app.whenReady();
    const win = new BrowserWindow({show: false, width: 900, height: 900,
        webPreferences: {nodeIntegration: true, contextIsolation: false}});
    try {
        const ts = require("typescript");
        const fontModule = {};
        new Function("exports", ts.transpileModule(fs.readFileSync(path.join(root, "src/util/emojiFont.ts"), "utf8"), {
            compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
        }).outputText)(fontModule);
        const baseCSS = require("sass").compile(path.join(root, "src/assets/scss/base.scss"),
            {logger: {warn() {}, debug() {}}}).css;
        const mobileCSS = require("sass").compile(path.join(root, "src/assets/scss/mobile.scss"),
            {logger: {warn() {}, debug() {}}}).css;
        // 内置字体需与产品一样可加载：主题里 Emojis Additional 排在最前，加载失败会让整段图标不渲染
        const notoSource = path.join(root, "appearance/fonts/Noto-COLRv1-2.051/Noto-COLRv1.woff2");
        const notoTarget = path.join(process.argv[2], "appearance/fonts/Noto-COLRv1-2.051/Noto-COLRv1.woff2");
        fs.mkdirSync(path.dirname(notoTarget), {recursive: true});
        fs.copyFileSync(notoSource, notoTarget);
        const servePath = "file:///" + process.argv[2].replace(/\\/g, "/") + "/";
        const load = async page => {
            const htmlPath = path.join(process.argv[2], "page.html");
            fs.writeFileSync(htmlPath, page);
            await win.loadFile(htmlPath);
            await win.webContents.executeJavaScript(`document.fonts.ready.then(() => Promise.all([
                document.fonts.load('12px "Emojis Icon"'), document.fonts.load('14px "Emojis Icon"'),
                document.fonts.load('16px "Emojis Icon"'), document.fonts.load('19px "Emojis Icon"'),
                document.fonts.load('20px "Emojis Icon"'), document.fonts.load('68px "Emojis Icon"')]))
                .then(() => new Promise(resolve => requestAnimationFrame(() =>
                    requestAnimationFrame(() => setTimeout(resolve, 80)))))`);
        };

        // 文档树图标：逐字形核对与文字的对齐，并确认图片/SVG 图标不受影响
        for (const [platform, tolerance] of [["windows11", TEXT_TOLERANCE], ["other", UNCALIBRATED_TOLERANCE]]) {
            for (const fontSize of [14, 16]) {
                const rows = Object.entries(TREE_ICONS).map(([name, value]) =>
                    `<li class="b3-list-item" id="row-${name}">
                        <span class="b3-list-item__icon" id="icon-${name}">${
                            getFileTreeIconHTML(value, name === "notebook" ? "notebook" : "file")}</span>
                        <span class="b3-list-item__text" id="text-${name}">${TEXT}</span></li>`);
                rows.push(`<li class="b3-list-item" id="row-image">
                    <span class="b3-list-item__icon" id="icon-image">${getFileTreeIconHTML("b3log.png", "file")}</span>
                    <span class="b3-list-item__text" id="text-image">${TEXT}</span></li>`);
                rows.push(`<li class="b3-list-item" id="row-svg">
                    <span class="b3-list-item__icon" id="icon-svg">${
                        getFileTreeIconHTML("", "file", "", false, true)}</span>
                    <span class="b3-list-item__text" id="text-svg">${TEXT}</span></li>`);
                await load(buildPage({css: baseCSS, fontStyle: () => fontModule.getEmojiFontStyle(platform, servePath),
                    servePath, body: `<div class="file-tree sy__file"><ul class="b3-list measure-list">${
                        rows.join("")}</ul></div>`,
                    rowClass: `.measure-list .b3-list-item__icon { font-size: ${fontSize}px; }`}));
                const image = await win.webContents.capturePage();
                const size = image.getSize();
                const bitmap = image.getBitmap();
                for (const name of [...Object.keys(TREE_ICONS), "image", "svg"]) {
                    const iconBox = await measure(win, `#icon-${name}`);
                    if (name === "image" || name === "svg") {
                        // 图片与 SVG 图标是替换元素，按 16px 居中，不参与墨迹对齐
                        const child = await win.webContents.executeJavaScript(`(() => {
                          const button = document.getElementById("icon-${name}").firstElementChild;
                          const box = button.getBoundingClientRect();
                          const parent = document.getElementById("icon-${name}").getBoundingClientRect();
                          return {tag: button.tagName, width: box.width, height: box.height, top: box.y - parent.y};
                        })()`);
                        assert.equal(child.tag, name === "image" ? "IMG" : "svg");
                        assert.equal(child.width, 16);
                        assert.equal(child.height, 16);
                        assert.ok(Math.abs(child.top - (iconBox.height - 16) / 2) <= 0.5,
                            `${name} graphic must stay centered`);
                        continue;
                    }
                    // emoji 字形不应被包裹，也不应依赖 transform 做几何补偿
                    assert.equal(iconBox.childTag, null, `${name}: emoji glyph must not be wrapped`);
                    const textBox = await measure(win, `#text-${name}`);
                    const iconInk = inkOf(bitmap, size, iconBox);
                    const textInk = inkOf(bitmap, size, textBox);
                    const delta = iconInk.center - textInk.center;
                    console.log(`${platform}/${fontSize}px ${name}: ink ${iconInk.top.toFixed(1)}..` +
                        `${iconInk.bottom.toFixed(1)} text center ${textInk.center.toFixed(2)} delta ${delta.toFixed(2)}px`);
                    assert.ok(Math.abs(delta) <= tolerance,
                        `${platform}/${fontSize}px ${name}: emoji ink center is ${delta.toFixed(2)}px ` +
                        "off the adjacent text ink center");
                }
            }
        }

        // 其余图标位：单独成页，避免依赖滚动
        for (const site of SITES) {
            await load(buildPage({css: site.entry === "mobile" ? mobileCSS : baseCSS,
                fontStyle: () => fontModule.getEmojiFontStyle("windows11", servePath),
                servePath, body: site.markup}));
            const image = await win.webContents.capturePage();
            const size = image.getSize();
            const bitmap = image.getBitmap();
            const iconBox = await measure(win, "#icon");
            assert.ok(iconBox.fontFamily.includes('"Emojis Icon"'),
                `${site.name}: must use the icon emoji font, got ${iconBox.fontFamily}`);
            assert.equal(iconBox.childTag, null, `${site.name}: emoji glyph must not be wrapped`);
            const iconInk = inkOf(bitmap, size, iconBox);
            if (site.reference === "text") {
                const textInk = inkOf(bitmap, size, await measure(win, "#text"));
                const delta = iconInk.center - textInk.center;
                console.log(`${site.name}: ${iconBox.fontSize} delta vs text ${delta.toFixed(2)}px`);
                assert.ok(Math.abs(delta) <= TEXT_TOLERANCE,
                    `${site.name}: emoji ink center is ${delta.toFixed(2)}px off the adjacent text ink center`);
            } else {
                const boxCenter = iconBox.y + iconBox.height / 2;
                const delta = iconInk.center - boxCenter;
                console.log(`${site.name}: ${iconBox.fontSize} delta vs box center ${delta.toFixed(2)}px`);
                // 度量按「与文字对齐」标定，独立格子会略微上移，这是已知取舍
                assert.ok(Math.abs(delta) <= STANDALONE_TOLERANCE,
                    `${site.name}: emoji ink center is ${delta.toFixed(2)}px off the icon box center`);
            }
        }
        app.exit(0);
    } catch (error) {
        console.error(error);
        app.exit(1);
    }
};

if (process.versions.electron && process.type === "browser") {
    runElectron().catch(error => { console.error(error); require("electron").app.exit(1); });
} else {
    require("node:test").it("aligns emoji ink with adjacent text in every icon slot", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 240000,
    }, async () => {
        const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-emoji-icon-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, temporary], {env, windowsHide: true, timeout: 230000});
        } finally {
            assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(temporary).startsWith("siyuan-emoji-icon-"));
            fs.rmSync(temporary, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
