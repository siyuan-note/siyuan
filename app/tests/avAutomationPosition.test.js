const assert = require("node:assert/strict");
const {mkdtempSync, readFileSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {test} = require("node:test");
const sass = require("sass");
const ts = require("typescript");

const compile = file => ts.transpileModule(readFileSync(path.join(__dirname, "../src", file), "utf8"), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
}).outputText;

const browserCases = (css, positionCode, automationCode, mobile) => {
    const check = require("node:assert/strict");
    document.head.innerHTML = "<style></style>";
    document.querySelector("style").textContent = css;
    const modules = {"../layout/getTopBarHeight": {getTopBarHeight: () => 32},
        "../../../layout/getTopBarHeight": {getTopBarHeight: () => 32}};
    const load = code => {
        const result = {};
        new Function("exports", "require", code)(result, name => modules[name]);
        return result;
    };
    modules["../../../util/setPosition"] = load(positionCode);
    const {setAutomationMenuPosition} = load(automationCode);
    document.body.innerHTML = `<div class="av__panel"><div class="b3-menu av__automation-panel${mobile ? " b3-menu--fullscreen b3-menu--sheet" : ""}">
<div class="b3-menu__items"><button class="b3-menu__item">Automation</button><div class="av__automation"><div class="av__automation-body"><select class="b3-select"><option>Added</option><option>Block</option></select><div data-content></div><button data-last>Preview</button></div></div></div></div></div>`;
    const menu = document.querySelector(".b3-menu");
    const items = menu.querySelector(".b3-menu__items");
    const content = menu.querySelector("[data-content]");
    if (mobile) {
        menu.style.height = "400px";
        content.style.height = "1200px";
        const maxHeight = getComputedStyle(menu).maxHeight;
        menu.classList.remove("av__automation-panel");
        check.equal(getComputedStyle(menu).maxHeight, maxHeight, "desktop height cap must not affect mobile sheets");
        check.equal(menu.getBoundingClientRect().height, 400);
        return;
    }
    for (const bottom of [200, window.innerHeight - 30]) {
        const anchor = {right: window.innerWidth - 20, bottom};
        content.style.height = "100px";
        setAutomationMenuPosition(menu, anchor);
        const initialTop = menu.getBoundingClientRect().top;
        const initialLeft = menu.getBoundingClientRect().left;
        for (const height of [1400, 2200, 100]) {
            content.style.height = height + "px";
            setAutomationMenuPosition(menu, anchor);
            const rect = menu.getBoundingClientRect();
            check.equal(rect.top, initialTop, "growing and shrinking conditions must not move the panel");
            check.equal(rect.left, initialLeft);
            check.ok(rect.bottom <= window.innerHeight - 7, "panel stays inside the viewport");
            check.ok(rect.left >= 0 && rect.right <= window.innerWidth);
            if (height > 100) {
                check.ok(items.scrollHeight > items.clientHeight, "long conditions scroll inside the menu");
                items.scrollTop = items.scrollHeight;
                const last = menu.querySelector("[data-last]").getBoundingClientRect();
                check.ok(last.bottom <= rect.bottom && last.top >= rect.top, "last action is reachable");
                const scrollTop = items.scrollTop;
                setAutomationMenuPosition(menu, anchor);
                check.equal(items.scrollTop, scrollTop, "repositioning preserves the scroll offset");
            }
        }
    }
    menu.classList.remove("av__automation-panel");
    check.equal(getComputedStyle(menu).maxHeight, "none", "returning to settings removes the automation height cap");
};

if (process.versions.electron && process.type === "browser") {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.whenReady().then(async () => {
        console.log("Automation renderer ready");
        const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
        win.webContents.on("console-message", event => console.error(event.message));
        try {
            for (const [name, theme, width, height, fontSize] of [
                ["base", "daylight", 1280, 900, 16], ["base", "midnight", 420, 600, 24],
                ["base", "daylight", 800, 360, 32], ["mobile", "daylight", 420, 800, 16],
            ]) {
                win.setSize(width, height);
                console.log(`Checking ${name}/${theme}/${width}/${height}`);
                await win.loadURL("data:text/html,<html><body></body></html>");
                const css = readFileSync(path.join(__dirname, `../appearance/themes/${theme}/theme.css`), "utf8") +
                    sass.compile(path.join(__dirname, `../src/assets/scss/${name}.scss`), {logger: sass.Logger.silent}).css +
                    `body {font-size:${fontSize}px; --b3-font-size:${fontSize}px;}`;
                await win.webContents.executeJavaScript(`try { (${browserCases.toString()})(${[
                    css, compile("util/setPosition.ts"), compile("protyle/render/av/automationPosition.ts"), name === "mobile",
                ].map(value => JSON.stringify(value)).join(",")}) } catch (error) { console.error(error.stack); throw error; }`);
            }
            console.log("Automation position cases passed");
            app.exit(0);
        } catch (error) {
            console.error(error);
            app.exit(1);
        }
    });
} else {
    test("automation panels keep their position and scroll in desktop layouts without changing mobile sheets", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 120000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-automation-position-"));
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 115000});
            assert.match(stdout, /Automation position cases passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-automation-position-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
