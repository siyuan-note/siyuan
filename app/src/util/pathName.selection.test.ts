import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (sourceCode: string) => {
    const check: typeof assert = require("node:assert/strict");
    const api = {} as typeof import("./pathName");
    let mobile = false;
    let listRequests = 0;
    const notebooks = [
        {id: "a", name: "Notebook A"}, {id: "b", name: "Notebook B"},
        {id: "secret", name: "Encrypted", encrypted: true}, {id: "closed", name: "Closed", closed: true},
    ];
    const file = (name: string, notebook = "a") => ({name, path: `/${name}.sy`, box: notebook, hPath: `/${name}`, subFileCount: 0});
    Object.assign(window, {siyuan: {notebooks, config: {search: {}}, storage: {move: {k: "", keys: []}}, dialogs: [],
        languages: {confirm: "Confirm", cancel: "Cancel", specifyPath: "Specify path", searchPlaceholder: "Search"},
        menus: {menu: {element: document.createElement("div")}}}});
    new Function("exports", "require", sourceCode)(api, (name: string) => ({
        "../dialog": {Dialog: class {
            element = document.createElement("div");
            constructor(options: {title: string, content: string}) {
                this.element.innerHTML = `<div class="b3-dialog__header">${options.title}</div>${options.content}`;
                document.body.append(this.element);
                window.siyuan.dialogs.push(this as any);
            }
            destroy() {
                this.element.remove();
                window.siyuan.dialogs.splice(window.siyuan.dialogs.indexOf(this as any), 1);
            }
        }},
        "./fetch": {fetchPost: (url: string, data: any, cb: (response: any) => void) => {
            if (url.endsWith("lsNotebooks")) { cb({data: {notebooks}}); }
            else if (url.endsWith("listDocsByPath")) {
                listRequests++;
                cb({data: {files: [file("parent"), file("other")]}});
            } else if (url.endsWith("searchDocs")) {
                queueMicrotask(() => cb({data: data.k === "none" ? [] :
                    data.k === "b" ? [file("beta", "b")] : [file("parent"), file("hidden", "secret")]}));
            } else { check.fail(url); }
        }},
        "./functions": {isMobile: () => mobile},
        "./escape": {escapeHtml: (text: string) => text, escapeHtmlTextAndAttr: (text: string) => text, escapeAriaLabel: (text: string) => text},
        "../constants": {Constants: {LOCAL_MOVE_PATH: "move"}},
        "../emoji/fileTreeIcon": {getFileTreeDefaultIconAttr: () => "", getFileTreeIconHTML: () => ""},
        "../protyle/util/compatibility": {updateHotkeyTip: (text: string) => text, setStorageVal() {}, isOnlyMeta: (event: MouseEvent) => event.ctrlKey},
        "../protyle/util/hotKey": {matchHotKey: () => false},
        "./fileTreeTooltip": {genFileTreeDocAriaLabel: () => "Document"},
        "./searchHighlight": {highlightSearchText: (text: string) => text},
        "./addClearButton": {addClearButton() {}},
        "../layout/dock/fileTreeAnimation": {expandFileTree() {}},
    })[name] || {});
    const tick = () => new Promise(resolve => setTimeout(resolve, 0));
    for (mobile of [false, true]) {
        let result: {paths: string[], boxes: string[]};
        let valid = false;
        api.movePathTo({title: "Watch scope", flashcard: false, multiple: true, sourceNotebookIds: ["a"],
            validate: () => valid, cb: (paths, boxes) => { result = {paths, boxes}; }});
        const dialog = document.body.lastElementChild as HTMLElement;
        const tree = dialog.querySelector<HTMLElement>("#foldTree");
        const list = dialog.querySelector<HTMLElement>("#foldList");
        const input = dialog.querySelector<HTMLInputElement>(".b3-text-field");
        const confirm = dialog.querySelector<HTMLButtonElement>(".b3-button--text");
        const row = (root: HTMLElement, notebook: string, path = "/") => root.querySelector<HTMLElement>(`[data-box="${notebook}"][data-path="${path}"]`);
        const checkbox = (element: HTMLElement) => element.querySelector<HTMLInputElement>("[data-path-select]");
        const search = async (value: string) => {
            input.value = value;
            input.dispatchEvent(new Event("input", {bubbles: true}));
            await tick();
        };
        check.equal(tree.querySelectorAll("[data-path-select]").length, 2);
        check.equal(confirm.disabled, true);
        check.equal(confirm.textContent, "Confirm (0)");
        const before = listRequests;
        row(tree, "a").querySelector<HTMLElement>(".b3-list-item__text").click();
        check.equal(listRequests, before, "selecting a notebook must not expand it");
        check.equal(checkbox(row(tree, "a")).checked, true);
        row(tree, "a").querySelector<HTMLElement>(".b3-list-item__toggle").click();
        check.equal(listRequests, before + 1);
        row(tree, "a", "/parent.sy").click();
        check.equal(confirm.textContent, "Confirm (2)");
        row(tree, "a").querySelector<HTMLElement>(".b3-list-item__toggle").click();
        row(tree, "a").querySelector<HTMLElement>(".b3-list-item__toggle").click();
        check.equal(checkbox(row(tree, "a", "/parent.sy")).checked, true);
        await search("parent");
        check.equal(list.querySelectorAll("[data-path-select]").length, 1, "encrypted search results must be excluded");
        check.equal(checkbox(row(list, "a", "/parent.sy")).checked, true);
        checkbox(row(list, "a", "/parent.sy")).click();
        check.equal(confirm.textContent, "Confirm (1)");
        check.equal(checkbox(row(tree, "a", "/parent.sy")).checked, false);
        checkbox(row(list, "a", "/parent.sy")).click();
        await search("b");
        input.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowDown", bubbles: true}));
        check.equal(confirm.textContent, "Confirm (2)", "navigation must preserve checked items");
        row(list, "b", "/beta.sy").click();
        check.equal(confirm.textContent, "Confirm (3)");
        confirm.click();
        check.equal(result, undefined, "failed validation must retain the dialog and selection");
        check.equal(dialog.isConnected, true);
        await search("none");
        valid = true;
        input.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
        check.deepEqual(result, {paths: ["/", "/parent.sy", "/beta.sy"], boxes: ["a", "a", "b"]});
        check.equal(dialog.isConnected, false);

        api.movePathTo({title: "Watch scope", flashcard: false, multiple: true, sourceNotebookIds: ["a"],
            cb: () => check.fail("cancel submitted selected paths")});
        const cancelled = document.body.lastElementChild as HTMLElement;
        cancelled.querySelector<HTMLInputElement>("[data-path-select]").click();
        cancelled.querySelector<HTMLButtonElement>(".b3-button--cancel").click();
        check.equal(cancelled.isConnected, false);

        let single: string[];
        api.movePathTo({flashcard: false, sourceNotebookIds: ["a"], cb: paths => { single = paths; }});
        const normal = document.body.lastElementChild as HTMLElement;
        check.equal(normal.querySelector("[data-path-select]"), null);
        normal.querySelector<HTMLElement>('[data-box="b"]').click();
        normal.querySelector<HTMLButtonElement>(".b3-button--text").click();
        check.deepEqual(single, ["/"]);

        let legacy: string[];
        api.movePathTo({title: "Specify path", flashcard: false, sourceNotebookIds: ["a"], cb: (_paths, boxes) => { legacy = boxes; }});
        const specified = document.body.lastElementChild as HTMLElement;
        specified.querySelector('[data-box="b"]').dispatchEvent(new MouseEvent("click", {bubbles: true, ctrlKey: true}));
        specified.querySelector<HTMLButtonElement>(".b3-button--text").click();
        check.deepEqual(legacy, ["a", "b"]);

        api.movePathTo({flashcard: false, multiple: true, sourceNotebookIds: ["secret"], cb() {}});
        const encrypted = document.body.lastElementChild as HTMLElement;
        check.equal(encrypted.querySelectorAll("[data-path-select]").length, 1);
        check.equal(encrypted.querySelector<HTMLElement>("[data-box]").dataset.box, "secret");
        encrypted.querySelector<HTMLButtonElement>(".b3-button--cancel").click();
        window.siyuan.storage.move.k = "";
    }
    return "Path selection DOM cases passed";
};

test("path picker preserves multiple selections across tree and search on desktop and mobile and retains single selection callers", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const source = transpileModule(readFileSync("src/util/pathName.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText;
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-path-selection-"));
    const script = path.join(temporary, "run.cjs");
    const cases = transpileModule(`const browserCases = ${browserCases.toString()};`, {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText;
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
    win.webContents.on("console-message", event => console.error(event.message));
    try {
        await win.loadURL("about:blank");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(`const __name = value => value; ${cases}\nbrowserCases(${JSON.stringify(source)})`)}));
        win.destroy(); app.exit(0);
    } catch (error) { console.error(error); win.destroy(); app.exit(1); }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const {stdout} = await promisify(execFile)(require("electron") as unknown as string, [script], {env, timeout: 40000, windowsHide: true});
        assert.match(stdout, /Path selection DOM cases passed/);
    } finally {
        assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
        assert.ok(path.basename(temporary).startsWith("siyuan-path-selection-"));
        rmSync(temporary, {recursive: true, force: true});
    }
});
