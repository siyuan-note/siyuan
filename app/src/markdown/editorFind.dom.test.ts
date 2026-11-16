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
    const source = "# Alpha\n\nAlpha **be**ta and [Alpha](https://example.com/Alpha)\n\n- Alpha\n\n| Name | Value |\n| ---- | ----- |\n| A | Alpha |\n\n```js\nAlpha <tag>\n```\n";
    const tick = () => new Promise(resolve => setTimeout(resolve, 340));
    for (const mobile of [false, true]) {
        for (const mode of ["ir", "wysiwyg", "sv"] as const) {
            const host = document.createElement("div");
            host.style.height = "400px";
            document.body.append(host);
            const snapshots: import("./contracts").MarkdownEditorSnapshot[] = [];
            const editor = await api.createMarkdownEditor({element: host, initialValue: source, mode, cdn, lutePath, mobile,
                onEdit: value => snapshots.push({...value})});
            const panel = host.querySelector<HTMLElement>(".vditor-find");
            try {
                editor.openFind();
                check.equal(panel.hidden, false);
                check.equal(panel.querySelector(".vditor-find__scope"), null);
                const query = panel.querySelector<HTMLInputElement>('input[type="search"]');
                check.ok(query.classList.contains("b3-text-field"));
                check.equal(query.classList.contains("b3-text-field--touch"), mobile);
                const navigation = Array.from(panel.querySelector(".vditor-find__row").querySelectorAll<HTMLButtonElement>("button")).slice(0, 2);
                check.deepEqual(navigation.map(button => button.textContent), ["Previous", "Next"]);
                check.ok(navigation.every(button => button.disabled));
                const find = async (value: string) => {
                    query.value = value;
                    query.dispatchEvent(new Event("input", {bubbles: true}));
                    await tick();
                    return panel.querySelector("output").textContent;
                };
                const expected = mode === "sv" ? 7 : 6;
                check.equal(await find("no-result"), "0/0");
                check.ok(navigation.every(button => button.disabled));
                check.equal(await find("Alpha"), `1/${expected}`);
                check.ok(navigation.every(button => !button.disabled));
                check.equal(editor.flush().content, source, "find preserves the original source");
                check.equal(editor.flush().edited, false);
                check.equal(snapshots.length, 0, "find does not enqueue a save");
                panel.querySelector<HTMLButtonElement>("button[aria-expanded]").click();
                const replacement = panel.querySelector<HTMLInputElement>('input:not([type="search"]):not([type="checkbox"])');
                const row = replacement.parentElement;
                const replace = row.querySelector<HTMLButtonElement>("button");
                const replaceAll = row.querySelectorAll<HTMLButtonElement>("button")[1];
                check.ok(replace.classList.contains("b3-button--text"));
                check.equal(replace.classList.contains("b3-button--touch"), mobile);
                replacement.value = "Omega";
                replaceAll.click();
                await tick();
                check.ok(editor.flush().edited, "native replacement marks the document as edited");
                check.ok(snapshots.some(snapshot => snapshot.edited && snapshot.content.includes("Omega")), "replacement reaches normal save notifications");
                check.equal(await find("Omega"), `1/${expected}`);
                const after = editor.flush().content;
                editor.undo(); await tick();
                check.equal(await find("Alpha"), `1/${expected}`, "replace all undoes in one step");
                editor.redo(); await tick();
                check.equal(editor.flush().content, after);
                await find("Omega");
                replacement.value = "*literal* <b> & $&";
                replace.click(); await tick();
                check.equal(await find("*literal* <b> & $&"), "1/1", "replacement stays literal through the shared Lute and resource policy");
                const before = editor.flush().content;
                host.inert = true;
                replaceAll.click(); await tick();
                check.equal(editor.flush().content, before, "frozen documents reject replacement");
                host.inert = false;
                editor.setValue(source);
                check.equal(panel.hidden, true, "new content closes find");
            } finally {editor.destroy(); host.remove();}
        }
    }
    const host = document.createElement("div");
    document.body.append(host);
    let oversize = 0;
    const editor = await api.createMarkdownEditor({element: host, initialValue: "Alpha\n", mode: "ir", cdn, lutePath,
        onEdit: () => {}, onContentTooLarge: () => oversize++});
    editor.openFind();
    const panel = host.querySelector<HTMLElement>(".vditor-find");
    const query = panel.querySelector<HTMLInputElement>('input[type="search"]');
    query.value = "Alpha"; query.dispatchEvent(new Event("input", {bubbles: true}));
    panel.querySelector<HTMLButtonElement>("button[aria-expanded]").click();
    const replacement = panel.querySelector<HTMLInputElement>('input:not([type="search"]):not([type="checkbox"])');
    replacement.value = "word ".repeat(60000);
    const replace = replacement.parentElement.querySelector<HTMLButtonElement>("button");
    await tick(); replace.click(); await tick();
    check.ok(host.querySelector<HTMLTextAreaElement>(".vditor-sv").value.startsWith("word word"), "large replacements switch to source before rendering");
    editor.undo(); await tick();
    check.equal(editor.flush().content.trim(), "Alpha");
    editor.openFind();
    query.value = "Alpha"; query.dispatchEvent(new Event("input", {bubbles: true}));
    replacement.value = "x".repeat(9 * 1024 * 1024);
    await tick(); replace.click(); await tick();
    check.equal(oversize, 1, "oversize replacements are rejected before live content changes");
    check.equal(editor.flush().content.trim(), "Alpha");
    editor.destroy(); host.remove();
    return "Markdown find integration cases passed";
};

test("native Vditor find integrates save notifications, shared controls, history and size guards", {timeout: 60000}, async () => {
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-markdown-find-test-"));
    const compile = (name: string) => transpileModule(readFileSync(path.join(__dirname, name), "utf8")
        .replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, "")
        .replace('require("vditor")', "globalThis.Vditor"), {compilerOptions: {target: ScriptTarget.ES2022}}).outputText;
    const bundle = ["identity.ts", "limits.ts", "resourcePolicy.ts", "link.ts", "panelAnimation.ts", "editor.ts"].map(compile).join("\n") +
        "\nwindow.MarkdownEditorTest = {createMarkdownEditor};";
    const html = path.join(temporary, "index.html");
    writeFileSync(html, '<!doctype html><meta charset="utf-8"><body></body>', "utf8");
    const script = path.join(temporary, "run.cjs");
    const dependency = path.resolve(__dirname, "../../node_modules/vditor");
    const cdn = pathToFileURL(dependency).href;
    const lutePath = pathToFileURL(path.resolve(__dirname, "../../stage/protyle/js/lute/lute.min.js")).href;
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show:false, width:1000, height:720, webPreferences:{nodeIntegration:true, contextIsolation:false}});
    try {
        await win.loadFile(${JSON.stringify(html)});
        await win.webContents.executeJavaScript(${JSON.stringify("globalThis.Vditor = require(" + JSON.stringify(dependency) + "); void 0;")});
        await win.webContents.executeJavaScript(${JSON.stringify(bundle + "\nvoid 0;")});
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(
        `const __name = value => value; (${browserCases.toString()})(${JSON.stringify(cdn)},${JSON.stringify(lutePath)})`)}));
        win.destroy(); app.exit(0);
    } catch (error) {console.error(error); win.destroy(); app.exit(1);}
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string,
            [...(process.platform === "linux" ? ["--ozone-platform=headless"] : []), script], {env, timeout: 55000, windowsHide: true});
        assert.match(result.stdout, /Markdown find integration cases passed/);
    } finally {rmSync(temporary, {recursive: true, force: true});}
});
