import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {resolve} from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {compile} from "sass";

test("document flashcard marker and animation remain visible behind the rich title", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY && !process.env.SIYUAN_ELECTRON_HEADLESS,
    timeout: 30000,
}, async () => {
    const styles = ["base", "mobile"].map(name => compile(resolve(__dirname, `../../assets/scss/${name}.scss`),
        {logger: {warn() {}, debug() {}}}).css);
    const directory = mkdtempSync(resolve(tmpdir(), "siyuan-title-flashcard-"));
    const script = resolve(directory, "run.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
const assert = require("node:assert/strict");
app.setPath("userData", ${JSON.stringify(resolve(directory, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("force-color-profile", "srgb");
app.commandLine.appendSwitch("force-device-scale-factor", "1");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show:false, width:800, height:600,
        webPreferences:{nodeIntegration:true, contextIsolation:false, backgroundThrottling:false}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        for (const css of ${JSON.stringify(styles)}) {
            for (const background of ["#ffffff", "#202020"]) {
                await win.webContents.executeJavaScript(
                    "document.head.innerHTML = '<style>' + " + JSON.stringify(css) + " + '</style>';" +
                    "document.body.innerHTML = '<div class=protyle-title custom-riff-decks=quick style=\\\"margin:20px;width:300px;height:80px\\\">" +
                    "<div class=\\\"protyle-title__rich protyle-lite-fragment protyle\\\" style=\\\"height:80px\\\">" +
                    "<div class=protyle-content><div class=protyle-wysiwyg><div data-type=NodeParagraph>" +
                    "<div class=protyle-title__input contenteditable=true>Title</div></div></div></div></div></div>';" +
                    "document.body.style.setProperty('--b3-theme-background', " + JSON.stringify(background) + ");" +
                    "document.body.style.setProperty('--b3-protyle-inline-mark-background', '#ff8000');" +
                    "document.body.style.backgroundColor = " + JSON.stringify(background) + ";");
                const point = await win.webContents.executeJavaScript(
                    "(() => {const r = document.querySelector('.protyle-title').getBoundingClientRect(); return {x:r.x,y:r.y};})()");
                const pixel = async (x, y) => {
                    await win.webContents.executeJavaScript("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
                    const image = await win.webContents.capturePage({x:Math.floor(x), y:Math.floor(y), width:1, height:1});
                    return Array.from(image.toBitmap().subarray(0, 3));
                };
                assert.deepEqual(await pixel(point.x + 1, point.y + 60), [0, 128, 255], "rich title must not cover the flashcard marker");
                await win.webContents.executeJavaScript(
                    "(() => {const title = document.querySelector('.protyle-title'); title.style.animation = 'addCard 450ms linear';" +
                    "const animation = title.getAnimations()[0]; animation.pause(); animation.currentTime = 0;})()");
                assert.deepEqual(await pixel(point.x + 30, point.y + 60), [0, 128, 255], "rich title must not cover the add-card animation");
                await win.webContents.executeJavaScript(
                    "document.querySelector('.protyle-title').style.animation = ''; document.querySelector('.protyle-title').removeAttribute('custom-riff-decks');");
                const shade = background === "#ffffff" ? 255 : 32;
                assert.deepEqual(await pixel(point.x + 1, point.y + 60), [shade, shade, shade], "removing a card clears the marker");
            }
        }
        console.log("Document flashcard rendering passed");
        win.destroy(); app.exit(0);
    } catch (error) {console.error(error); win.destroy(); app.exit(1);}
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const args = process.env.SIYUAN_ELECTRON_HEADLESS ?
            ["--ozone-platform=headless", "--ozone-override-screen-size=1920,1080", script] : [script];
        const result = await promisify(execFile)(require("electron") as unknown as string, args,
            {env, windowsHide: true, timeout: 25000});
        assert.match(result.stdout, /Document flashcard rendering passed/);
    } finally {
        rmSync(directory, {recursive: true, force: true});
    }
});
