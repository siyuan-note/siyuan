import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join, resolve} from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const setup = (source: string) => {
    const api = {} as typeof import("./compositionInput");
    new Function("exports", source)(api);
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    editor.style.whiteSpace = "pre-wrap";
    document.body.replaceChildren(editor);
    let finish: ReturnType<typeof api.prepareInlineMathComposition>;
    let events: string[];
    editor.addEventListener("compositionstart", () => {
        finish = api.prepareInlineMathComposition(getSelection().getRangeAt(0));
        events.push(finish ? "prepared" : "native");
    });
    editor.addEventListener("compositionend", event => {
        finish?.(!!event.data, true);
        finish = undefined;
        events.push(event.data);
    });
    Object.assign(window, {
        selectFormula: (backward: boolean, textBoundaries: boolean, surrounding: boolean) => {
            events = [];
            const formula = '<span data-type="inline-math" contenteditable="false" data-content="x^2"><span>x²</span></span>';
            editor.innerHTML = surrounding ? "Before " + formula + " after" : formula;
            editor.focus();
            const selection = getSelection();
            if (textBoundaries) {
                const before = editor.firstChild;
                const after = editor.lastChild;
                selection.setBaseAndExtent(backward ? after : before, backward ? 0 : before.textContent.length,
                    backward ? before : after, backward ? before.textContent.length : 0);
            } else {
                const start = surrounding ? 1 : 0;
                selection.setBaseAndExtent(editor, backward ? start + 1 : start, editor, backward ? start : start + 1);
            }
        },
        selectText: () => {
            events = [];
            const text = editor.firstChild;
            getSelection().setBaseAndExtent(text, 0, text, 6);
        },
        state: () => ({text: editor.textContent, formula: editor.querySelector("span")?.dataset.content ?? null,
            events, selected: getSelection().toString()}),
    });
};

test("native composition replaces a selected inline formula and cancellation restores it", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 30000,
}, async () => {
    const source = transpileModule(readFileSync(join(__dirname, "compositionInput.ts"), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const profile = mkdtempSync(join(tmpdir(), "siyuan-inline-math-ime-"));
    const runner = join(profile, "run.cjs");
    const setupScript = "(() => { const __name = value => value; (" + setup.toString() + ")(" + JSON.stringify(source) + "); })()";
    writeFileSync(runner, [
        'const assert = require("node:assert/strict");',
        'const {app, BrowserWindow} = require("electron");',
        "app.setPath('userData', " + JSON.stringify(join(profile, "data")) + ");",
        "app.whenReady().then(async () => {",
        "    const win = new BrowserWindow({show: false, webPreferences: {offscreen: true, backgroundThrottling: false}});",
        "    try {",
        "        await win.loadURL('about:blank');",
        "        const run = script => win.webContents.executeJavaScript(script);",
        "        win.webContents.debugger.attach('1.3');",
        "        const cdp = (method, params) => win.webContents.debugger.sendCommand(method, params);",
        "        await cdp('Emulation.setFocusEmulationEnabled', {enabled: true});",
        "        await run(" + JSON.stringify(setupScript) + ");",
        "        const preedit = text => cdp('Input.imeSetComposition', {text, selectionStart: text.length, selectionEnd: text.length});",
        "        for (const selected of ['false, false, true', 'true, true, true', 'false, false, false']) {",
        "            await run('selectFormula(' + selected + ')');",
        "            const initial = (await run('state()')).text;",
        "            await preedit('ni');",
        "            assert.equal((await run('state()')).formula, null);",
        "            await preedit('');",
        "            assert.deepEqual(await run('state()'), {text: initial, formula: 'x^2', events: ['prepared', ''], selected: 'x²'});",
        "            await run('selectFormula(' + selected + ')');",
        "            await preedit('ni');",
        "            await cdp('Input.insertText', {text: '你'});",
        "            assert.deepEqual(await run('state()'), {text: initial.replace('x²','你'), formula: null, events: ['prepared', '你'], selected: ''});",
        "        }",
        "        await run('selectFormula(false, false, true); selectText();');",
        "        await preedit('ni');",
        "        await cdp('Input.insertText', {text: '你'});",
        "        assert.deepEqual(await run('state()'), {text: '你 x² after', formula: 'x^2', events: ['native', '你'], selected: ''});",
        "        win.destroy(); app.exit(0);",
        "    } catch (error) { console.error(error); win.destroy(); app.exit(1); }",
        "});",
    ].join("\n"), "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        await promisify(execFile)(require("electron") as string, [runner], {env, timeout: 25000, windowsHide: true});
    } finally {
        assert.equal(dirname(resolve(profile)), resolve(tmpdir()));
        assert.ok(profile.startsWith(join(tmpdir(), "siyuan-inline-math-ime-")));
        rmSync(profile, {recursive: true, force: true});
    }
});
