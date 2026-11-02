import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (code: string, confirmationCode: string, markerCode: string) => {
    const check: typeof assert = require("node:assert/strict");
    Object.assign(window, {siyuan: {languages: {cancel: "Cancel", delete: "Delete", deleteOpConfirm: "Delete tags",
        tagRemovalDatabaseTip: "Remove entries and field values; source is kept and undo is available",
        tagRemovalOnly: "Delete tags only", tagRemovalWithEntries: "Remove selected entries too"}}});
    let active: {element: HTMLElement, destroy: () => void};
    class Dialog {
        element = document.createElement("div");
        constructor(private options: {content: string, destroyCallback: () => void}) {
            this.element.innerHTML = options.content;
            document.body.append(this.element);
            active = {element: this.element, destroy: () => this.destroy()};
        }
        destroy() { this.element.remove(); this.options.destroyCallback(); }
    }
    const confirmation = {exports: {}};
    new Function("require", "module", "exports", confirmationCode)((dependency: string) => ({
        "../util/functions": {isMobile: () => false}, "./index": {Dialog}, "../constants": {Constants: {DIALOG_CONFIRM: "confirm"}},
    })[dependency], confirmation, confirmation.exports);
    let response: {code: number, data: unknown[], msg: string} = {code: 0, data: [], msg: ""};
    const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
    const module = {exports: {} as typeof import("./tagRemoval")};
    const marker = {exports: {}};
    new Function("require", "module", "exports", markerCode)(() => ({}), marker, marker.exports);
    new Function("require", "module", "exports", code)((dependency: string) => ({
        "../../dialog/confirmDialog": confirmation.exports,
        "../../util/escape": {escapeAttr: escape, escapeHtml: escape},
        "../../util/fetch": {fetchSyncPost: async () => response},
        "./inlineElementMarker": marker.exports,
    })[dependency], module, module.exports);
    const api = module.exports;
    const id = "20261102000000-abcdefg";
    const html = (body: string) => `<div data-node-id="${id}" data-type="NodeParagraph"><div contenteditable="true">${body}</div></div>`;
    const update = (body: string): IOperation[] => [{action: "update", id, data: html(body)}];
    check.deepEqual(api.getTagRemovalChanges(update("text"), update('<span data-type="tag">todo</span>')), [{id, tags: ["todo"]}]);
    for (const prefix of ["\u2060", "\u200b", "\ufeff", "\u200b\u2060"]) {
        check.deepEqual(api.getTagRemovalChanges(update("111 "), update(`<span data-type="tag">${prefix}todo</span>`)), [{id, tags: ["todo"]}]);
        check.deepEqual(api.getTagRemovalChanges(update('<span data-type="tag">todo</span>'), update(`<span data-type="tag">${prefix}todo</span>`)), []);
    }
    check.deepEqual(api.getTagRemovalChanges(update(""), update('<span data-type="tag">\u2060to\u2060do</span>')), [{id, tags: ["to\u2060do"]}]);
    check.deepEqual(api.getTagRemovalChanges(update('<span data-type="tag">todo</span>'),
        update('<span data-type="tag">todo</span><span data-type="tag">todo</span>')), []);
    check.deepEqual(api.getTagRemovalChanges(update('<span data-type="tag">done</span>'), update('<span data-type="tag">todo</span>')), []);
    check.deepEqual(api.getTagRemovalChanges([{action: "delete", id}], update('<span data-type="tag">todo</span>')), []);
    check.deepEqual(api.getTagRemovalChanges([{action: "setAttrs", id, data: '{"tags":"other"}'}],
        [{action: "setAttrs", id, data: '{"tags":"todo,other"}'}]), [{id, tags: ["todo"]}]);
    const nested = "<div data-node-id=\"child\"><span data-type=\"tag\">child-tag</span></div>";
    check.deepEqual(api.getTagRemovalChanges(update(nested), update('<span data-type="tag">parent-tag</span>' + nested)), [{id, tags: ["parent-tag"]}]);
    const groups = ["first", "second"].map(avID => ({avID, name: '<img src=x onerror="throw 1">',
        cleanup: {ruleVersion: "version", automaticOnly: true, items: [{itemID: "item", blockID: id}]}}));
    check.deepEqual(await api.confirmTagRemoval([]), []);
    let pending = api.confirmTagRemoval(groups);
    check.equal(active.element.querySelectorAll("input:checked").length, 0);
    check.equal(active.element.querySelector("img"), null);
    check.equal(document.activeElement.id, "confirmDialogConfirmBtn");
    (active.element.querySelector("#confirmDialogConfirmBtn") as HTMLElement).click();
    check.deepEqual(await pending, []);
    pending = api.confirmTagRemoval(groups);
    active.element.dispatchEvent(new CustomEvent("click", {detail: "Escape"}));
    check.equal(await pending, null);
    pending = api.confirmTagRemoval(groups);
    (active.element.querySelector('[data-tag-removal-av="second"]') as HTMLInputElement).checked = true;
    (active.element.querySelector("#extraDialogConfirmBtn") as HTMLElement).click();
    check.deepEqual((await pending).map(group => group.avID), ["second"]);
    const large = {...groups[0], cleanup: {...groups[0].cleanup,
        items: Array.from({length: 201}, (_, index) => ({itemID: String(index), blockID: id}))}};
    const operations = api.tagRemovalOperations([large]);
    check.deepEqual(operations.map(operation => operation.action === "cleanupAttrViewBlocks" && operation.data.items.length), [100, 100, 1]);
    response = {code: -1, data: [], msg: "unavailable"};
    await check.rejects(api.previewTagRemoval([{id, tags: ["todo"]}]), /unavailable/);
    return "Tag removal DOM cases passed";
};

test("tag removal detects deletions and offers safe, escaped per-database choices", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const compile = (file: string) => transpileModule(readFileSync(file, "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText;
    const code = compile(path.join(__dirname, "tagRemoval.ts"));
    const confirmation = compile(path.join(__dirname, "../../dialog/confirmDialog.ts"));
    const marker = compile(path.join(__dirname, "inlineElementMarker.ts"));
    const source = `const __name = value => value; (${browserCases.toString()})(${JSON.stringify(code)}, ${JSON.stringify(confirmation)}, ${JSON.stringify(marker)})`;
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-tag-removal-test-"));
    const script = path.join(temporary, "run.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    try {
        await win.loadURL("about:blank");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(source)}));
        win.destroy(); app.exit(0);
    } catch (error) { console.error(error); win.destroy(); app.exit(1); }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script], {env, timeout: 40000, windowsHide: true});
        assert.match(result.stdout, /Tag removal DOM cases passed/);
    } finally {
        assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
        assert.ok(path.basename(temporary).startsWith("siyuan-tag-removal-test-"));
        rmSync(temporary, {recursive: true, force: true});
    }
});
