const assert = require("node:assert/strict");
const {mkdtempSync, readFileSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {test} = require("node:test");
const {runInNewContext} = require("node:vm");
const {ModuleKind, transpileModule} = require("typescript");
const {parse} = require("ifdef-loader/preprocessor");
const sass = require("sass");

const proxyHTML = (mobile, scheme) => {
    const languages = JSON.parse(readFileSync(path.join(__dirname, "../appearance/langs/zh-CN.json"), "utf8"));
    const source = readFileSync(path.join(__dirname, "../src/config/tabs/appTab.ts"), "utf8");
    const compile = value => transpileModule(value, {compilerOptions: {module: ModuleKind.CommonJS}}).outputText;
    const escape = {};
    runInNewContext(compile(readFileSync(path.join(__dirname, "../src/util/escape.ts"), "utf8")), {exports: escape});
    const exports = {};
    runInNewContext(compile(parse(source, {BROWSER: true, MOBILE: mobile}, false, true)), {
        exports,
        window: {siyuan: {languages, config: {system: {
            networkProxy: {scheme, host: "user:password@127.0.0.1", port: "7890"},
        }}}},
        require: name => {
            if (name === "../../util/escape") return escape;
            if (name === "../../util/hostCapabilities") return {getHostCapabilities: () => ({})};
            return new Proxy({}, {get: () => () => ""});
        },
    });
    let html;
    const group = new Proxy({}, {get: (_, method) => value => {
        if (method === "slot" && value.key === "networkProxy") html = value.html();
    }});
    exports.registerAppTab({group: () => group});
    assert.ok(html);
    return mobile ? `<div class="config config--mobile config--mobile-items"><div class="config-group">${html}</div></div>` :
        `<div class="config__tab-container">${html}</div>`;
};

const checkLayout = (html, css, manual, fontSize) => {
    const check = require("node:assert/strict");
    document.head.innerHTML = "<style></style>";
    document.querySelector("style").textContent = css + `body {font-size:${fontSize}px; --b3-font-size:${fontSize}px;}`;
    document.body.innerHTML = html;
    const host = document.getElementById("networkProxyHost");
    const port = document.getElementById("networkProxyPort");
    const scheme = document.getElementById("networkProxyScheme").getBoundingClientRect();
    const confirm = document.getElementById("networkProxyConfirm").getBoundingClientRect();
    const row = host.parentElement.parentElement;
    const bounds = row.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    const portRect = port.getBoundingClientRect();
    check.ok(row.scrollWidth <= row.clientWidth, "proxy controls fit the row");
    check.ok(Math.abs(confirm.right - bounds.right) < 1, "confirm stays right-aligned");
    check.equal(host.value, "user:password@127.0.0.1");
    check.equal(port.value, "7890");
    if (!manual) {
        check.equal(hostRect.width, 0);
        check.equal(portRect.width, 0);
        if (innerWidth <= 750) {
            check.ok(confirm.top - scheme.bottom < 10, "hidden fields leave no empty row");
        } else {
            check.equal(confirm.top, scheme.top);
        }
        return;
    }
    if (innerWidth <= 750) {
        for (const rect of [hostRect, portRect, confirm]) {
            check.ok(Math.abs(rect.width - bounds.width) < 1, "each control fills its own row");
        }
        check.ok(hostRect.top >= scheme.bottom + 7, "host follows scheme");
        check.ok(portRect.top >= hostRect.bottom + 7, "port follows host");
        check.ok(confirm.top >= portRect.bottom + 7, "confirm follows port");
        check.ok(portRect.top - hostRect.bottom < 10, "no spacer row between fields");
    } else {
        check.equal(hostRect.top, scheme.top);
        check.equal(portRect.top, scheme.top);
        check.equal(confirm.top, scheme.top);
        check.ok(hostRect.left >= scheme.right && portRect.left >= hostRect.right);
        check.ok(confirm.left >= portRect.right);
    }
};

if (process.versions.electron && process.type === "browser") {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.whenReady().then(async () => {
        const win = new BrowserWindow({show: false, frame: false, webPreferences: {
            nodeIntegration: true, contextIsolation: false, offscreen: true, backgroundThrottling: false,
        }});
        try {
            for (const name of ["base", "mobile"]) {
                const styles = sass.compile(path.join(__dirname, `../src/assets/scss/${name}.scss`), {logger: sass.Logger.silent}).css;
                for (const theme of ["daylight", "midnight"]) {
                    const css = readFileSync(path.join(__dirname, `../appearance/themes/${theme}/theme.css`), "utf8") + styles;
                    for (const width of [1000, 700, 375]) {
                        win.setContentSize(width, 800);
                        for (const scheme of ["http", "https", "socks5", "system", ""]) {
                            await win.loadURL("data:text/html,<html><body></body></html>");
                            const error = await win.webContents.executeJavaScript(`(() => {
                                try {
                                    (${checkLayout.toString()})(${[
                                        proxyHTML(name === "mobile", scheme), css, scheme !== "system" && scheme !== "", width === 1000 ? 16 : 24,
                                    ].map(value => JSON.stringify(value)).join(",")});
                                    return "";
                                } catch (error) { return error.message; }
                            })()`);
                            assert.equal(error, "", `${name}, ${theme}, ${width}px, scheme=${scheme}: ${error}`);
                        }
                    }
                }
            }
            console.log("Network proxy layouts passed");
            app.exit(0);
        } catch (error) {
            console.error(error);
            app.exit(1);
        }
    });
} else {
    test("network proxy preserves manual field rows and automatic mode spacing on desktop and mobile", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 120000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-proxy-layout-"));
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 115000});
            assert.match(stdout, /Network proxy layouts passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-proxy-layout-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
