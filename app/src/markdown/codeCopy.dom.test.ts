import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";

const browserCases = (vditorPath: string) => {
    const check: typeof assert = require("node:assert/strict");
    let copiedText = "";
    const clipboard = {writeText: (text: string) => {copiedText = text;}, readText: () => copiedText};
    document.execCommand = command => {
        check.equal(command, "copy");
        const target = document.activeElement as HTMLTextAreaElement;
        copiedText = target.value.slice(target.selectionStart, target.selectionEnd);
        return true;
    };
    const Vditor = require(vditorPath);
    Object.assign(window, {VditorI18n: {copy: "Copy", copied: "Copied"}});
    const focus = document.createElement("div");
    focus.contentEditable = "true";
    focus.textContent = "Keep selection";
    document.body.append(focus);
    const select = () => {
        focus.focus();
        const range = document.createRange();
        range.selectNodeContents(focus);
        getSelection().removeAllRanges(); getSelection().addRange(range);
    };
    const content = "const value = '<tag>';\n  second line";
    const fixture = () => {
        const root = document.createElement("div");
        const pre = document.createElement("pre");
        const code = document.createElement("code");
        code.textContent = content + "\n";
        pre.append(code); root.append(pre); document.body.append(root);
        Vditor.codeRender(root);
        return root;
    };
    for (let repeat = 0; repeat < 2; repeat++) {
        const root = fixture();
        const button = root.querySelector<HTMLElement>(".vditor-copy > span");
        check.equal(button.hasAttribute("onclick"), false);
        check.equal(button.hasAttribute("onmouseover"), false);
        check.equal(button.getAttribute("role"), "button");
        for (const activation of ["click", "Enter", " "]) {
            select(); clipboard.writeText("original");
            if (activation === "click") button.querySelector("svg").dispatchEvent(new MouseEvent("click", {bubbles: true}));
            else button.dispatchEvent(new KeyboardEvent("keydown", {key: activation, bubbles: true, cancelable: true}));
            check.equal(clipboard.readText(), content);
            check.equal(button.getAttribute("aria-label"), "Copied");
            check.equal(document.activeElement, focus);
            check.equal(getSelection().toString(), "Keep selection");
            button.dispatchEvent(new MouseEvent("mouseover"));
            check.equal(button.getAttribute("aria-label"), "Copy");
        }
        const execCommand = document.execCommand.bind(document);
        document.execCommand = () => false;
        button.click();
        check.equal(button.getAttribute("aria-label"), "Copy", "a failed copy does not report success");
        document.execCommand = execCommand;
        const source = document.createElement("textarea");
        source.value = "source selection";
        document.body.append(source);
        source.focus(); source.setSelectionRange(2, 8);
        button.click();
        check.equal(document.activeElement, source);
        check.equal(source.selectionStart, 2);
        check.equal(source.selectionEnd, 8);
        source.remove();
        root.remove();
    }
    return "Markdown code copy DOM cases passed";
};

test("Markdown code copy works with strict CSP and preserves selection", {timeout: 45000}, async () => {
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-code-copy-"));
    const html = path.join(temporary, "index.html");
    writeFileSync(html, '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src file:; style-src \'unsafe-inline\'"><body></body>');
    const script = path.join(temporary, "run.cjs");
    writeFileSync(script, `const {app,BrowserWindow}=require("electron");
app.setPath("userData",${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,webPreferences:{nodeIntegration:true,contextIsolation:false,offscreen:true}});
 win.webContents.on("console-message", (_event, _level, message)=>console.error(message));
 try {
  await win.loadFile(${JSON.stringify(html)});
  console.log(await win.webContents.executeJavaScript(${JSON.stringify("const __name=value=>value; (" + browserCases.toString() + ")(" + JSON.stringify(path.resolve(__dirname, "../../node_modules/vditor")) + ")")},true));
  win.destroy(); app.exit(0);
 } catch(error){console.error(error);win.destroy();app.exit(1);}
});`);
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    const args = process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY ?
        ["--ozone-platform=headless", script] : [script];
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, args, {env, timeout: 40000});
        assert.match(result.stdout, /Markdown code copy DOM cases passed/);
    } finally {
        rmSync(temporary, {recursive: true, force: true});
    }
});
