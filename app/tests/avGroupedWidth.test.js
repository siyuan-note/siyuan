const assert = require("node:assert/strict");
const {mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {test} = require("node:test");
const sass = require("sass");

const browserCases = css => {
    const check = require("node:assert/strict");
    const style = document.createElement("style");
    style.textContent = css + "html,body {display:block;height:auto;overflow:auto}";
    document.head.append(style);
    for (const width of [320, 720, 1200]) {
        for (const fontSize of [16, 32]) {
            document.body.innerHTML = `<div style="width:${width}px;font-size:${fontSize}px">
<div class="av" data-av-type="table"><div class="av__container av__container--grouped">
<div class="av__header"><div class="av__views"><span>View</span><span class="fn__flex-1"></span><span>New</span></div></div>
<div class="av__scroll"><div class="av__group-title">Group</div>
<div class="av__body" style="float:left"><div class="av__row"><div class="av__cell" style="width:900px">Cell</div></div></div>
</div></div></div></div>`;
            const header = document.querySelector(".av__header");
            const body = document.querySelector(".av__body");
            const scroll = document.querySelector(".av__scroll");
            const expandedWidth = header.getBoundingClientRect().width;
            check.equal(expandedWidth, width);
            if (width < 900) {
                check.ok(scroll.scrollWidth > scroll.clientWidth);
                scroll.scrollLeft = 100;
                check.ok(scroll.scrollLeft > 0);
            }
            body.classList.add("fn__none");
            body.replaceChildren();
            check.equal(header.getBoundingClientRect().width, expandedWidth);
            check.equal(scroll.getBoundingClientRect().width, expandedWidth);
        }
    }
    style.remove();
    return "Grouped table widths passed";
};

const runElectron = async () => {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.commandLine.appendSwitch("disable-gpu");
    await app.whenReady();
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        for (const name of ["base", "mobile"]) {
            const css = sass.compile(path.join(__dirname, `../src/assets/scss/${name}.scss`), {
                logger: sass.Logger.silent,
            }).css;
            assert.equal(await win.webContents.executeJavaScript(
                `(${browserCases.toString()})(${JSON.stringify(css)})`), "Grouped table widths passed");
        }
        console.log("Grouped table widths passed");
        win.destroy();
        app.exit(0);
    } catch (error) {
        console.error(error);
        win.destroy();
        app.exit(1);
    }
};

if (process.versions.electron && process.type === "browser") {
    runElectron().catch(error => {
        console.error(error);
        require("electron").app.exit(1);
    });
} else {
    test("group folding preserves desktop and mobile toolbar widths and horizontal scrolling", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 45000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-group-width-"));
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 40000});
            assert.match(stdout, /Grouped table widths passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-group-width-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
