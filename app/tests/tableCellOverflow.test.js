const assert = require("node:assert/strict");
const {execFile} = require("node:child_process");
const {mkdtempSync, readFileSync, rmSync} = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {promisify} = require("node:util");
const {fileURLToPath} = require("node:url");

const prepareCell = ({editing, fontSize, align, content, inline = true}) => {
    document.documentElement.style.setProperty("--b3-font-size-editor", `${fontSize}px`);
    document.documentElement.style.setProperty("--b3-font-family-protyle", "Arial, sans-serif");
    const paragraph = editing ?
        `<div class="p" data-node-id="20261115100000-glyph01" data-type="NodeParagraph"><div contenteditable="true">${content}</div></div>` :
        `<div class="p" data-table-cell-node data-type="NodeParagraph"><div data-table-cell-content contenteditable="false">${content}</div></div>`;
    const modifier = inline ? " table__cell--inline" : "";
    const cell = editing ?
        `<div class="table__cell-editor protyle-lite-fragment protyle${modifier}"><div class="protyle-content">` +
        `<div class="protyle-wysiwyg" contenteditable="true">${paragraph}</div></div></div>` :
        `<div class="table__cell-rich${modifier}" contenteditable="false">${paragraph}</div>`;
    document.body.innerHTML = '<div class="protyle" style="width:720px;height:640px;margin:20px">' +
        '<div class="protyle-content"><div class="protyle-wysiwyg">' +
        '<div class="table" data-type="NodeTable" data-node-id="20261115100000-table01">' +
        '<div><table><colgroup><col style="min-width:60px"><col style="min-width:60px"></colgroup>' +
        `<thead><tr><th></th><th style="text-align:${align}">${cell}</th></tr></thead></table></div>` +
        "</div></div></div></div>";
    const table = document.querySelector("table");
    const rect = table.getBoundingClientRect();
    return {x: Math.floor(rect.x), y: Math.floor(rect.y), width: Math.ceil(rect.width), height: Math.ceil(rect.height)};
};

const checkContentLayout = () => {
    const check = require("node:assert/strict");
    const cell = document.querySelector("th:last-child");
    const content = cell.querySelector("[data-table-cell-content], .p > [contenteditable]");
    const range = document.createRange();
    range.selectNodeContents(content);
    const bounds = content.getBoundingClientRect();
    const lines = Array.from(range.getClientRects());
    check.ok(new Set(lines.map(rect => rect.y)).size > 1, "narrow columns still wrap long text");
    check.ok(lines.every(rect => rect.right <= bounds.right + 1 && rect.left >= bounds.left - 1),
        "wrapped text stays within the column");
    const root = cell.querySelector(".protyle-wysiwyg, .table__cell-rich");
    const parentClipping = getComputedStyle(document.querySelector("body > .protyle")).overflowX;
    check.equal(parentClipping, "hidden", "the document editor keeps its clipping boundary");
    root.insertAdjacentHTML("beforeend", '<div class="list" data-type="NodeList"><div class="li" data-type="NodeListItem">' +
        '<div class="p" data-type="NodeParagraph"><div>List item</div></div></div></div>' +
        '<div class="code-block" data-type="NodeCodeBlock"><div class="hljs">' + "long_code_".repeat(80) + "</div></div>" +
        '<div class="render-node" data-type="NodeMathBlock"><div class="katex-display">' +
        '<span style="display:inline-block;width:1200px;height:30px">Formula</span></div></div>' +
        '<div class="p"><img width="1200" height="30" alt="image"></div>');
    const code = root.querySelector(".hljs");
    code.style.whiteSpace = "pre";
    const formula = root.querySelector(".katex-display");
    for (const element of [code, formula]) {
        check.ok(element.scrollWidth > element.clientWidth, "wide content has an internal scroll range");
        element.scrollLeft = 20;
        check.ok(element.scrollLeft > 0, "code and formula scrolling remains functional");
    }
    check.ok(root.querySelector("img").getBoundingClientRect().width <= cell.getBoundingClientRect().width,
        "images remain constrained by the cell");
    const tableBlock = document.querySelector('[data-type="NodeTable"]');
    tableBlock.setAttribute("custom-pinthead", "true");
    const viewport = tableBlock.firstElementChild;
    viewport.style.maxHeight = "60px";
    check.ok(viewport.scrollHeight > viewport.clientHeight);
    viewport.scrollTop = 20;
    check.ok(viewport.scrollTop > 0, "pinned-header tables retain their scrolling viewport");
};

const runElectron = async () => {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.commandLine.appendSwitch("disable-gpu");
    await app.whenReady();
    const win = new BrowserWindow({show: false, width: 1000, height: 800, webPreferences: {
        nodeIntegration: true, contextIsolation: false, offscreen: true, backgroundThrottling: false,
    }});
    let exitCode = 0;
    const evaluate = (fn, value) => win.webContents.executeJavaScript(`(${fn.toString()})(${JSON.stringify(value)})`);
    const capture = async rect => {
        await win.webContents.executeJavaScript("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
        return (await win.webContents.capturePage(rect)).toBitmap();
    };
    try {
        await win.loadURL("data:text/html,<!DOCTYPE html><html><body></body></html>");
        const sass = require("sass");
        for (const entry of ["base", "mobile"]) {
            const stylesheet = sass.compile(path.join(__dirname, `../src/assets/scss/${entry}.scss`), {logger: sass.Logger.silent});
            assert.ok(stylesheet.loadedUrls.some(url => fileURLToPath(url) ===
                path.resolve(__dirname, "../src/assets/scss/protyle/_protyle.scss")), "load the actual cell styles");
            const cssKey = await win.webContents.insertCSS(stylesheet.css);
            for (const theme of ["daylight", "midnight"]) {
                const themeKey = await win.webContents.insertCSS(readFileSync(path.join(__dirname,
                    `../appearance/themes/${theme}/theme.css`), "utf8"));
                for (const editing of [false, true]) {
                    for (const fontSize of [32, 64]) {
                        for (const align of ["left", "center", "right"]) {
                            const label = `${entry}/${theme}/${editing ? "editing" : "preview"}/${fontSize}/${align}`;
                            const rect = await evaluate(prepareCell, {editing, fontSize, align, content: "ɖʐ ɖʐ"});
                            const actual = await capture(rect);
                            const selectors = ".table__cell-rich, .table__cell-editor, .table__cell-editor .protyle-wysiwyg";
                            const visibleKey = await win.webContents.insertCSS(`${selectors} {overflow: visible !important}`);
                            const expected = await capture(rect);
                            await win.webContents.removeInsertedCSS(visibleKey);
                            assert.ok(actual.equals(expected), `${label}: glyph strokes must match the unclipped rendering`);
                            const clippedKey = await win.webContents.insertCSS(`${selectors} {overflow: clip !important}`);
                            const clipped = await capture(rect);
                            await win.webContents.removeInsertedCSS(clippedKey);
                            assert.ok(!clipped.equals(expected), `${label}: the fixture must exercise painted glyph overflow`);
                        }
                    }
                    await evaluate(prepareCell, {editing, fontSize: 32, align: "left", inline: false,
                        content: "Long text wraps within a narrow table cell. ".repeat(5)});
                    await win.webContents.executeJavaScript("document.querySelector('th:last-child').style.width = '180px'");
                    await evaluate(checkContentLayout);
                }
                await win.webContents.removeInsertedCSS(themeKey);
            }
            await win.webContents.removeInsertedCSS(cssKey);
        }
        console.log("Table cell glyph and layout cases passed");
    } catch (error) {
        console.error(error);
        exitCode = 1;
    } finally {
        win.destroy();
        app.exit(exitCode);
    }
};

if (process.versions.electron && process.type === "browser") {
    runElectron().catch(error => {
        console.error(error);
        require("electron").app.exit(1);
    });
} else {
    require("node:test").it("preserves table cell glyph overhang and content layout in desktop and mobile editors", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 120000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-table-cell-overflow-"));
        try {
            const {stdout} = await promisify(execFile)(require("electron"), [__filename, profile],
                {env, windowsHide: true, timeout: 110000});
            assert.match(stdout, /Table cell glyph and layout cases passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-table-cell-overflow-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
