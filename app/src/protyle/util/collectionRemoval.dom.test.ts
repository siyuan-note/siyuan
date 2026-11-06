import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (code: string, confirmationCode: string, markerCode: string, mobileConfirmationCode: string) => {
    const check: typeof assert = require("node:assert/strict");
    Object.assign(window, {siyuan: {languages: {cancel: "Cancel", delete: "Delete", deleteOpConfirm: "Confirm deletion",
        tagRemovalDatabaseTip: "Remove entries and field values; source is kept and undo is available",
        tagRemovalOnly: "Delete tags only", referenceRemovalOnly: "Delete references only", sourceRemovalOnly: "Delete tags and references only",
        tagRemovalWithEntries: "Remove selected entries too"}}});
    let active: {element: HTMLElement, destroy: () => void};
    class Dialog {
        element = document.createElement("div");
        constructor(private options: {content: string, destroyCallback: () => void}) {
            this.element.innerHTML = options.content;
            document.body.append(this.element);
            active = {element: this.element, destroy: () => this.destroy()};
        }
        destroy() { this.element.remove(); this.options.destroyCallback(); }
        focusWhenReady(target: () => HTMLElement) { target().focus(); }
        requestClose() { this.destroy(); return Promise.resolve(true); }
    }
    let mobile = false;
    const confirmation = {exports: {}};
    new Function("require", "module", "exports", confirmationCode)((dependency: string) => ({
        "../util/functions": {isMobile: () => mobile}, "./index": {Dialog}, "../constants": {Constants: {DIALOG_CONFIRM: "confirm"}},
    })[dependency], confirmation, confirmation.exports);
    const mobileConfirmation = {exports: {}};
    new Function("require", "module", "exports", mobileConfirmationCode)((dependency: string) => ({
        "../util/functions": {isMobile: () => mobile}, "./mobileDialog": {MobileDialog: Dialog},
        "./confirmDialog": confirmation.exports, "../constants": {Constants: {DIALOG_CONFIRM: "confirm"}},
    })[dependency], mobileConfirmation, mobileConfirmation.exports);
    const sourceVersions = {root: "source-version"};
    let response: {code: number, data: {collections: unknown[], sourceVersions: Record<string, string>}, msg: string} =
        {code: 0, data: {collections: [], sourceVersions}, msg: ""};
    const requests: {url: string, data: unknown}[] = [];
    const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
    const module = {exports: {} as typeof import("./collectionRemoval")};
    const marker = {exports: {}};
    new Function("require", "module", "exports", markerCode)(() => ({}), marker, marker.exports);
    new Function("require", "module", "exports", code)((dependency: string) => ({
        "../../dialog/mobileConfirmDialog": mobileConfirmation.exports,
        "../../util/escape": {escapeAttr: escape, escapeHtml: escape},
        "../../util/fetch": {fetchSyncPost: async (url: string, data: unknown) => { requests.push({url, data}); return response; }},
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
    const reference = '<span data-type="block-ref" data-id="target">anchor</span>';
    const other = '<span data-type="block-ref" data-id="other">anchor</span>';
    check.equal(api.hasReferenceRemoval(update("anchor"), update(reference)), true);
    check.equal(api.hasReferenceRemoval(update('<span data-type="strong" data-id="target">anchor</span>'), update(reference)), true);
    check.equal(api.hasReferenceRemoval(update(other), update(reference)), true);
    check.equal(api.hasReferenceRemoval(update(reference.replace("anchor", "new anchor")), update(reference)), false);
    check.equal(api.hasReferenceRemoval(update(reference), update(reference + reference)), false);
    check.equal(api.hasReferenceRemoval(update(reference + other), update(reference)), false);
    check.equal(api.hasReferenceRemoval(update(reference), update(reference + other)), true);
    check.equal(api.hasReferenceRemoval(update("anchor"), update(reference.replace("block-ref", "strong block-ref"))), true);
    check.equal(api.hasReferenceRemoval([{action: "delete", id}], [{action: "insert", id, data: html(reference)}]), false);
    check.equal(api.hasReferenceRemoval([...update("anchor"), {action: "delete", id}], update(reference)), false);
    check.equal(api.hasReferenceRemoval(update("anchor"), [{action: "insert", id, data: html(reference)}]), true);
    check.equal(api.hasReferenceRemoval([{action: "setAttrs", id, data: '{"tags":"other"}'}], update(reference)), false);
    check.equal(api.hasReferenceRemoval(update("anchor"), undefined), false);
    const nestedReference = `<div data-node-id="child">${reference}</div>`;
    check.equal(api.hasReferenceRemoval(update(nestedReference), update(reference + nestedReference)), true);
    check.equal(api.hasReferenceRemoval(update(reference), update(reference + nestedReference)), false);
    check.equal(api.hasReferenceRemoval(update('<div data-node-id="child">anchor</div>'), update(nestedReference)), true);
    const groups = ["first", "second"].map(avID => ({avID, name: '<img src=x onerror="throw 1">',
        cleanup: {ruleVersion: "version", automaticOnly: true, items: [{itemID: "item", blockID: id}]}}));
    check.deepEqual(await api.confirmCollectionRemoval([]), []);
    let pending = api.confirmCollectionRemoval(groups);
    check.equal(active.element.querySelectorAll('input[type="checkbox"]:checked').length, 2);
    check.equal(active.element.querySelector("img"), null);
    check.equal(document.activeElement.id, "confirmDialogConfirmBtn");
    check.equal(document.activeElement.textContent, "Remove selected entries too");
    (active.element.querySelector("#confirmDialogConfirmBtn") as HTMLElement).click();
    check.deepEqual(await pending, groups);
    for (mobile of [false, true]) {
        for (const label of ["Delete tags only", "Delete references only", "Delete tags and references only"]) {
            pending = api.confirmCollectionRemoval(groups, undefined, label);
            check.equal(active.element.querySelector("#extraDialogConfirmBtn").textContent, label);
            check.equal(active.element.querySelectorAll('input[type="checkbox"]:checked').length, 2);
            active.element.dispatchEvent(new CustomEvent("click", {detail: "Enter"}));
            check.deepEqual(await pending, groups);
            pending = api.confirmCollectionRemoval(groups, undefined, label);
            (active.element.querySelector("#extraDialogConfirmBtn") as HTMLElement).click();
            check.deepEqual(await pending, []);
            pending = api.confirmCollectionRemoval(groups, undefined, label);
            active.element.dispatchEvent(new CustomEvent("click", {detail: "Escape"}));
            check.equal(await pending, null);
            pending = api.confirmCollectionRemoval(groups, undefined, label);
            active.destroy();
            check.equal(await pending, null);
        }
    }
    mobile = false;
    pending = api.confirmCollectionRemoval(groups);
    active.element.dispatchEvent(new CustomEvent("click", {detail: "Escape"}));
    check.equal(await pending, null);
    pending = api.confirmCollectionRemoval(groups);
    (active.element.querySelector('[data-tag-removal-av="first"]') as HTMLInputElement).checked = false;
    (active.element.querySelector("#confirmDialogConfirmBtn") as HTMLElement).click();
    check.deepEqual((await pending).map(group => group.avID), ["second"]);
    pending = api.confirmCollectionRemoval(groups);
    check.equal(active.element.querySelector("#extraDialogConfirmBtn").textContent, "Delete tags only");
    (active.element.querySelector("#extraDialogConfirmBtn") as HTMLElement).click();
    check.deepEqual(await pending, []);
    pending = api.confirmCollectionRemoval(groups);
    active.element.querySelectorAll<HTMLInputElement>("input").forEach(input => input.checked = false);
    (active.element.querySelector("#confirmDialogConfirmBtn") as HTMLElement).click();
    check.deepEqual(await pending, []);
    pending = api.confirmCollectionRemoval([], "Delete this tag?");
    check.equal(active.element.querySelector("#extraDialogConfirmBtn"), null);
    check.equal(document.activeElement.textContent, "Delete tags only");
    (active.element.querySelector("#confirmDialogConfirmBtn") as HTMLElement).click();
    check.deepEqual(await pending, []);
    const large = {...groups[0], cleanup: {...groups[0].cleanup,
        items: Array.from({length: 201}, (_, index) => ({itemID: String(index), blockID: id}))}};
    const operations = api.collectionRemovalOperations([large]);
    check.deepEqual(operations.map(operation => operation.action === "cleanupAttrViewBlocks" && operation.data.items.length), [100, 100, 1]);
    for (const [changes, referencesRemoved, label] of [
        [[{id, tags: ["todo"]}], false, "Delete tags only"],
        [[], true, "Delete references only"],
        [[{id, tags: ["todo"]}], true, "Delete tags and references only"],
    ] as const) {
        response = {code: 0, data: {collections: groups, sourceVersions}, msg: ""};
        const tagChanges = changes.map(change => ({...change, tags: Array.from(change.tags)}));
        const preview = api.previewCollectionRemoval(update(""), tagChanges, referencesRemoved);
        await Promise.resolve();
        check.equal(active.element.querySelector("#extraDialogConfirmBtn").textContent, label);
        check.deepEqual(requests.at(-1), {url: "/api/av/previewCollectionRemoval", data: {operations: update(""), tagChanges}});
        (active.element.querySelector("#confirmDialogConfirmBtn") as HTMLElement).click();
        check.deepEqual(await preview, {collections: groups, sourceVersions});
    }
    for (const action of ["sourcesOnly", "noneSelected", "cancel"]) {
        const preview = api.previewCollectionRemoval(update(""), [], true);
        await Promise.resolve();
        if (action === "noneSelected") {
            active.element.querySelectorAll<HTMLInputElement>("input").forEach(input => input.checked = false);
        }
        (active.element.querySelector(action === "sourcesOnly" ? "#extraDialogConfirmBtn" :
            action === "cancel" ? "#cancelDialogConfirmBtn" : "#confirmDialogConfirmBtn") as HTMLElement).click();
        check.deepEqual(await preview, action === "cancel" ? null : {collections: [], sourceVersions});
    }
    response = {code: 0, data: {collections: [], sourceVersions}, msg: ""};
    const previousDialog = active;
    check.deepEqual(await api.previewCollectionRemoval(update(""), [], true), {collections: [], sourceVersions});
    check.equal(active, previousDialog);
    response = {code: 0, data: {collections: groups, sourceVersions}, msg: ""};
    check.equal(await api.previewCollectionRemoval(update(""), [], true, () => false), null);
    check.equal(active, previousDialog);
    response = {code: -1, data: {collections: [], sourceVersions}, msg: "unavailable"};
    await check.rejects(api.previewCollectionRemoval(update(""), [{id, tags: ["todo"]}], false), /unavailable/);
    return "Collection removal DOM cases passed";
};

test("source removal detects tag and reference deletions and offers desktop and mobile choices", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const compile = (file: string) => transpileModule(readFileSync(file, "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText;
    const code = compile(path.join(__dirname, "collectionRemoval.ts"));
    const confirmation = compile(path.join(__dirname, "../../dialog/confirmDialog.ts"));
    const marker = compile(path.join(__dirname, "inlineElementMarker.ts"));
    const mobileConfirmation = compile(path.join(__dirname, "../../dialog/mobileConfirmDialog.ts"));
    const source = `const __name = value => value; (${browserCases.toString()})(${JSON.stringify(code)}, ${JSON.stringify(confirmation)}, ${JSON.stringify(marker)}, ${JSON.stringify(mobileConfirmation)})`;
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-collection-removal-test-"));
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
        assert.match(result.stdout, /Collection removal DOM cases passed/);
    } finally {
        assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
        assert.ok(path.basename(temporary).startsWith("siyuan-collection-removal-test-"));
        rmSync(temporary, {recursive: true, force: true});
    }
});
