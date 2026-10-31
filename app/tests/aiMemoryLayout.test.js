const assert = require("node:assert/strict");
const {mkdtempSync, readFileSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {test} = require("node:test");
const {runInNewContext} = require("node:vm");
const {ModuleKind, transpileModule} = require("typescript");
const sass = require("sass");

const memoryHTML = mobile => {
    const languages = JSON.parse(readFileSync(path.join(__dirname, "../appearance/langs/zh-CN.json"), "utf8"));
    const compile = file => transpileModule(readFileSync(path.join(__dirname, file), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText;
    const fragments = {};
    runInNewContext(compile("../src/config/render/fragments.ts"), {exports: fragments});
    const exported = {};
    runInNewContext(compile("../src/config/tabs/ai/aiMemory.ts"), {
        exports: exported,
        window: {siyuan: {languages}},
        require: name => name.endsWith("/fragments") ? fragments : {},
    });
    const items = [];
    exported.registerAiMemoryGroup({group: () => ({stack() {}, slot: spec => items.push(spec)})});
    assert.deepEqual(items.map(item => item.key), ["memorySelection", "memoryReasoningEffort"]);
    assert.ok(items[0].keywords.includes(languages.apiModel));
    assert.ok(items[1].keywords.includes(languages.reasoningEffortTooltip));
    const content = `<div class="config-group"><div class="config-items">${items.map(item => item.html()).join("")}</div></div>`;
    return mobile ? `<div class="config config--mobile config--mobile-items">${content}</div>` :
        `<div class="config__tab-container">${content}</div>`;
};

const checkLayout = (html, css, fontSize) => {
    const check = require("node:assert/strict");
    document.head.innerHTML = "<style></style>";
    document.querySelector("style").textContent = css + `body {font-size:${fontSize}px; --b3-font-size:${fontSize}px;}`;
    document.body.innerHTML = html;
    const selects = document.querySelectorAll("select");
    check.equal(selects.length, 2);
    check.equal(selects[1].disabled, true);
    for (const select of selects) {
        select.innerHTML = "<option>Provider / a-very-long-model-name-that-must-fit-the-settings-row</option>";
        const row = select.closest(".config-item");
        const title = row.querySelector(".config-name");
        const bounds = row.getBoundingClientRect();
        const control = select.getBoundingClientRect();
        const heading = title.getBoundingClientRect();
        check.ok(row.scrollWidth <= row.clientWidth, "long model names fit the settings row");
        check.ok(control.right <= bounds.right + 1 && control.left >= bounds.left, "controls stay within their row");
        check.ok(heading.width > 100, "the setting title keeps a readable width");
        if (innerWidth <= 750) {
            check.ok(control.top >= heading.bottom + 7, "the control follows the complete title on narrow screens");
            const style = getComputedStyle(row);
            const contentWidth = row.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
            check.ok(Math.abs(control.width - contentWidth) < 1, "the control fills its own line");
        } else {
            check.ok(control.left >= heading.right, "wide settings place the control beside its title");
        }
    }
    check.notEqual(selects[0].closest(".config-item"), selects[1].closest(".config-item"));
};

if (process.versions.electron && process.type === "browser") {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.whenReady().then(async () => {
        const win = new BrowserWindow({show: false, frame: false, webPreferences: {
            nodeIntegration: true, contextIsolation: false, offscreen: true,
        }});
        try {
            for (const entry of ["base", "mobile"]) {
                const styles = sass.compile(path.join(__dirname, `../src/assets/scss/${entry}.scss`), {logger: sass.Logger.silent}).css;
                for (const theme of ["daylight", "midnight"]) {
                    const css = readFileSync(path.join(__dirname, `../appearance/themes/${theme}/theme.css`), "utf8") + styles;
                    for (const width of [1000, 700, 375]) {
                        win.setContentSize(width, 800);
                        await win.loadURL("data:text/html,<html><body></body></html>");
                        for (const fontSize of [16, 24]) {
                            const error = await win.webContents.executeJavaScript(`(() => {
                                try {
                                    (${checkLayout.toString()})(${[
                                        memoryHTML(entry === "mobile"), css, fontSize,
                                    ].map(value => JSON.stringify(value)).join(",")});
                                    return "";
                                } catch (error) { return error.message; }
                            })()`);
                            assert.equal(error, "", `${entry}, ${theme}, ${width}px, ${fontSize}px: ${error}`);
                        }
                    }
                }
            }
            console.log("Memory settings layouts passed");
            app.exit(0);
        } catch (error) {
            console.error(error);
            app.exit(1);
        }
    });
} else {
    test("memory model and reasoning settings fit separate rows on desktop and mobile", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 120000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-memory-layout-"));
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 115000});
            assert.match(stdout, /Memory settings layouts passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-memory-layout-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
