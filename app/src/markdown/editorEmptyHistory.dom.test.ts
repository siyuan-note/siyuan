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
    const primaryModifier = /Mac/i.test(navigator.platform) ? {metaKey: true} : {ctrlKey: true};
    const tick = () => new Promise(resolve => setTimeout(resolve, 0));
    for (const mode of ["ir", "wysiwyg", "sv"] as const) {
        const emptyHost = document.createElement("div");
        document.body.append(emptyHost);
        const emptyEditor = await api.createMarkdownEditor({element: emptyHost, initialValue: "", mode, cdn, lutePath,
            onEdit: () => {}});
        emptyEditor.focus();
        await require("electron").ipcRenderer.invoke("markdown-undo-input", "abc");
        await tick();
        emptyEditor.undo();
        await tick();
        check.equal(emptyEditor.flush().content.trim(), "", `undo to empty in ${mode}`);
        const emptySurface = emptyHost.querySelector<HTMLElement>(mode === "sv" ? "textarea" : `.vditor-${mode} .vditor-reset`);
        if (mode !== "sv") {
            check.ok(emptySurface.contains(getSelection().anchorNode), `empty undo caret stays inside ${mode}`);
        }
        emptyEditor.redo();
        await tick();
        check.equal(emptyEditor.flush().content.trim(), "abc", `redo from empty in ${mode}`);
        emptySurface.dispatchEvent(new KeyboardEvent("keydown", {key: "z", code: "KeyZ", ...primaryModifier,
            bubbles: true, cancelable: true}));
        await tick();
        check.equal(emptyEditor.flush().content.trim(), "", `keyboard undo to empty in ${mode}`);
        if (mode !== "sv") {
            check.ok(emptySurface.contains(getSelection().anchorNode), `keyboard undo caret stays inside ${mode}`);
        }
        await require("electron").ipcRenderer.invoke("markdown-undo-input", "next");
        await tick();
        check.equal(emptyEditor.flush().content.trim(), "next", `typing after empty undo in ${mode}`);
        emptyEditor.destroy();
        emptyHost.remove();
    }
    return "Markdown editor DOM cases passed";
};
test("empty Markdown history retains the caret and accepts continued input", {
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
    writeFileSync(script, `const {app, BrowserWindow, ipcMain} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show:false, width:1000, height:720, webPreferences:{nodeIntegration:true, contextIsolation:false}});
    ipcMain.handle("markdown-undo-input", (_event, text) => win.webContents.debugger.sendCommand("Input.insertText", {text}));
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
        win.destroy(); app.exit(0);
    } catch (error) {console.error(error); win.destroy(); app.exit(1);}
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string,
            [...(process.platform === "linux" ? ["--ozone-platform=headless"] : []), script],
            {env, timeout: 40000, windowsHide: true});
        assert.match(result.stdout, /Markdown editor DOM cases passed/);
    } finally {
        assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
        assert.ok(path.basename(temporary).startsWith("siyuan-markdown-editor-test-"));
        rmSync(temporary, {recursive: true, force: true});
    }
});
