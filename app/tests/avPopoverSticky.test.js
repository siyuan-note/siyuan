const assert = require("node:assert/strict");
const {mkdtempSync, readFileSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {test} = require("node:test");
const sass = require("sass");
const ts = require("typescript");
const {parse} = require("ifdef-loader/preprocessor");

const browserCases = async (sources, css, mobile) => {
    const check = require("node:assert/strict");
    const load = (source, dependencies) => {
        const exports = {};
        new Function("exports", "require", source)(exports, () => dependencies);
        return exports;
    };
    const closest = load(sources[2], {});
    const rows = load(sources[1], {...closest, updateFrozenColumns() {}});
    const move = load(sources[3], {...closest, getTopBarHeight: () => 0, hideAllElements() {}});
    let sequence = 0;
    const panels = load(sources[0], {...closest, ...rows, ...move,
        genUUID: () => String(++sequence), registerBlockPanelOwner() {}, updateHotkeyAfterTip: () => "",
        hideElements() {}, resize() {}, getTopBarHeight: () => 0, Constants: {TIMEOUT_TRANSITION: 0},
        setPosition: (element, x, y) => { element.style.left = x + "px"; element.style.top = y + "px"; },
    });
    window.siyuan = {blockPanels: [], zIndex: 0, languages: {},
        config: {keymap: {general: {closeTab: {custom: ""}}}},
        menus: {menu: {element: document.createElement("div")}},
    };
    const style = document.createElement("style");
    style.textContent = css + `
body {margin:0} .block__popover {transition:none;background:white}
.block__content {min-height:0} .block__edit {flex:0 0 260px;min-height:0}
.protyle-content {flex:1;min-height:0;overflow:auto} .protyle-breadcrumb {height:32px;flex-shrink:0}
.protyle-wysiwyg {padding:0!important} .av {margin:0}
.av__views {height:40px} .av__body {float:left} .av__cell {width:240px}
`;
    document.head.append(style);
    Object.defineProperty(panels.BlockPanel.prototype, "initProtyle", {value(element, after) {
        element.innerHTML = '<div class="protyle-breadcrumb">Mirror</div><div class="protyle-content">' +
            '<div class="protyle-wysiwyg"><div class="av" data-av-type="table" data-render="true">' +
            '<div class="av__container"><div class="av__header"><div class="av__views">Views</div></div>' +
            '<div class="av__scroll"><div class="av__body"><div class="av__row av__row--header">' +
            '<div class="av__cell">Title</div><div class="av__cell">Property</div></div>' +
            Array.from({length: 15}, (_, index) => '<div class="av__row"><div class="av__cell">' +
                index + '</div><div class="av__cell">Value</div></div>').join("") +
            '<div class="av__row av__row--footer"><div class="av__cell av__calc--ashow">Count</div></div>' +
            "</div></div></div></div></div></div>";
        const protyle = {element, contentElement: element.querySelector(".protyle-content"),
            wysiwyg: {element: element.querySelector(".protyle-wysiwyg")},
            scroll: {element: document.createElement("div")}};
        element.append(protyle.scroll.element);
        this.editors.push({protyle, destroy() {}});
        after?.();
    }});
    const panel = new panels.BlockPanel({app: {}, refDefs: [{refID: "one"}, {refID: "two"}],
        isBacklink: false, x: 100, y: 60});
    window.siyuan.blockPanels.push(panel);
    Object.assign(panel.element.style, {width: "360px", height: "340px", maxHeight: "none"});
    const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await frame();
    const content = panel.element.querySelector(".block__content");
    const first = panel.editors[0].protyle;
    const second = panel.editors[1].protyle;
    const header = protyle => protyle.wysiwyg.element.querySelector(".av__row--header");
    const views = protyle => protyle.wysiwyg.element.querySelector(".av__views");
    const aligned = protyle => {
        const top = protyle.contentElement.getBoundingClientRect().top;
        check.ok(Math.abs(views(protyle).getBoundingClientRect().top - top) <= 1, "toolbar follows its editor");
        check.ok(Math.abs(header(protyle).getBoundingClientRect().top - top - views(protyle).offsetHeight) <= 1,
            "header follows its editor and toolbar");
        const cells = protyle.wysiwyg.element.querySelectorAll(".av__row:not(.av__row--header):not(.av__row--footer) .av__cell");
        check.ok(Math.abs(header(protyle).firstElementChild.getBoundingClientRect().left - cells[0].getBoundingClientRect().left) <= 1,
            "header remains aligned horizontally");
    };
    for (const protyle of [first, second]) {
        protyle.contentElement.scrollTop = 120;
        rows.stickyRow(protyle.wysiwyg.element.querySelector(".av"), protyle.contentElement, "all");
        check.ok(header(protyle).classList.contains("av__row--header--fixed"));
        aligned(protyle);
    }
    for (const offset of [80, 180, 0, 120]) {
        content.scrollTop = offset;
        await frame();
        aligned(first);
        aligned(second);
        for (const protyle of [first, second]) {
            const bounds = content.getBoundingClientRect();
            for (const fixed of protyle.wysiwyg.element.querySelectorAll(".av__views--fixed, .av__row--header--fixed, .av__row--footer--fixed")) {
                const rect = fixed.getBoundingClientRect();
                const clip = getComputedStyle(fixed).clipPath.match(/-?[\d.]+/g).map(Number);
                check.ok(rect.top + clip[0] >= bounds.top - 1, "fixed rows stay below the outer viewport top");
                check.ok(rect.bottom - (clip[2] ?? clip[0]) <= bounds.bottom + 1, "fixed rows stay above the outer viewport bottom");
            }
        }
    }
    const horizontal = first.wysiwyg.element.querySelector(".av__scroll");
    horizontal.scrollLeft = 80;
    horizontal.dispatchEvent(new Event("scroll"));
    aligned(first);
    const drag = (handle, dy) => {
        const rect = handle.getBoundingClientRect();
        handle.dispatchEvent(new MouseEvent("mousedown", {bubbles: true, clientX: rect.left + 10, clientY: rect.top + 2}));
        document.dispatchEvent(new MouseEvent("mousemove", {bubbles: true, clientX: rect.left + 10, clientY: rect.top + 2 + dy}));
        document.dispatchEvent(new MouseEvent("mouseup", {bubbles: true}));
    };
    if (!mobile) {
        const previousHeight = first.element.offsetHeight;
        drag(panel.element.querySelector(".block__edit-resize"), -30);
        await frame();
        check.ok(first.element.offsetHeight < previousHeight, "the editor resize handle changes the layout");
        aligned(first);
        aligned(second);
        const previousTop = panel.element.offsetTop;
        drag(panel.element.querySelector(".resize__move"), 30);
        await frame();
        check.ok(panel.element.offsetTop > previousTop, "the panel moves");
        aligned(first);
        aligned(second);
    }
    content.dispatchEvent(new Event("scroll"));
    panel.destroy();
    await frame();
    check.equal(document.querySelector(".block__popover"), null);
    return "Mirror popover sticky layout passed";
};

const runElectron = async () => {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.commandLine.appendSwitch("disable-gpu");
    await app.whenReady();
    const win = new BrowserWindow({show: false, width: 900, height: 800,
        webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    try {
        for (const mobile of [false, true]) {
            const sources = ["src/block/Panel.ts", "src/protyle/render/av/row.ts",
                "src/protyle/util/hasClosest.ts", "src/dialog/moveResize.ts"].map(file => ts.transpileModule(
                parse(readFileSync(path.join(__dirname, "..", file), "utf8"), {MOBILE: mobile, BROWSER: true}, false, true), {
                    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021},
                }).outputText);
            const css = sass.compile(path.join(__dirname, `../src/assets/scss/${mobile ? "mobile" : "base"}.scss`), {
                logger: sass.Logger.silent,
            }).css;
            await win.loadURL("about:blank");
            assert.equal(await win.webContents.executeJavaScript(
                `(${browserCases.toString()})(${JSON.stringify(sources)},${JSON.stringify(css)},${mobile})`), "Mirror popover sticky layout passed");
        }
        console.log("Mirror popover sticky layout passed");
        win.destroy();
        app.exit(0);
    } catch (error) {
        console.error(error);
        win.destroy();
        app.exit(1);
    }
};

if (process.versions.electron && process.type === "browser") {
    runElectron().catch(error => { console.error(error); require("electron").app.exit(1); });
} else {
    test("mirror popover headers track outer scrolling, editor resizing and moving, with desktop and mobile clipping", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 45000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-popover-sticky-"));
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 40000});
            assert.match(stdout, /Mirror popover sticky layout passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-popover-sticky-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
