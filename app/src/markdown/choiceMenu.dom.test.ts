import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {pathToFileURL} from "node:url";
import {promisify} from "node:util";
import {ScriptTarget, transpileModule} from "typescript";
import {compile} from "sass";

test("Markdown submenus preserve fractional borders at Windows 150 percent scaling", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 30000,
}, async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "siyuan-markdown-choice-test-"));
    const source = ["../menus/menuPosition.ts", "choiceMenu.ts"].map(filename => transpileModule(
        readFileSync(path.join(__dirname, filename), "utf8").replace(/^import [\s\S]*?;\r?\n/gm, "")
            .replace(/^export /gm, ""), {compilerOptions: {target: ScriptTarget.ES2022}}).outputText).join("\n");
    const css = path.join(directory, "ui.css");
    writeFileSync(css, compile(path.resolve(__dirname, "../assets/scss/markdown.scss")).css);
    const html = path.join(directory, "index.html");
    const theme = pathToFileURL(path.resolve(__dirname, "../../appearance/themes/daylight/theme.css")).href;
    writeFileSync(html, '<!doctype html><link rel="stylesheet" href="' + theme + '"><link rel="stylesheet" href="./ui.css">' +
        '<div class="markdown-app"><div class="b3-menu markdown-menu" style="top:8px;right:8px;max-height:none">' +
        '<div id="appearance"><div id="theme"></div><div id="font"></div></div></div></div>');
    const checks = `(() => {
        const assert = require("node:assert/strict");
        assert.equal(devicePixelRatio, 1.5);
        const appearance = createMarkdownSubmenu({element: document.getElementById("appearance"), label: "Appearance", icon: "iconTheme"});
        createMarkdownChoice({element: document.getElementById("theme"), label: "Theme", icon: "iconTheme",
            values: [{value: "light", label: "Light"}, {value: "dark", label: "Dark"}], value: "light", onChange() {}});
        createMarkdownChoice({element: document.getElementById("font"), label: "Font size", icon: "iconFont",
            values: [14,16,18,20,24,28,32].map(value => ({value: String(value), label: String(value)})), value: "16", onChange() {}});
        document.getElementById("appearance").click();
        const menu = appearance.menu;
        menu.scrollTop = 10000;
        menu.scrollLeft = 10000;
        assert.equal(menu.scrollTop, 0, "a short submenu cannot scroll even by a fractional CSS pixel");
        assert.equal(menu.scrollLeft, 0);
        assert.ok(menu.getBoundingClientRect().bottom <= innerHeight);
        return "Fractional submenu layout passed";
    })()`;
    const script = path.join(directory, "run.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(directory, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("force-device-scale-factor", "1.5");
app.whenReady().then(async () => {
    const window = new BrowserWindow({show:false, width:1000, height:720,
        webPreferences:{nodeIntegration:true,contextIsolation:false}});
    window.webContents.on("console-message", event => {if (event.level === "error") console.error(event.message);});
    try {
        await window.loadFile(${JSON.stringify(html)});
        console.log(await window.webContents.executeJavaScript(${JSON.stringify(source + "\n" + checks)}));
        window.destroy(); app.exit(0);
    } catch(error) {console.error(error);window.destroy();app.exit(1);}
});`);
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, timeout: 25000, windowsHide: true});
        assert.match(result.stdout, /Fractional submenu layout passed/);
    } finally {
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
        assert.ok(path.basename(directory).startsWith("siyuan-markdown-choice-test-"));
        rmSync(directory, {recursive: true, force: true});
    }
});
