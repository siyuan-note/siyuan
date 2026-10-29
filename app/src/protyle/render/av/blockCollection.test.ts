import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {execFile} from "node:child_process";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {promisify} from "node:util";
import type {AVAutomationBlockSourceInput} from "../../../types/api";

const compiled = transpileModule(readFileSync("src/protyle/render/av/blockCollection.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
}).outputText;

test("collection scope requires a notebook or document and complete attribute names", () => {
    const methods = {} as typeof import("./blockCollection");
    runInNewContext(compiled, {exports: methods, require: () => ({})});
    assert.equal(methods.collectionSourceIncomplete({}), true);
    assert.equal(methods.collectionSourceIncomplete({documentIDs: ["doc"]}), false);
    assert.equal(methods.collectionSourceIncomplete({notebookIDs: ["notebook"], attributes: [{name: "custom-", operator: "exists"}]}), true);
    assert.equal(methods.collectionSourceIncomplete({documentIDs: ["doc"], attributes: [{name: "custom-state", operator: "equals", value: "open"}]}), false);
    for (const [nameOperator, name] of [["contains", "dailynote"], ["regex", "^custom-dailynote-[0-9]{8}$"]] as const) {
        assert.equal(methods.collectionSourceIncomplete({documentIDs: ["doc"], attributes: [{name, nameOperator, operator: "exists"}]}), false);
        assert.equal(methods.collectionSourceIncomplete({documentIDs: ["doc"], attributes: [{name: "", nameOperator, operator: "exists"}]}), true);
    }
    for (const documentDepth of [undefined, null, 0, 1, 12]) {
        assert.equal(methods.collectionSourceIncomplete({documentIDs: ["doc"], documentDepth}), false);
    }
    for (const documentDepth of [-1, 1.5, NaN, Infinity]) {
        assert.equal(methods.collectionSourceIncomplete({documentIDs: ["doc"], documentDepth}), true);
    }
});

const browserCases = async (sourceCode: string, languages: Record<string, string>) => {
    const check: typeof assert = require("node:assert/strict");
    const api = {} as typeof import("./blockCollection");
    const menu = document.createElement("div");
    document.body.append(menu);
    let addScope: (paths: string[], boxes: string[]) => void;
    let validateScope: (paths: string[], boxes: string[]) => boolean;
    const messages: string[] = [];
    Object.assign(window, {siyuan: {languages, notebooks: [{id: "box", name: "Notebook"}]}});
    new Function("exports", "require", sourceCode)(api, (name: string) => ({
        "../../../util/escape": {escapeAttr: String, escapeHtml: String},
        "../../../util/fetch": {fetchSyncPost: async () => ({code: 0, data: "/Selected document"})},
        "./collectionConditions": {mountCollectionConditions() {}},
        "./collectionReference": {mountCollectionReference() {}},
        "../../../util/pathName": {movePathTo: (options: {cb: typeof addScope, validate: typeof validateScope, multiple: boolean, sourceNotebookIds: string[]}) => {
            check.equal(options.multiple, true);
            check.deepEqual(options.sourceNotebookIds, ["box"]);
            addScope = options.cb;
            validateScope = options.validate;
        }},
        "../../../dialog/message": {showMessage: (message: string) => messages.push(message)},
        "../../../menus/menuToggle": {toggleMenu: (options: {build: () => void, show: () => void}) => { options.build(); options.show(); }},
        "../../../plugin/Menu": {Menu: class {
            constructor() { menu.replaceChildren(); }
            addItem(item: {label: string, checked: boolean, click: () => void}) {
                const button = document.createElement("button");
                button.textContent = item.label;
                button.setAttribute("aria-checked", String(item.checked));
                button.addEventListener("click", item.click);
                menu.append(button);
            }
            open() {}
        }},
    })[name] || {});
    const tick = () => new Promise(resolve => setTimeout(resolve, 0));
    for (const width of [1000, 320]) {
        const host = document.createElement("div");
        host.style.width = `${width}px`;
        document.body.append(host);
        const source: AVAutomationBlockSourceInput = {notebookIDs: ["box"]};
        const saves: AVAutomationBlockSourceInput[] = [];
        const save = () => {
            check.ok(Array.from(host.querySelectorAll("input")).every(input => input.checkValidity()));
            saves.push(JSON.parse(JSON.stringify(source)));
        };
        api.mountBlockCollectionSource(host, source, {notebookId: "box"} as IProtyle, save, () => {});
        await tick();
        check.equal(host.querySelector("[data-depth-mode]"), null);
        check.equal(host.querySelector("[data-include-selected-documents]"), null);
        host.querySelector<HTMLButtonElement>("[data-scope]").click();
        addScope(["/doc.sy"], ["box"]);
        await tick();
        const choose = async (label: string) => {
            host.querySelector<HTMLButtonElement>("[data-depth-mode]").click();
            const button = Array.from(menu.querySelectorAll("button")).find(item => item.textContent === label);
            check.ok(button);
            button.click();
            await tick();
        };
        check.match(host.querySelector("[data-depth-mode]").textContent, /Unlimited/);
        check.equal(source.documentDepth, undefined);
        const include = host.querySelector<HTMLInputElement>("[data-include-selected-documents]");
        check.equal(include.checked, true);
        include.click();
        check.equal(source.includeSelectedDocuments, false);
        check.equal(saves.at(-1).includeSelectedDocuments, false);
        await choose(languages.automationCollectionDepthCurrent);
        check.equal(source.documentDepth, 0);
        check.equal(host.querySelector("[data-document-depth]"), null);
        check.equal(host.querySelector<HTMLInputElement>("[data-include-selected-documents]").checked, false);
        await choose(languages.automationCollectionDepthLimited);
        check.equal(source.documentDepth, 1);
        const input = host.querySelector<HTMLInputElement>("[data-document-depth]");
        check.equal(input.value, "1");
        const before = saves.length;
        for (const value of ["", "-1", "0", "1.5"]) {
            input.value = value;
            input.dispatchEvent(new Event("change", {bubbles: true}));
            check.equal(source.documentDepth, 1);
            check.equal(saves.length, before);
        }
        input.value = "12";
        input.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
        check.equal(source.documentDepth, 12);
        check.equal(saves.length, before + 1);
        input.value = "";
        input.dispatchEvent(new Event("change", {bubbles: true}));
        await choose(languages.automationCollectionDepthUnlimited);
        check.equal(source.documentDepth, undefined);
        check.equal(host.querySelector("[data-document-depth]"), null);
        await choose(languages.automationCollectionDepthCurrent);
        host.querySelector<SVGElement>('[data-remove="document"]').dispatchEvent(new MouseEvent("click", {bubbles: true}));
        await tick();
        check.equal(host.querySelector("[data-depth-mode]"), null);
        host.querySelector<HTMLButtonElement>("[data-scope]").click();
        addScope(["/doc.sy"], ["box"]);
        await tick();
        check.match(host.querySelector("[data-depth-mode]").textContent, /Current document only/);
        check.equal(source.documentDepth, 0);
        check.deepEqual(source.notebookIDs, ["box"]);
        check.equal(host.querySelector<HTMLInputElement>("[data-include-selected-documents]").checked, false);
        host.querySelector<HTMLInputElement>("[data-include-selected-documents]").click();
        check.equal(source.includeSelectedDocuments, undefined);
        check.equal(saves.at(-1).includeSelectedDocuments, undefined);
        const beforeBatch = saves.length;
        const paths = ["/", "/", "/doc.sy", "/new.sy", "/new.sy"];
        const boxes = ["box", "other-box", "box", "box", "box"];
        check.equal(validateScope(paths, boxes), true);
        addScope(paths, boxes);
        await tick();
        check.equal(saves.length, beforeBatch + 1, "batch selection must save only once");
        check.deepEqual(source.notebookIDs, ["box", "other-box"]);
        check.deepEqual(source.documentIDs, ["doc", "new"]);
        source.documentIDs.push(...Array.from({length: 28}, (_, i) => `doc-${i}`));
        check.equal(validateScope(["/doc.sy"], ["box"]), true, "existing scope at the limit must remain selectable");
        const snapshot = JSON.stringify(source);
        check.equal(validateScope(["/overflow.sy"], ["box"]), false);
        check.equal(messages.at(-1), languages.automationCollectionScopeLimit);
        check.equal(JSON.stringify(source), snapshot, "failed validation must preserve the rule");
        source.documentIDs.push("legacy");
        check.equal(validateScope(["/doc.sy"], ["box"]), true, "legacy rules must accept an unchanged scope");
        check.equal(validateScope(["/overflow.sy"], ["box"]), false, "legacy rules must not expand past the limit");
        host.remove();
    }
    menu.remove();
    return "Collection depth DOM cases passed";
};

test("collection depth and self inclusion controls preserve values, validate edits and support narrow layouts", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-collection-depth-"));
    const script = path.join(temporary, "run.cjs");
    const languages = JSON.parse(readFileSync("appearance/langs/en.json", "utf8"));
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
    try {
        await win.loadURL("about:blank");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(`const __name = value => value; (${browserCases.toString()})(${JSON.stringify(compiled)}, ${JSON.stringify(languages)})`)}));
        win.destroy(); app.exit(0);
    } catch (error) { console.error(error); win.destroy(); app.exit(1); }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const {stdout} = await promisify(execFile)(require("electron") as unknown as string, [script], {env, timeout: 40000, windowsHide: true});
        assert.match(stdout, /Collection depth DOM cases passed/);
    } finally {
        assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
        assert.ok(path.basename(temporary).startsWith("siyuan-collection-depth-"));
        rmSync(temporary, {recursive: true, force: true});
    }
});

test("collection type selection replaces overlapping parents and preserves independent types", () => {
    const methods = {} as typeof import("./collectionConditions");
    const conditions = transpileModule(readFileSync("src/protyle/render/av/collectionConditions.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText;
    runInNewContext(conditions, {exports: methods, require: () => ({})});
    const toggle = (types: string[], type: string): string[] => JSON.parse(JSON.stringify(methods.toggleCollectionType(types, type)));
    assert.deepEqual(toggle(["l:u", "l:t", "i:t"], "l"), ["i:t", "l"]);
    assert.deepEqual(toggle(["l", "h:h1"], "l:o"), ["h:h1", "l:o"]);
    assert.deepEqual(toggle(["h:h1"], "h:h2"), ["h:h1", "h:h2"]);
    assert.deepEqual(toggle(["callout:WARNING"], "callout:WARNING"), []);
});
