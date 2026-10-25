import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compile = (file: string) => transpileModule(readFileSync(resolve(__dirname, file), "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const setup = (mode = 2) => {
    const runtime = {siyuan: {documentAddressingVersion: 2,
        languages: {fileNameRule: "Invalid filename", _kernel: {106: "Title too long"}}}};
    runtime.siyuan.documentAddressingVersion = mode;
    const timers = new Map<number, () => void>();
    const requests: Array<{url: string, data: any}> = [];
    let timerID = 0;
    const window = {...runtime, setTimeout: (callback: () => void) => {
        timers.set(++timerID, callback);
        return timerID;
    }};
    const constants = {SIZE_TITLE: 512};
    const rename = {};
    runInNewContext(compile("../../editor/rename.ts"), {
        exports: rename,
        window,
        require: (name: string) => name === "../constants" ? {Constants: constants} :
            {showMessage: () => {}, showTooltip: () => {}},
    });
    const moduleExports: {Title?: {prototype: any}} = {};
    runInNewContext(compile("Title.ts"), {
        exports: moduleExports,
        window,
        clearTimeout: (id: number) => timers.delete(id),
        require: (name: string) => {
            if (name === "../../editor/rename") return rename;
            if (name === "../../constants") return {Constants: constants};
            if (name === "../util/selectionOffsets") return {getSelectionOffset: () => ({start: 1026, end: 1026})};
            if (name === "../util/selection") return {focusByOffset: () => {}};
            if (name === "../../dialog/tooltip") return {hideTooltip: () => {}};
            if (name === "../../util/fetch") return {fetchPost: (url: string, data: any) => requests.push({url, data})};
            if (name === "../util/transactionQueue") return {waitForPendingTransactions: () => Promise.resolve()};
            return {};
        },
    });
    const title = Object.create(moduleExports.Title.prototype);
    title.editElement = {textContent: ""};
    title.setTitle = (value: string) => { title.editElement.textContent = value; };
    title.protyle = {notebookId: "notebook", path: "/document.sy"};
    return {title, timers, requests};
};

test("truncated structured titles replace the pending save and flush the displayed text", () => {
    const {title, timers, requests} = setup();
    for (const [input, expected] of [
        ["a".repeat(513), "a".repeat(512)],
        ["😀".repeat(513), "😀".repeat(512)],
        ["A" + "😀".repeat(512), "A" + "😀".repeat(511)],
        ["文".repeat(513), "文".repeat(512)],
    ]) {
        title.editElement.textContent = "Previous valid title";
        title.rename(title.protyle);
        title.editElement.textContent = input;
        title.rename(title.protyle);
        assert.equal(title.editElement.textContent, expected);
        assert.equal(timers.size, 1);
        title.flushPendingInput();
        assert.equal(timers.size, 0);
        assert.equal(requests.at(-1)?.url, "/api/filetree/renameDoc");
        assert.equal(requests.at(-1)?.data.title, expected);
        assert.equal(requests.at(-1)?.data.notebook, "notebook");
        assert.equal(requests.at(-1)?.data.path, "/document.sy");
    }
    assert.equal(requests.length, 4);
});

test("truncated structured titles also save through the debounce callback", () => {
    const {title, timers, requests} = setup();
    title.editElement.textContent = "x".repeat(513);
    title.rename(title.protyle);
    assert.equal(timers.size, 1);
    timers.values().next().value!();
    title.flushPendingInput();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].data.title, "x".repeat(512));
});

test("invalid structured titles cancel saving when truncation cannot make them valid", () => {
    const {title, timers, requests} = setup();
    for (const input of ["Title\nwith/slash", "Title\n" + "a".repeat(513)]) {
        title.editElement.textContent = "Previous valid title";
        title.rename(title.protyle);
        title.editElement.textContent = input;
        assert.equal(title.rename(title.protyle), false);
        title.flushPendingInput();
        assert.equal(timers.size, 0);
        assert.equal(requests.length, 0);
    }
});

test("legacy title truncation preserves its existing validation behavior", () => {
    const {title, timers, requests} = setup(1);
    title.editElement.textContent = "😀".repeat(513);
    assert.equal(title.rename(title.protyle), false);
    assert.equal(title.editElement.textContent, "😀".repeat(256));
    title.flushPendingInput();
    assert.equal(timers.size, 0);
    assert.equal(requests.length, 0);
});

test("rich title labels use the source summary instead of rendered formula and image text", () => {
    const {title} = setup();
    title.richEditor = {};
    title.summary = "Canonical title summary";
    title.editElement.textContent = "Rendered math duplicated with image captions";
    assert.equal(title.getText(), "Canonical title summary");
    title.richEditor = undefined;
    title.editElement.textContent = "Plain notebook title";
    assert.equal(title.getText(), "Plain notebook title");
});

test("document reuse awaits the title source and body queue and catches edits during the wait", async () => {
    const {title} = setup();
    const order: string[] = [];
    let accept: () => void;
    const pending = new Promise<void>(resolve => { accept = resolve; });
    title.element = {dataset: {nodeId: "old-root"}};
    title.richEditor = {flush: () => { order.push("title"); return pending; }};
    title.protyle.wysiwyg = {flushPendingInput: () => { order.push("body"); }};
    assert.equal(title.prepareForDocumentSwitch("old-root"), undefined);
    const switching = title.prepareForDocumentSwitch("new-root");
    assert.deepEqual(order, ["title"]);
    accept();
    await switching;
    assert.deepEqual(order, ["title", "body", "title"]);
});

test("failed or replaced title source prevents document reuse", async () => {
    const {title} = setup();
    title.element = {dataset: {nodeId: "old-root"}};
    let bodyFlushes = 0;
    title.protyle.wysiwyg = {flushPendingInput: () => { bodyFlushes++; }};
    title.richEditor = {flush: async () => { throw new Error("Conflict"); }};
    await assert.rejects(title.prepareForDocumentSwitch("new-root"), /Conflict/);
    assert.equal(bodyFlushes, 0);
    title.richEditor = {flush: async () => { title.richEditor = undefined; }};
    await assert.rejects(title.prepareForDocumentSwitch("new-root"));
});

test("normal editor enabling cannot unlock the plain title while its full source is still loading", async () => {
    const timers = new Map<number, () => void>();
    const requests: Array<{url: string, resolve: (response: unknown) => void}> = [];
    let timerID = 0;
    const noop = () => {};
    const window = {siyuan: {documentAddressingVersion: 2, mobile: {}, languages: {}, config: {editor: {autoDirection: false}}},
        setTimeout: (callback: () => void) => { timers.set(++timerID, callback); return timerID; }};
    const plain = {contentEditable: "true", textContent: "Original", style: {userSelect: ""}, contains: () => false,
        replaceWith: noop, setAttribute(name: string, value: string) {
            if (name === "contenteditable") this.contentEditable = value;
        }};
    const moduleExports: {Title?: {prototype: any}} = {};
    runInNewContext(compile("Title.ts"), {exports: moduleExports, window,
        clearTimeout: (id: number) => timers.delete(id), getSelection: () => ({rangeCount: 0}),
        document: {createElement: () => ({})}, require: (name: string) => {
            if (name === "../../util/fetch") return {fetchSyncPost: (url: string) =>
                new Promise(resolve => requests.push({url, resolve}))};
            if (name === "../../editor/rename") return {validateName: () => true};
            if (name === "../../constants") return {Constants: {TIMEOUT_INPUT: 256}};
            if (name === "../../dialog/tooltip") return {hideTooltip: noop};
            if (name === "../render/autoDirection") return {setTitleAutoDirection: noop};
            if (name === "./documentTitleEditor") return {DocumentTitleEditor: class {
                constructor(_owner: unknown, _host: unknown, initial: {text: string}, onEditable: (element: unknown) => void) {
                    onEditable({...plain, textContent: initial.text, contentEditable: "true"});
                }
            }};
            return {};
        }});
    const title = Object.assign(Object.create(moduleExports.Title.prototype), {
        editElement: plain, element: {dataset: {nodeId: "document"}}, sourceRequest: 0,
    });
    const protyle = {block: {rootID: "document"}, notebookId: "notebook", path: "/document.sy", title, disabled: false,
        element: {getAttribute: (): null => null}, wysiwyg: {element: {setAttribute: noop, style: {}, querySelectorAll: (): never[] => []}}};
    title.protyle = protyle;
    const source = readFileSync(resolve(__dirname, "../util/onGet.ts"), "utf8");
    const enableExports: {enableProtyle?: (owner: unknown) => void} = {};
    runInNewContext(transpileModule(source.slice(source.indexOf("export const enableProtyle ="),
        source.indexOf("const focusElementById =")), {compilerOptions: {module: ModuleKind.CommonJS}}).outputText,
    {exports: enableExports, window, hideElements: noop, hideTooltip: noop,
        isMobile: () => false, isIPhone: () => false, isAndroid: () => false});

    const loading = title.loadSource();
    assert.equal(plain.contentEditable, "false");
    enableExports.enableProtyle(protyle);
    assert.equal(plain.contentEditable, "false", "setHTML enables the body while the title source remains pending");
    assert.equal(title.rename(protyle), false, "stale plain listeners cannot schedule a legacy title write");
    assert.equal(timers.size, 0);
    assert.equal(requests.length, 1);
    requests[0].resolve({code: 0, data: {text: "Original", blockDOM: "Original", revision: "r0"}});
    await loading;
    assert.equal(title.editElement.contentEditable, "true");
    assert.equal(title.editElement.textContent, "Original");
});

test("a title without its loaded source stays readonly while notebook roots retain plain editing", () => {
    const {title} = setup();
    title.protyle.block = {rootID: "document"};
    const attributes: Record<string, string> = {};
    title.editElement = {style: {}, setAttribute: (name: string, value: string) => { attributes[name] = value; }};
    title.setReadonly(false);
    assert.equal(attributes.contenteditable, "false");
    title.protyle.block.rootID = title.protyle.notebookId;
    title.setReadonly(false);
    assert.equal(attributes.contenteditable, "true", "notebook roots retain their plain title editor");
    title.setReadonly(true);
    assert.equal(attributes.contenteditable, "false");
});
