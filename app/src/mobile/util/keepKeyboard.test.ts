import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const checkKeyboard = (code: string, css: string) => {
    const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
    let mobile = true;
    const exports = {} as typeof import("./keepKeyboard");
    new Function("require", "exports", code)(() => ({isMobile: () => mobile}), exports);
    Object.defineProperty(window, "siyuan", {value: {languages: {sourceRemovalPending: "Finish the current deletion confirmation"}}});
    document.body.innerHTML = `<style>${css}</style><div id="owner"><div id="editor" contenteditable="true">unchanged</div></div><button id="other">Other</button>`;
    const owner = document.getElementById("owner");
    const editor = document.getElementById("editor");
    editor.focus();
    const guard = exports.preserveMobileEditorKeyboard(owner);
    check(guard?.hasFocus(), "the input guard takes focus before the editor becomes inert");
    owner.inert = true;
    const input = document.activeElement as HTMLTextAreaElement;
    check(input.tagName === "TEXTAREA" && guard.hasFocus(), "an editable element stays focused outside the inert owner");
    check(getComputedStyle(input).opacity === "0" && input.tabIndex === -1, "the temporary input is invisible and outside tab navigation");
    const event = new InputEvent("beforeinput", {bubbles: true, cancelable: true, inputType: "insertText", data: "blocked"});
    input.dispatchEvent(event);
    check(event.defaultPrevented && editor.textContent === "unchanged", "pending input cannot change the protected source");
    owner.inert = false;
    editor.focus({preventScroll: true});
    guard.release();
    check(document.activeElement === editor && !document.querySelector(".protyle-keyboard-guard"), "focus returns before the guard is removed");
    const second = exports.preserveMobileEditorKeyboard(owner);
    document.getElementById("other").focus();
    check(!second.hasFocus(), "a deliberate focus change is detected");
    second.release();
    check(document.activeElement.id === "other", "releasing the guard does not steal another control's focus");
    mobile = false;
    editor.focus();
    check(exports.preserveMobileEditorKeyboard(owner) === undefined, "desktop editors use their existing focus policy");
    mobile = true;
    document.getElementById("other").focus();
    check(exports.preserveMobileEditorKeyboard(owner) === undefined, "non-editor focus is preserved");
    return "keyboard-guard-ok";
};

test("mobile deletion checks keep an editable focus while the source stays inert", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 30000,
}, async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "siyuan-keyboard-guard-"));
    const script = path.join(directory, "main.cjs");
    const code = transpileModule(readFileSync("src/mobile/util/keepKeyboard.ts", "utf8"), {
        compilerOptions: {target: ScriptTarget.ES2022, module: ModuleKind.CommonJS},
    }).outputText;
    const css = readFileSync("src/assets/scss/protyle/_protyle.scss", "utf8").match(/\.protyle-keyboard-guard \{[^}]+\}/)[0];
    const execute = transpileModule(`const __name = value => value; try { (${checkKeyboard.toString()})(${JSON.stringify(code)}, ${JSON.stringify(css)}); } catch (error) { String(error.stack); }`, {
        compilerOptions: {target: ScriptTarget.ES2022},
    }).outputText;
    writeFileSync(script, `const {app,BrowserWindow}=require("electron");app.setPath("userData",${JSON.stringify(path.join(directory, "profile"))});
app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,webPreferences:{offscreen:true}});
try{await win.loadURL("about:blank");console.log(await win.webContents.executeJavaScript(${JSON.stringify(execute)}));app.exit(0)}
catch(error){console.error(error);app.exit(1)}});`);
    try {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const result = await promisify(execFile)(require("electron") as unknown as string, [script, "--no-sandbox"], {env, timeout: 25000});
        assert.match(result.stdout, /keyboard-guard-ok/);
    } finally {
        if (path.dirname(path.resolve(directory)) === path.resolve(tmpdir()) && path.basename(directory).startsWith("siyuan-keyboard-guard-")) {
            rmSync(directory, {recursive: true, force: true, maxRetries: 20, retryDelay: 100});
        }
    }
});
