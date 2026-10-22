const assert = require("node:assert/strict");
const {mkdtempSync, readFileSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {test} = require("node:test");

// 只替换模板数据和无关的登录脚本，保留实际认证页的结构、样式及壁纸加载函数。
const fixtureHTML = (file, dark) => {
    let source = readFileSync(path.join(__dirname, "..", file), "utf8");
    const loader = /const loadLockScreenWallpaper = \(\) => \{[\s\S]*?\n {4}\};/.exec(source)[0];
    source = source.replace(/<script>[\s\S]*?<\/script>/g, "")
        .replace(/{{if not \.accessAuthCodeEnabled}}[\s\S]*?{{end}}/g, "")
        .replace(/{{(?:if \.\w+|end)}}/g, "")
        .replace(/{{\.workspace}}/g, "Workspace")
        .replace(/{{\.l\d+}}/g, "Sign in")
        .replace("<main hidden>", "<main>");
    if (dark) source = source.replace('<html style="height: 100%">', '<html class="dark" style="height: 100%">');
    return source.replace("</body>", `<script>${loader}\nwindow.loadLockScreenWallpaper = loadLockScreenWallpaper;</script></body>`);
};

const checkLayout = async (wallpaperPresent, dark, remote) => {
    const check = require("node:assert/strict");
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 800;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#e18a40";
    ctx.fillRect(0, 0, 600, 800);
    ctx.fillStyle = "#16384e";
    ctx.fillRect(600, 0, 600, 800);
    const wallpaper = document.getElementById("lockScreenWallpaper");
    const loaded = new Promise(resolve => wallpaper.addEventListener(wallpaperPresent ? "load" : "error", resolve, {once: true}));
    window.loadLockScreenWallpaper();
    wallpaper.src = wallpaperPresent ? canvas.toDataURL() : "data:image/jpeg;base64,Y29ycnVwdA==";
    await loaded;
    await new Promise(resolve => requestAnimationFrame(resolve));
    check.equal(document.body.classList.contains("has-wallpaper"), wallpaperPresent);
    check.equal(wallpaper.hidden, !wallpaperPresent);
    const panel = document.querySelector(remote ? "main" : "#authPanel");
    const rect = panel.getBoundingClientRect();
    if (wallpaperPresent) {
        check.ok(rect.left >= 0 && rect.right <= innerWidth, "login panel fits the viewport horizontally");
        check.ok(rect.top >= 32 && rect.bottom <= innerHeight, "login panel fits below the drag area");
        check.ok(panel.scrollWidth <= panel.clientWidth, "login controls do not overflow the panel");
        const background = getComputedStyle(panel).backgroundColor;
        check.equal(background, dark ? "rgb(30, 30, 30)" : "rgb(255, 255, 255)");
        panel.scrollTop = panel.scrollHeight;
        const last = panel.querySelector(remote ? "#submit" : ".b3-button--white").getBoundingClientRect();
        check.ok(last.bottom <= rect.bottom && last.top >= rect.top, "login and exit actions remain reachable");
        const image = wallpaper.getBoundingClientRect();
        check.equal(image.width, innerWidth);
        check.equal(image.height, innerHeight);
    }
};

if (process.versions.electron && process.type === "browser") {
    const {app, BrowserWindow, nativeTheme} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.whenReady().then(async () => {
        const win = new BrowserWindow({show: false, frame: false, webPreferences: {
            nodeIntegration: true, contextIsolation: false, offscreen: true, backgroundThrottling: false,
        }});
        try {
            for (const file of ["stage/auth.html", "electron/remote-auth.html"]) {
                for (const [width, height] of [[1200, 800], [320, 640], [640, 320], [320, 280]]) {
                    win.setContentSize(width, height);
                    for (const dark of [false, true]) {
                        nativeTheme.themeSource = dark ? "dark" : "light";
                        for (const present of [false, true]) {
                            await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(fixtureHTML(file, dark)));
                            await win.webContents.executeJavaScript(`(${checkLayout.toString()})(${present}, ${dark}, ${file.startsWith("electron")})`);
                        }
                    }
                }
            }
            console.log("Wallpaper layouts passed");
            app.exit(0);
        } catch (error) {
            console.error(error);
            app.exit(1);
        }
    });
} else {
    test("lock screen wallpapers preserve readable login actions on desktop, narrow and short screens in both themes", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 120000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-wallpaper-layout-"));
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 115000});
            assert.match(stdout, /Wallpaper layouts passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-wallpaper-layout-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
