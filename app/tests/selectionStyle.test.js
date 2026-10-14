const assert = require("node:assert/strict");
const {mkdtempSync, readFileSync, rmSync} = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");
const sass = require("sass");

const runCases = ({source, css}) => {
    const check = require("node:assert/strict");
    const load = () => {
        const exports = {};
        new Function("exports", source)(exports);
        return exports.initSelectionStyle;
    };
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    document.body.innerHTML = '<p>Parent <span id="child">nested <b>text</b></span></p>' +
        '<div class="protyle-wysiwyg protyle-wysiwyg--hiderange"><p id="hidden">Hidden</p></div>' +
        '<div class="textLayer"><span id="pdf">PDF</span></div>';
    const before = document.documentElement.children.length;
    const init = load();
    init();
    init();
    check.equal(document.getElementById("selectionCompatibilityStyle"), null);
    check.equal(document.documentElement.children.length, before);
    for (const [color, pdfColor] of [["rgb(100, 150, 200)", "rgb(50, 100, 150)"],
        ["rgb(150, 100, 50)", "rgb(200, 150, 100)"]]) {
        document.documentElement.style.setProperty("--b3-theme-primary-lighter", color);
        document.documentElement.style.setProperty("--b3-pdf-selection", pdfColor);
        for (const element of document.querySelectorAll("body > p, #child, #child b")) {
            check.equal(getComputedStyle(element, "::selection").backgroundColor, color);
        }
        check.equal(getComputedStyle(document.getElementById("hidden"), "::selection").backgroundColor, "rgba(0, 0, 0, 0)");
        check.equal(getComputedStyle(document.getElementById("pdf"), "::selection").backgroundColor, pdfColor);
    }
    const theme = document.createElement("style");
    theme.textContent = "::selection { background-color: rgb(10, 20, 30); }";
    document.head.appendChild(theme);
    load()();
    check.equal(document.getElementById("selectionCompatibilityStyle"), null,
        "theme selection rules must not interfere with the inheritance probe");

    // 模拟旧内核返回未继承的伪元素样式，再用真实渲染检查兼容规则和局部覆盖。
    const originalGetComputedStyle = window.getComputedStyle;
    window.getComputedStyle = () => ({backgroundColor: "rgba(0, 0, 0, 0)"});
    const legacyInit = load();
    try {
        legacyInit();
        legacyInit();
    } finally {
        window.getComputedStyle = originalGetComputedStyle;
    }
    check.equal(document.querySelectorAll("#selectionCompatibilityStyle").length, 1);
    check.equal(document.head.firstChild.id, "selectionCompatibilityStyle");
    check.equal(getComputedStyle(document.getElementById("child"), "::selection").backgroundColor, "rgb(10, 20, 30)");
    theme.remove();
    check.equal(getComputedStyle(document.getElementById("child"), "::selection").backgroundColor, "rgb(150, 100, 50)");
    check.equal(getComputedStyle(document.getElementById("hidden"), "::selection").backgroundColor, "rgba(0, 0, 0, 0)");
    check.equal(getComputedStyle(document.getElementById("pdf"), "::selection").backgroundColor, "rgb(200, 150, 100)");
    document.getElementById("selectionCompatibilityStyle").remove();
    const originalAttachShadow = Element.prototype.attachShadow;
    Element.prototype.attachShadow = () => { throw new Error("unsupported"); };
    try {
        load()();
    } finally {
        Element.prototype.attachShadow = originalAttachShadow;
    }
    check.ok(document.getElementById("selectionCompatibilityStyle"));
    check.equal(document.documentElement.children.length, before);
};

if (process.versions.electron && process.type === "browser") {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.whenReady().then(async () => {
        const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
        let code = 0;
        try {
            const source = ts.transpileModule(readFileSync(path.join(__dirname, "../src/util/selectionStyle.ts"), "utf8"), {
                compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
            }).outputText;
            for (const name of ["base", "mobile"]) {
                const css = sass.compile(path.join(__dirname, `../src/assets/scss/${name}.scss`), {logger: sass.Logger.silent}).css;
                await win.loadURL("data:text/html,<html><head></head><body></body></html>");
                const result = await win.webContents.executeJavaScript(`(() => {
                    try {
                        (${runCases.toString()})(${JSON.stringify({source, css})});
                        return "passed";
                    } catch (error) {
                        return error.stack;
                    }
                })()`);
                assert.equal(result, "passed", name);
            }
            console.log("Selection inheritance and compatibility passed");
        } catch (error) {
            console.error(error);
            code = 1;
        } finally {
            win.destroy();
            app.exit(code);
        }
    });
} else {
    require("node:test").test("desktop and mobile preserve selection colors with inheritance and legacy fallback", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 60000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-selection-style-"));
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 55000});
            assert.match(stdout, /Selection inheritance and compatibility passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-selection-style-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
