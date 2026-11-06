const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

if (process.versions.electron && process.type === "browser") {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.commandLine.appendSwitch("disable-gpu");
    app.whenReady().then(async () => {
        const win = new BrowserWindow({show: false, width: 1000, height: 600,
            webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
        try {
            const root = path.join(__dirname, "..");
            const css = require("sass").compile(path.join(root, "src/assets/scss/base.scss")).css;
            const source = readFileSync(path.join(root, "src/protyle/render/av/relatedView.ts"), "utf8");
            const heading = source.match(/this\.element\.innerHTML = `([\s\S]*?)`;/)[1]
                .replace(/\$\{[^}]+\}/g, "Related entries");
            await win.loadURL("about:blank");
            win.webContents.debugger.attach("1.3");
            await win.webContents.debugger.sendCommand("DOM.enable");
            await win.webContents.debugger.sendCommand("CSS.enable");
            for (const theme of ["daylight", "midnight"]) {
                const themeCSS = readFileSync(path.join(root, "appearance/themes", theme, "theme.css"), "utf8");
                await win.webContents.executeJavaScript(`(() => { document.head.innerHTML = "";
                    document.body.innerHTML = ${JSON.stringify('<div class="custom-attr"><div class="av-related-view">' + heading + '</div><span id="ordinary" class="block__logo">Ordinary field</span></div>')};
                    const style = document.createElement("style"); style.textContent = ${JSON.stringify(css + themeCSS)};
                    document.head.append(style); })()`);
                const {root: documentNode} = await win.webContents.debugger.sendCommand("DOM.getDocument");
                const selectors = [".av-related-view__heading", '[data-related-action="fold"]', ".av-related-view__title",
                    '[data-related-action="fold"] .block__icon', '[data-related-action="add"]', "#ordinary"];
                for (const selector of selectors) {
                    const {nodeId} = await win.webContents.debugger.sendCommand("DOM.querySelector", {nodeId: documentNode.nodeId, selector});
                    await win.webContents.debugger.sendCommand("CSS.forcePseudoState", {nodeId, forcedPseudoClasses: ["hover"]});
                    await new Promise(resolve => setTimeout(resolve, 350));
                    const styles = await win.webContents.executeJavaScript(`(() => {
                        const target = document.querySelector(${JSON.stringify(selector)});
                        const title = document.querySelector(".av-related-view__title");
                        return {background: getComputedStyle(target).backgroundColor,
                            titleBackground: getComputedStyle(title).backgroundColor, weight: getComputedStyle(title).fontWeight};
                    })()`);
                    assert.equal(styles.titleBackground, "rgba(0, 0, 0, 0)", theme + ": title hover stays transparent");
                    assert.equal(styles.weight, "400", theme + ": title remains normal weight");
                    if ([".av-related-view__heading", '[data-related-action="fold"]', ".av-related-view__title"].includes(selector)) {
                        assert.equal(styles.background, "rgba(0, 0, 0, 0)");
                    } else {
                        assert.notEqual(styles.background, "rgba(0, 0, 0, 0)", theme + ": native icon and ordinary field feedback remains");
                    }
                    await win.webContents.debugger.sendCommand("CSS.forcePseudoState", {nodeId, forcedPseudoClasses: []});
                }
            }
            console.log("Related heading theme cases passed");
            win.destroy(); app.exit(0);
        } catch (error) { console.error(error); win.destroy(); app.exit(1); }
    });
} else {
    require("node:test").test("related headings suppress only their title hover background in both native themes", {timeout: 60000}, async () => {
        const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-heading-style-"));
        try {
            const args = [__filename, profile];
            if (process.platform === "linux" && !env.DISPLAY && !env.WAYLAND_DISPLAY) args.push("--ozone-platform=headless");
            if (process.platform === "linux" && process.getuid?.() === 0) args.push("--no-sandbox");
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(require("electron"), args,
                {env, timeout: 55000, windowsHide: true});
            assert.match(stdout, /Related heading theme cases passed/);
        } finally { rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100}); }
    });
}
