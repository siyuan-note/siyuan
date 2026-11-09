import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {pathToFileURL} from "node:url";
import {ScriptTarget, transpileModule} from "typescript";

const browserCases = async (cdn: string, lutePath: string) => {
    const check: typeof assert = require("node:assert/strict");
    const api = (window as unknown as {MarkdownEditorTest: typeof import("./editor")}).MarkdownEditorTest;
    const markdown = "```js\ndocument.body.insertAdjacentHTML('afterbegin', ``);\n```\n\noutside\n";
    const tick = () => new Promise(resolve => setTimeout(resolve, 0));
    for (const mode of ["ir", "wysiwyg"] as const) {
        const host = document.createElement("div");
        document.body.append(host);
        const editor = await api.createMarkdownEditor({element: host, initialValue: markdown, mode, cdn, lutePath,
            onEdit: () => {}});
        const root = host.querySelector<HTMLElement>(`.vditor-${mode} .vditor-reset`);
        const highlighted = async (phase: string) => {
            for (let attempt = 0; attempt < 100; attempt++) {
                const source = root.querySelector('[data-type="code-block"] > pre > code');
                const preview = source?.parentElement.nextElementSibling;
                const title = preview?.querySelector(".hljs-title");
                const string = preview?.querySelector(".hljs-string");
                if (source?.querySelector(".hljs-title") && title && string) {
                    check.notEqual(getComputedStyle(title).color, getComputedStyle(preview.querySelector("code")).color);
                    check.notEqual(getComputedStyle(string).color, getComputedStyle(preview.querySelector("code")).color);
                    return;
                }
                await new Promise(resolve => setTimeout(resolve, 25));
            }
            throw new Error(`${mode} ${phase}: source and preview highlighting not restored`);
        };
        const copyCode = async () => {
            const ipc = require("electron").ipcRenderer;
            await ipc.invoke("copy-seed");
            for (let attempt = 0; attempt < 100 && !root.querySelector(".vditor-copy"); attempt++) {
                await new Promise(resolve => setTimeout(resolve, 20));
            }
            const pre = root.querySelector(".vditor-copy").closest("pre");
            const area = pre.getBoundingClientRect();
            await ipc.invoke("copy-mouse", {type: "mouseMoved", x: area.x + 10, y: area.y + 10});
            await new Promise(resolve => setTimeout(resolve, 80));
            const button = pre.querySelector<HTMLElement>(".vditor-copy span");
            const rect = button.getBoundingClientRect();
            const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
            await ipc.invoke("copy-mouse", {type: "mouseMoved", x, y});
            check.ok(button.contains(document.elementFromPoint(x, y)));
            await ipc.invoke("copy-mouse", {type: "mousePressed", x, y, button: "left", clickCount: 1});
            await ipc.invoke("copy-mouse", {type: "mouseReleased", x, y, button: "left", clickCount: 1});
            const expected = "document.body.insertAdjacentHTML('afterbegin', ``);";
            let actual = "";
            for (let attempt = 0; attempt < 30; attempt++) {
                actual = await ipc.invoke("copy-read");
                if (actual === expected) break;
                await new Promise(resolve => setTimeout(resolve, 30));
            }
            check.equal(actual, expected, mode + " native clipboard after code copy");
        };
        try {
            await highlighted("initial");
            await copyCode();
            const paragraph = root.querySelector("p");
            const range = document.createRange();
            range.selectNodeContents(paragraph); range.collapse(false);
            root.focus(); getSelection().removeAllRanges(); getSelection().addRange(range);
            await require("electron").ipcRenderer.invoke("markdown-undo-input", "x");
            await tick();
            // Let the adapter commit the ordinary paragraph edit before undoing its first snapshot.
            await new Promise(resolve => setTimeout(resolve, 600));
            editor.undo(); await tick();
            check.equal(editor.flush().content, markdown);
            await highlighted("undo");
            await copyCode();
            editor.redo(); await tick();
            check.equal(editor.flush().content, markdown.replace("outside", "outsidex"));
            await highlighted("redo");
            await copyCode();
            editor.undo(); await tick();
            check.equal(editor.flush().content, markdown);
            await highlighted("second undo");
            await copyCode();
        } finally {
            editor.destroy(); host.remove();
        }
    }
    return "Markdown code history DOM cases passed";
};
test("Markdown undo and redo restore highlighting and native code copying", {
    timeout: 45000,
}, async () => {
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-markdown-editor-test-"));
    const compile = (name: string) => transpileModule(readFileSync(path.join(__dirname, name), "utf8")
        .replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, "")
        .replace('require("vditor")', "globalThis.Vditor"), {compilerOptions: {target: ScriptTarget.ES2022}}).outputText;
    const bundle = compile("identity.ts") + "\n" + compile("limits.ts") + "\n" + compile("resourcePolicy.ts") + "\n" + compile("link.ts") + "\n" + compile("panelAnimation.ts") + "\n" + compile("editor.ts") +
        "\nwindow.MarkdownEditorTest = {createMarkdownEditor, createMarkdownResourcePolicy};";
    const html = path.join(temporary, "index.html");
    writeFileSync(html, '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" ' +
        'content="default-src \'none\'; script-src file:; style-src file: \'unsafe-inline\'; img-src blob: http: https:; font-src file:; ' +
        'connect-src \'none\'; frame-src \'none\'; object-src \'none\'; base-uri \'none\'"></head><body></body></html>', "utf8");
    const script = path.join(temporary, "run.cjs");
    const cdn = pathToFileURL(path.resolve(__dirname, "../../node_modules/vditor")).href;
    const lutePath = pathToFileURL(path.resolve(__dirname, "../../stage/protyle/js/lute/lute.min.js")).href;
    writeFileSync(script, `const {app, BrowserWindow, ipcMain, clipboard} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show:false, width:1000, height:720, webPreferences:{nodeIntegration:true, contextIsolation:false}});
    ipcMain.handle("markdown-undo-input", (_event, text) => win.webContents.debugger.sendCommand("Input.insertText", {text}));
    ipcMain.handle("copy-seed", () => clipboard.writeText("old clipboard"));
    ipcMain.handle("copy-read", () => clipboard.readText());
    ipcMain.handle("copy-mouse", (_event, event) => win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", event));
    const initialClipboard = await clipboard.readText();
    const external = [];
    win.webContents.session.webRequest.onBeforeRequest({urls:["http://*/*","https://*/*"]}, (details, callback) => {
        external.push(details.url);
        callback({cancel: true});
    });
    try {
        await win.loadFile(${JSON.stringify(html)});
        win.webContents.debugger.attach("1.3");
        await win.webContents.debugger.sendCommand("Emulation.setDeviceMetricsOverride",
            {width:1000, height:720, deviceScaleFactor:1, mobile:false});
        await win.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", {enabled: true});
        await win.webContents.debugger.sendCommand("Emulation.setEmulatedMedia",
            {features:[{name:"prefers-reduced-motion",value:"no-preference"}]});
        await win.webContents.executeJavaScript(${JSON.stringify("globalThis.Vditor = require(" + JSON.stringify(path.resolve(__dirname, "../../node_modules/vditor")) + "); void 0;")});
        await win.webContents.executeJavaScript(${JSON.stringify(bundle + "\nvoid 0;")});
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(
        `const __name = value => value; (${browserCases.toString()})(${JSON.stringify(cdn)},${JSON.stringify(lutePath)})`)}));
        if (external.length) throw new Error("Unexpected external requests: " + external.join(","));
        await clipboard.writeText(initialClipboard);
        win.destroy(); app.exit(0);
    } catch (error) {console.error(error); await clipboard.writeText(initialClipboard); win.destroy(); app.exit(1);}
});`, "utf8");
    const env: NodeJS.ProcessEnv = {...process.env, XDG_CACHE_HOME: path.join(temporary, "cache")};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string,
            [...(process.platform === "linux" ? ["--ozone-platform=headless"] : []), script],
            {env, timeout: 40000, windowsHide: true});
        assert.match(result.stdout, /Markdown code history DOM cases passed/);
    } finally {
        assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
        assert.ok(path.basename(temporary).startsWith("siyuan-markdown-editor-test-"));
        rmSync(temporary, {recursive: true, force: true});
    }
});
