const assert = require("node:assert/strict");
const {mkdtempSync, readFileSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {runInNewContext} = require("node:vm");
const {transpileModule, ModuleKind, ScriptTarget} = require("typescript");
const sass = require("sass");

const renderHeader = (mobile, viewName = "Table") => {
    const api = {};
    const context = {
        exports: api,
        window: {siyuan: {languages: {_kernel: {}, new: "新建"}, config: {editor: {spellcheck: false}}}},
    };
    const compile = file => transpileModule(readFileSync(path.join(__dirname, file), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText;
    runInNewContext(compile("../src/protyle/render/av/headerEditing.ts"), context);
    const modules = {
        "../../../util/escape": {escapeAriaLabel: value => value, escapeAttr: value => value, escapeHtml: value => value,
            escapeHtmlTextAndAttr: value => value},
        "../../../util/functions": {isMobile: () => mobile},
        "./view": {getFieldsByData: () => [], getViewIcon: () => "iconTable"},
        "./viewVisibility": {getAVVisibleViewIDs: () => ["view"], serializeAVViewPageSizes: () => "{}"},
        "./headerEditing": {getAVHeaderEditingState: api.getAVHeaderEditingState},
        "./contextFilterState": {getContextFilterKeyID: () => ""},
    };
    runInNewContext(compile("../src/protyle/render/av/render.ts"), {
        ...context, require: name => modules[name] || {},
    });
    return api.genTabHeaderHTML({
        name: "Database", viewID: "view", views: [{id: "view", type: "table", name: viewName}],
        view: {filters: [], sorts: [{column: "primary", order: "ASC"}]},
    }, false, false, {classList: {contains: () => true}, hasAttribute: () => true});
};

const browserCases = (css, header, mobile) => {
    const check = require("node:assert/strict");
    document.head.innerHTML = "<style></style>";
    document.head.firstElementChild.textContent = css;
    for (const size of [16, 28]) {
        for (const state of ["locked", "preview", "editable"]) {
            document.body.innerHTML = `<div class="protyle-wysiwyg" ${state === "preview" ? "" : 'contenteditable="true"'}
                ${state === "locked" ? 'data-readonly="true"' : ""} style="font-size:${size}px">
                <div class="av"><div class="av__container">${header}</div></div></div>`;
            const sort = document.querySelector('[data-type="av-sort"]');
            const search = document.querySelector('[data-type="av-search-icon"]');
            const filter = document.querySelector('[data-type="av-filter"]');
            const spacer = sort.nextElementSibling;
            check.notEqual(getComputedStyle(search).display, "none");
            check.notEqual(getComputedStyle(sort).display, "none");
            check.equal(getComputedStyle(filter).display === "none", state !== "editable");
            const gap = search.getBoundingClientRect().left - sort.getBoundingClientRect().right;
            check.equal(gap, mobile ? 4 : 8, `${state}/${size}: sorting and search have independent hit targets`);
            check.equal(getComputedStyle(spacer).display === "none", mobile);
            if (state !== "editable") {
                for (const other of document.querySelectorAll(".av__views > .fn__space")) {
                    if (other !== spacer) {
                        check.equal(getComputedStyle(other).display, "none", "hidden controls leave no empty gaps");
                    }
                }
            }
        }
    }
    if (mobile) {
        for (const size of [16, 28]) {
            document.body.innerHTML = `<div class="protyle-wysiwyg" contenteditable="true" style="font-size:${size}px;padding:0 24px">
                <div class="av"><div class="av__container">${header}</div></div></div>`;
            const toolbar = document.querySelector(".av__views");
            const view = toolbar.querySelector(".av__mobile-view");
            const create = toolbar.querySelector(".av__new");
            check.ok(view.getBoundingClientRect().width >= 64, "view switching keeps its touch target");
            const center = element => {
                const rect = element.getBoundingClientRect();
                return rect.top + rect.height / 2;
            };
            for (const control of toolbar.querySelectorAll(":scope > .block__icon, :scope > .av__new")) {
                if (getComputedStyle(control).display !== "none") {
                    check.ok(Math.abs(center(control) - center(view)) < 1, `${size}: toolbar actions stay on one line`);
                }
            }
            const container = document.querySelector(".av__container");
            container.scrollLeft = container.scrollWidth;
            check.ok(create.getBoundingClientRect().right <= container.getBoundingClientRect().right + 1,
                `${size}: the new-item buttons remain reachable`);
            if (size === 16) {
                if (container.clientWidth >= 340) {
                    check.ok(container.scrollWidth <= container.clientWidth + 1, "normal text fits without scrolling");
                }
                const label = view.querySelector("span");
                check.ok(label.scrollWidth > label.clientWidth, "long view names are truncated");
            }
            toolbar.classList.add("av__views--search");
            check.equal(getComputedStyle(create).display, "none");
            check.equal(getComputedStyle(view).display, "none");
            check.equal(getComputedStyle(toolbar.querySelector(".av__search")).display, "flex");
            check.equal(getComputedStyle(toolbar.querySelector(".av__search-close")).display, "flex");
        }
    }
    return "Database toolbar layout passed";
};

if (process.versions.electron && process.type === "browser") {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.whenReady().then(async () => {
        const win = new BrowserWindow({show: false, webPreferences: {
            nodeIntegration: true, contextIsolation: false, offscreen: true,
        }});
        try {
            for (const name of ["base", "mobile"]) {
                const styles = sass.compile(path.join(__dirname, `../src/assets/scss/${name}.scss`), {
                    logger: sass.Logger.silent,
                }).css;
                const header = renderHeader(name === "mobile", "域名费用账单和更多条目");
                for (const theme of ["daylight", "midnight"]) {
                    const css = readFileSync(path.join(__dirname, `../appearance/themes/${theme}/theme.css`), "utf8") + styles;
                    for (const width of name === "mobile" ? [320, 393, 420] : [1000, 420]) {
                        win.setSize(width, 800);
                        await win.loadURL("data:text/html,<html><body></body></html>");
                        const result = await win.webContents.executeJavaScript(
                            `(() => { try { return (${browserCases.toString()})(${JSON.stringify(css)}, ${JSON.stringify(header)}, ${name === "mobile"}); } catch (error) { return error.stack; } })()`);
                        assert.equal(result, "Database toolbar layout passed", `${name}/${theme}/${width}`);
                    }
                }
            }
            console.log("Database toolbar layout passed");
            app.exit(0);
        } catch (error) {
            console.error(error);
            app.exit(1);
        }
    }).catch(error => { console.error(error); app.exit(1); });
} else {
    require("node:test").test("database toolbars preserve action spacing and keep mobile creation on one line", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 60000,
    }, async () => {
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-av-toolbar-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 55000});
            assert.match(stdout, /Database toolbar layout passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-av-toolbar-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
