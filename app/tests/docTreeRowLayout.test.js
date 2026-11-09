const assert = require("node:assert/strict");
const {mkdtempSync, readFileSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {test} = require("node:test");
const sass = require("sass");
const ts = require("typescript");

const rowSource = ts.transpileModule(readFileSync(path.join(__dirname, "../src/layout/dock/docTree/row.ts"), "utf8"), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021},
}).outputText;
const stylesheets = ["../src/assets/scss/base.scss", "../src/assets/scss/mobile.scss"];

const browserCases = (source, css, mobile) => {
    const check = require("node:assert/strict");
    document.head.innerHTML = "<style>" + css + "</style>";
    window.siyuan = {config: {fileTree: {docIconClickMode: 1}}, languages: {_kernel: {275: "Upgrade SiYuan"}}, notebooks: []};
    const exports = {};
    new Function("exports", "require", source)(exports, () => ({
        escapeHtml: value => value, escapeHtmlTextAndAttr: value => value, escapeTooltipTextAttr: value => value,
        getDocDisplayName: value => value, genFileTreeDocAriaLabel: () => "", getFileTreeIconHTML: () => "A",
        getFileTreeDefaultIconAttr: () => "", getPublishAccessOptionByLevel: () => ({iconHTML: "A"}),
        getTreeItemTailHTML: (count, actions) => count + actions,
    }));
    const step = mobile ? 30 : 24;
    const size = mobile ? 32 : 22;
    for (const pinned of [false, true]) {
        const container = document.createElement("ul");
        container.innerHTML = exports.renderDocTreeRowHTML({
            id: "future", notebookId: "box", occurrenceKey: "box/future", depth: 0,
            kind: "document", name: "Future", subFileCount: 1, file: {specTooNew: true},
        }, {mobile, pinned});
        const placeholder = container.firstElementChild;
        check.equal(placeholder.draggable, false);
        check.equal(placeholder.getAttribute("aria-disabled"), "true");
        check.equal(placeholder.dataset.specTooNew, "true");
        check.ok(placeholder.classList.contains("file-tree__row--spec-too-new"));
        check.equal(placeholder.querySelector(".b3-list-item__text").getAttribute("aria-label"), "Upgrade SiYuan");
        check.equal(placeholder.querySelector(".b3-list-item__toggle").classList.contains("fn__hidden"), false,
            "a placeholder with children keeps its expand arrow");
        for (const width of [240, 420]) {
            for (const fontSize of [14, 24]) {
                document.body.style.fontSize = fontSize + "px";
                document.body.innerHTML = `<div class="file-tree" style="width:${width}px"><ul class="b3-list b3-list--background${mobile ? " b3-list--mobile" : ""}"></ul></div>`;
                const list = document.querySelector("ul");
                for (let depth = 0; depth < 4; depth++) {
                    const root = !pinned && depth === 0;
                    list.insertAdjacentHTML("beforeend", exports.renderDocTreeRowHTML({
                        id: "doc" + depth, notebookId: "box", occurrenceKey: "key" + depth, depth,
                        kind: root ? "notebook" : "document", name: "A very long document title ".repeat(10),
                        notebook: {id: "box"}, subFileCount: 1,
                    }, {mobile, pinned}));
                }
                const rows = [...list.children];
                const arrowLeft = row => row.querySelector(".b3-list-item__arrow").getBoundingClientRect().left;
                rows.forEach((row, depth) => {
                    const toggle = row.querySelector(".b3-list-item__toggle");
                    const toggleBounds = toggle.getBoundingClientRect();
                    check.equal(toggle.style.paddingLeft, "", "indentation comes from CSS");
                    check.equal(toggleBounds.width, depth * step + size);
                    check.equal(toggleBounds.height, mobile ? 40 : 22);
                    if (depth) {
                        check.equal(arrowLeft(row) - arrowLeft(rows[depth - 1]), step,
                            "notebook, document and pinned levels use the same increment");
                    }
                    row.classList.add("dragover__top");
                    check.equal(parseFloat(getComputedStyle(row, "::after").left), toggleBounds.width);
                    const text = row.querySelector(".b3-list-item__text");
                    check.equal(getComputedStyle(text).textOverflow, "ellipsis");
                    const contentRange = document.createRange();
                    contentRange.selectNodeContents(text);
                    check.ok(contentRange.getBoundingClientRect().height > text.clientHeight,
                        "long titles remain clipped inside the available row width");
                    if (!mobile) {
                        const bounds = row.getBoundingClientRect();
                        const hit = document.elementFromPoint(bounds.left + 2, bounds.top + bounds.height / 2);
                        check.equal(hit.closest(".b3-list-item__toggle"), toggle,
                            "the left edge remains part of the collapse target");
                    }
                });
                rows.forEach(row => row.style.setProperty("--file-tree-indent", "18px"));
                check.equal(arrowLeft(rows[1]) - arrowLeft(rows[0]), 18,
                    "theme overrides change the first and subsequent increments together");
                list.insertAdjacentHTML("beforeend", '<li class="b3-list-item"><span class="b3-list-item__toggle"><svg class="b3-list-item__arrow"></svg></span></li>');
                check.equal(list.lastElementChild.firstElementChild.getBoundingClientRect().width, mobile ? 20 : 18,
                    "other lists retain their toggle dimensions");
            }
        }
    }
    return "Document tree row layout passed";
};

if (process.versions.electron && process.type === "browser") {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.whenReady().then(async () => {
        const win = new BrowserWindow({show: false, width: 800, height: 900,
            webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
        win.webContents.on("console-message", event => console.error(event.message));
        try {
            for (const [index, entry] of stylesheets.entries()) {
                const css = sass.compile(path.join(__dirname, entry), {logger: sass.Logger.silent}).css;
                for (const theme of ["daylight", "midnight"]) {
                    const themed = readFileSync(path.join(__dirname, `../appearance/themes/${theme}/theme.css`), "utf8") + css;
                    await win.loadURL("data:text/html,<html><body></body></html>");
                    assert.equal(await win.webContents.executeJavaScript(
                        `try { (${browserCases.toString()})(${JSON.stringify(rowSource)},${JSON.stringify(themed)},${index === 1}) } catch (error) { console.error(error.stack); throw error; }`),
                    "Document tree row layout passed");
                }
            }
            console.log("Document tree row layout passed");
            app.exit(0);
        } catch (error) {
            console.error(error);
            app.exit(1);
        }
    });
} else {
    test("document tree placeholders, indentation, collapse targets and drop indicators work on desktop and mobile", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 45000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-doc-tree-row-"));
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 40000});
            assert.match(stdout, /Document tree row layout passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-doc-tree-row-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
