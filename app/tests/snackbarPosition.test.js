const assert = require("node:assert/strict");
const {mkdtempSync, readFileSync, rmSync} = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const cases = async (source, css, densityCSS, mobileCSS) => {
    const check = require("node:assert/strict");
    const style = document.createElement("style");
    style.textContent = densityCSS + css + `body {margin:0} .fn__flex-1 {flex:1;min-height:0;overflow:auto}
        .b3-snackbars, .b3-snackbar {transition:none}`;
    document.head.append(style);
    window.siyuan = {languages: {}, zIndex: 100};
    const {initMessage, showMessage} = new Function("genUUID", "Constants", "getHostCapabilities", "sanitizeKernelHTML",
        source + "\nreturn {initMessage, showMessage};")(() => "notification", {SIYUAN_VERSION: "test", TIMEOUT_INPUT: 0},
        () => ({ownsKernel: true}), html => html);
    const gap = parseFloat(getComputedStyle(document.body).getPropertyValue("--b3-snackbar-gap"));
    const near = (actual, expected, message) =>
        check.ok(Math.abs(actual - expected) <= 1, `${message}: ${actual} vs ${expected}`);
    const root = document.documentElement;
    const resize = async width => {
        await require("electron").ipcRenderer.invoke("resize", width);
        // 隐藏窗口的原生尺寸变更不保证在下一帧前传到渲染进程。
        const deadline = performance.now() + 5000;
        while (innerWidth !== width && performance.now() < deadline) {
            await new Promise(resolve => requestAnimationFrame(resolve));
        }
        check.equal(innerWidth, width, "the renderer has applied the window resize");
    };
    for (const compact of [false, true]) {
        if (compact) {
            root.setAttribute("data-ui-density", "compact");
        } else {
            root.removeAttribute("data-ui-density");
        }
        for (const fused of [false, true]) {
            document.body.classList.toggle("body--toolbar-hide", fused);
            for (const width of [900, 420]) {
                await resize(width);
                const narrowRight = width <= 520 ? width * 0.1 - 18 : 0;
                for (const dock of [0, 34, 42]) {
                    root.style.setProperty("--b3-dock-right-width", `${dock}px`);
                    for (const height of [0, 28, 32, 34, 42, 64]) {
                        root.style.setProperty("--b3-window-controls-height", `${height}px`);
                        const topBar = fused ? (compact ? 34 : 42) : (compact ? 28 : 32);
                        const expectedTop = Math.max(topBar, height) + gap;
                        const expectedRight = Math.max(dock + gap, narrowRight);
                        const label = `${compact ? "compact " : ""}${fused ? "fused" : "separate"} top bar, ` +
                            `${dock}px dock, ${height}px caption buttons at ${width}px`;
                        document.body.innerHTML = '<div id="message" class="b3-snackbars"></div>';
                        showMessage("Startup notification", 0);
                        near(document.getElementById("tempMessage").getBoundingClientRect().top, expectedTop,
                            `startup notifications keep the top bar gap with ${label}`);
                        initMessage();
                        await new Promise(resolve => setTimeout(resolve, 0));
                        const container = document.getElementById("message");
                        const message = container.querySelector(".b3-snackbar");
                        const rect = message.getBoundingClientRect();
                        near(rect.top, expectedTop, `notifications clear the ${label}`);
                        near(container.getBoundingClientRect().right, innerWidth - expectedRight,
                            `notifications keep the dock and edge gap with ${label}`);
                        check.ok(rect.top + parseFloat(getComputedStyle(container).maxHeight) <= innerHeight - gap + 1,
                            "the notification stack remains inside the viewport");
                        const close = message.querySelector(".b3-snackbar__close");
                        const closeRect = close.getBoundingClientRect();
                        const target = document.elementFromPoint(closeRect.left + closeRect.width / 2,
                            closeRect.top + closeRect.height / 2);
                        check.equal(target.closest(".b3-snackbar__close"), close, "the close button receives the pointer");
                        target.dispatchEvent(new MouseEvent("click", {bubbles: true}));
                        check.equal(message.classList.contains("b3-snackbar--hide"), true, "click closes the notification");
                        await new Promise(resolve => setTimeout(resolve, 0));
                    }
                }
            }
        }
    }
    document.body.classList.remove("body--toolbar-hide");
    root.removeAttribute("data-ui-density");
    root.style.removeProperty("--b3-window-controls-height");
    root.style.removeProperty("--b3-dock-right-width");
    style.textContent += mobileCSS;
    document.body.innerHTML = '<div id="message" class="b3-snackbars"></div>';
    for (const width of [900, 420]) {
        await resize(width);
        for (const safeTop of [0, 44]) {
            document.body.style.setProperty("--mobile-top-safe-area", `${safeTop}px`);
            document.body.innerHTML = '<div id="message" class="b3-snackbars"></div>';
            showMessage("Startup notification", 0);
            const startupStyle = getComputedStyle(document.getElementById("tempMessage"));
            near(parseFloat(startupStyle.top), 22, "mobile startup notifications retain their top offset");
            near(parseFloat(startupStyle.right), 30, "mobile startup notifications retain their right offset");
            initMessage();
            await new Promise(resolve => setTimeout(resolve, 0));
            const container = document.getElementById("message");
            const rect = container.getBoundingClientRect();
            near(rect.top, safeTop + 35, "mobile notifications retain their safe-area offset");
            near(innerWidth - rect.right, width <= 520 ? width * 0.1 - 18 : 30,
                "mobile notifications retain their wide and narrow window margins");
            near(innerHeight - rect.top - parseFloat(getComputedStyle(container).maxHeight), 16,
                "mobile notifications retain their bottom gap");
        }
    }
    return "Snackbar positioning passed";
};

if (process.versions.electron && process.type === "browser") {
    (async () => {
        const {app, BrowserWindow, ipcMain} = require("electron");
        app.setPath("userData", process.argv[2]);
        await app.whenReady();
        const win = new BrowserWindow({show: false, frame: false,
            webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true, backgroundThrottling: false}});
        ipcMain.handle("resize", (_event, width) => win.setContentSize(width, 600));
        await win.loadURL("data:text/html,<html><body></body></html>");
        const ts = require("typescript");
        const source = ts.transpileModule(readFileSync(path.join(__dirname, "../src/dialog/message.ts"), "utf8")
            .replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, ""),
        {compilerOptions: {target: ts.ScriptTarget.ES2021}}).outputText;
        const css = require("sass").compile(path.join(__dirname, "../src/assets/scss/component/_snackbar.scss")).css;
        const densityCSS = require("sass").compile(path.join(__dirname, "../src/assets/scss/util/_density.scss")).css;
        const mobileCSS = require("sass").compile(path.join(__dirname, "../src/assets/scss/main/_mobile.scss")).css;
        console.log(await win.webContents.executeJavaScript(
            `(${cases.toString()})(${JSON.stringify(source)}, ${JSON.stringify(css)}, ` +
            `${JSON.stringify(densityCSS)}, ${JSON.stringify(mobileCSS)})`));
        win.destroy();
        app.exit(0);
    })().catch(error => { console.error(error); require("electron").app.exit(1); });
} else {
    require("node:test").test("notifications keep a fixed gap from the top bar, the right dock and the window edge", {
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
