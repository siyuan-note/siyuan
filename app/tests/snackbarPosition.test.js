const assert = require("node:assert/strict");
const {mkdtempSync, readFileSync, rmSync} = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const cases = async (source, css, mobileCSS) => {
    const check = require("node:assert/strict");
    const style = document.createElement("style");
    style.textContent = css + `body {margin:0} .fn__flex-1 {flex:1;min-height:0;overflow:auto}
        .b3-snackbars, .b3-snackbar {transition:none}`;
    document.head.append(style);
    window.siyuan = {languages: {}, zIndex: 100};
    const {initMessage, showMessage} = new Function("genUUID", "Constants", "getHostCapabilities", "sanitizeKernelHTML",
        source + "\nreturn {initMessage, showMessage};")(() => "notification", {SIYUAN_VERSION: "test", TIMEOUT_INPUT: 0},
        () => ({ownsKernel: true}), html => html);
    for (const width of [900, 420]) {
        await require("electron").ipcRenderer.invoke("resize", width);
        for (const height of [0, 28, 32, 34, 42, 64]) {
            document.documentElement.style.setProperty("--b3-window-controls-height", `${height}px`);
            document.body.innerHTML = '<div id="message" class="b3-snackbars"></div>';
            showMessage("Startup notification", 0);
            check.ok(document.getElementById("tempMessage").getBoundingClientRect().top >= height + (height ? 16 : 0),
                "startup notifications avoid native window controls");
            initMessage();
            await new Promise(resolve => setTimeout(resolve, 0));
            const container = document.getElementById("message");
            const message = container.querySelector(".b3-snackbar");
            const rect = message.getBoundingClientRect();
            check.ok(rect.top >= height + (height ? 16 : 0), `notification avoids ${height}px caption buttons at ${width}px`);
            check.ok(rect.top + parseFloat(getComputedStyle(container).maxHeight) <= innerHeight - 15,
                "the notification stack remains inside the viewport");
            const close = message.querySelector(".b3-snackbar__close");
            const closeRect = close.getBoundingClientRect();
            const target = document.elementFromPoint(closeRect.left + closeRect.width / 2, closeRect.top + closeRect.height / 2);
            check.equal(target.closest(".b3-snackbar__close"), close, "the close button receives the pointer");
            target.dispatchEvent(new MouseEvent("click", {bubbles: true}));
            check.equal(message.classList.contains("b3-snackbar--hide"), true, "click closes the notification");
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }
    style.textContent += mobileCSS;
    document.documentElement.style.removeProperty("--b3-window-controls-height");
    for (const safeTop of [0, 44]) {
        document.body.style.setProperty("--mobile-top-safe-area", `${safeTop}px`);
        const container = document.getElementById("message");
        check.equal(container.getBoundingClientRect().top, safeTop + 35, "mobile notifications retain their safe-area offset");
        check.ok(container.getBoundingClientRect().top + parseFloat(getComputedStyle(container).maxHeight) <= innerHeight - 15);
    }
    return "Snackbar positioning passed";
};

if (process.versions.electron && process.type === "browser") {
    (async () => {
        const {app, BrowserWindow, ipcMain} = require("electron");
        app.setPath("userData", process.argv[2]);
        await app.whenReady();
        const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
        ipcMain.handle("resize", (_event, width) => win.setContentSize(width, 600));
        await win.loadURL("data:text/html,<html><body></body></html>");
        const ts = require("typescript");
        const source = ts.transpileModule(readFileSync(path.join(__dirname, "../src/dialog/message.ts"), "utf8")
            .replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, ""),
        {compilerOptions: {target: ts.ScriptTarget.ES2021}}).outputText;
        const css = require("sass").compile(path.join(__dirname, "../src/assets/scss/component/_snackbar.scss")).css;
        const mobileCSS = require("sass").compile(path.join(__dirname, "../src/assets/scss/main/_mobile.scss")).css;
        console.log(await win.webContents.executeJavaScript(`(${cases.toString()})(${JSON.stringify(source)}, ${JSON.stringify(css)}, ${JSON.stringify(mobileCSS)})`));
        win.destroy();
        app.exit(0);
    })().catch(error => { console.error(error); require("electron").app.exit(1); });
} else {
    require("node:test").test("notifications and close buttons avoid native captions at every window density", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 30000,
    }, async () => {
        const temporary = mkdtempSync(path.join(os.tmpdir(), "siyuan-snackbar-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, temporary], {env, windowsHide: true, timeout: 25000});
            assert.match(stdout, /Snackbar positioning passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(temporary).startsWith("siyuan-snackbar-"));
            rmSync(temporary, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
