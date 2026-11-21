import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join, resolve} from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const setup = (source: string) => {
    document.body.innerHTML = '<div id="editor" contenteditable="true"><div class="av" data-av-type="table">' +
        '<div class="av__container"><div id="primary" class="av__cell" data-dtype="block" data-detached="true"></div>' +
        '<div id="text" class="av__cell" data-dtype="text"></div>' +
        '<div class="av__cursor" contenteditable="true">&#8203;</div></div></div></div>';
    const editor = document.querySelector<HTMLElement>("#editor");
    const block = editor.querySelector<HTMLElement>(".av");
    const cursor = editor.querySelector<HTMLElement>(".av__cursor");
    const forwarded: string[] = [];
    const opened: string[][] = [];
    const options = {history: {}};
    const protyle = {options};
    const menu = document.createElement("div");
    menu.className = "fn__none";
    Object.assign(window, {siyuan: {config: {}, menus: {menu: {element: menu}}}});
    const focusBlock = () => {
        editor.focus();
        const range = document.createRange();
        range.setStart(cursor.firstChild, 0);
        range.collapse(true);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
        return range;
    };
    const select = (id: string) => {
        editor.querySelector(".av__cell--select")?.classList.remove("av__cell--select");
        const cell = editor.querySelector<HTMLElement>("#" + id);
        cell.classList.add("av__cell--select");
        return cell;
    };
    const modules: Record<string, unknown> = {
        "../../../constants": {Constants: {ZWSP: "\u200b"}},
        "../../util/selection": {focusBlock},
        "./cell": {addDragFill() {}, hasAVPrimaryTemplate: () => false,
            popTextCell: (_protyle: unknown, cells: HTMLElement[], _type: string, input: {initialInput: string}) =>
                opened.push([cells[0].id, input.initialInput])},
        "./rangeSelect": {setAVCellAnchor: (_block: HTMLElement, cell: HTMLElement) => select(cell.id)},
        "./selectionState": {getAVCellSelection: (): undefined => undefined},
        "./viewType": {isTableLikeView: (view: string) => view === "table" || view === "list"},
    };
    const api = {} as typeof import("./cellTyping");
    new Function("exports", "require", source)(api, (id: string) => modules[id]);
    api.bindAVCellTyping(protyle as IProtyle, editor);
    for (const type of ["compositionstart", "beforeinput", "input", "compositionend"]) {
        editor.addEventListener(type, () => forwarded.push(type));
    }
    api.selectNewAVPrimary(protyle as IProtyle, block, editor.querySelector("#primary"));
    Object.assign(window, {
        select,
        state: () => ({opened, forwarded, cursor: cursor.textContent, selected: editor.querySelector(".av__cell--select")?.id}),
    });
};

test("database selection opens a text editor once with committed native input", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 30000,
}, async () => {
    const source = transpileModule(readFileSync("src/protyle/render/av/cellTyping.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const profile = mkdtempSync(join(tmpdir(), "siyuan-av-cell-typing-"));
    const runner = join(profile, "run.cjs");
    const setupScript = `(() => { const __name = value => value; (${setup.toString()})(${JSON.stringify(source)}); })()`;
    writeFileSync(runner, `const assert = require("node:assert/strict");
const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(join(profile, "data"))});
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {offscreen: true, backgroundThrottling: false}});
    try {
        await win.loadURL("about:blank");
        const run = script => win.webContents.executeJavaScript(script);
        const cdp = (method, params) => win.webContents.debugger.sendCommand(method, params);
        win.webContents.debugger.attach("1.3");
        await cdp("Emulation.setFocusEmulationEnabled", {enabled: true});
        await run(${JSON.stringify(setupScript)});
        const state = () => run("state()");
        const preedit = text => cdp("Input.imeSetComposition", {text, selectionStart: text.length, selectionEnd: text.length});
        const insert = text => cdp("Input.insertText", {text});
        const initial = {opened: [], forwarded: [], cursor: "\\u200b", selected: "primary"};
        assert.deepEqual(await state(), initial);
        await preedit("zhong");
        assert.deepEqual((await state()).opened, []);
        await preedit("");
        assert.deepEqual(await state(), initial);
        await preedit("zhongwen");
        await insert("中文");
        const committed = {...initial, opened: [["primary", "中文"]]};
        assert.deepEqual(await state(), committed);
        await preedit("hao");
        await run("select('text'); void 0;");
        await insert("好");
        assert.deepEqual(await state(), {...committed, selected: "text"});
        await insert("日");
        assert.deepEqual(await state(), {...committed, selected: "text", opened: [...committed.opened, ["text", "日"]]});
        win.destroy();
        app.exit(0);
    } catch (error) {
        console.error(error);
        win.destroy();
        app.exit(1);
    }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        await promisify(execFile)(require("electron"), [runner], {env, windowsHide: true, timeout: 25000});
    } finally {
        assert.equal(dirname(resolve(profile)), resolve(tmpdir()));
        assert.ok(profile.startsWith(join(tmpdir(), "siyuan-av-cell-typing-")));
        rmSync(profile, {recursive: true, force: true, maxRetries: 5});
    }
});
