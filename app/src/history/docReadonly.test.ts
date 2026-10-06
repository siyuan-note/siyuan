import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const {parse} = require("ifdef-loader/preprocessor");
const noop = () => {};

const loadModule = (path: string, mobile: boolean, dependencies: Record<string, unknown>, globals: object) => {
    const source = parse(readFileSync(resolve("src", path), "utf8"), {MOBILE: mobile, BROWSER: true}, false, true, path);
    const exports = {};
    const code = transpileModule(source, {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    runInNewContext(code, {exports, require: (name: string) => dependencies[name] || {}, ...globals});
    return exports;
};

for (const mobile of [false, true]) {
    test(`locked document history remains accessible without exposing other history contexts (${mobile ? "mobile" : "desktop"})`, () => {
        for (const mode of ["locked", "editable", "workspace", "publish", "history", "snapshot", "permanent"]) {
            const items: IMenu[] = [];
            const opened: Parameters<typeof import("./doc").openDocHistory>[0][] = [];
            const keymaps = Object.fromEntries(["outline", "backlinks", "graphView", "attr", "spaceRepetition",
                "quickMakeCard", "search", "addToDatabase"].map(key => [key, {custom: ""}]));
            const menu = {element: {classList: {contains: () => true}, setAttribute: noop},
                remove: noop, append: (item: IMenu) => items.push(item), popup: noop, fullscreen: noop};
            const siyuan = {menus: {menu}, languages: {}, isPublish: mode === "publish",
                config: {readonly: mode === "workspace", cloudRegion: 1, flashcard: {},
                    keymap: {general: keymaps, editor: {general: keymaps}}}};
            const protyle = {app: {}, notebookId: "notebook", path: "/doc.sy", disabled: mode !== "editable",
                block: {rootID: "doc", id: "doc"}, options: {history: {
                    created: mode === "history" ? "archive" : "", snapshot: mode === "snapshot" ? "archive" : ""}},
                element: {getAttribute: () => mode === "permanent" ? "true" : null}} as unknown as IProtyle;
            const module = loadModule("protyle/header/openTitleMenu.ts", mobile, {
                "../../menus/Menu": {MenuItem: class {element: IMenu; constructor(item: IMenu) { this.element = item; }}},
                "../../menus/commonMenuItem": {copySubMenu: (): IMenu[] => [], exportMd: () => ({}), movePathToMenu: () => ({})},
                "../../util/fetch": {fetchPost: (_url: string, _body: unknown, callback: (response: unknown) => void) =>
                    callback({data: {name: "Document", ial: {id: "20231011123456", updated: "20231011123456"}}})},
                "../../history/doc": {openDocHistory: (options: typeof opened[number]) => opened.push(options)},
                "../../util/pathName": {isEncryptedBox: () => false},
                "../../util/hostCapabilities": {getHostCapabilities: () => ({})},
                "../util/hasClosest": {hasTopClosestByClassName: (): null => null},
                "../util/compatibility": {updateHotkeyTip: () => ""},
                "../../dialog/tooltip": {hideTooltip: noop},
                "../../plugin/EventBus": {emitOpenMenu: noop},
                "../../menus/block": {transferBlockRef: noop},
                "../../constants": {Constants: {}},
                "../../util/functions": {isMobile: () => mobile},
                dayjs: () => ({format: () => "date"}),
            }, {window: {siyuan}, getSelection: () => ({rangeCount: 0})}) as typeof import("../protyle/header/openTitleMenu");
            module.openTitleMenu(protyle, {x: 0, y: 0}, "title");
            const history = items.find(item => item.id === "fileHistory");
            if (mode === "locked" || mode === "editable") {
                assert.ok(history);
                history.click(null, null);
                assert.equal(opened[0].id, "doc");
                assert.equal(opened[0].notebookId, "notebook");
                assert.equal(opened[0].readonly, mode === "locked");
            } else {
                assert.equal(history, undefined, mode);
            }
            if (mode === "locked") {
                assert.ok(!items.some(item => item.id === "delete" || item.id === "addToDatabase"));
            }
        }
    });
}

class TestElement {
    public dataset: Record<string, string> = {};
    public innerHTML = "";
    public textContent = "1";
    public isConnected = true;
    public parentElement: TestElement;
    public nextElementSibling: TestElement;
    public attributes = new Map<string, string>();
    public listeners = new Map<string, (event: unknown) => void>();
    public nodes = new Map<string, TestElement>();
    public row = false;
    public repoRow: TestElement;
    public classList = {add: noop, remove: noop, contains: (name: string) => this.row && name === "b3-list-item"};

    querySelector(selector: string): TestElement {
        if (!this.nodes.has(selector)) {
            this.nodes.set(selector, new TestElement());
        }
        return this.nodes.get(selector);
    }

    querySelectorAll(): TestElement[] { return []; }
    getAttribute(name: string) { return this.attributes.get(name) ?? null; }
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    removeAttribute(name: string) { this.attributes.delete(name); }
    isEqualNode(element: TestElement) { return this === element; }
    addEventListener(name: string, callback: (event: unknown) => void) { this.listeners.set(name, callback); }
    dispatchEvent(event: Event) { this.listeners.get(event.type)?.(event); }
    closest() { return this.repoRow; }
}

const createHistory = (mobile: boolean, readonly: boolean) => {
    const root = new TestElement();
    const file = root.querySelector('#docHistoryContainer [data-type="doc"]');
    const next = file.querySelector('[data-type="docnext"]');
    next.nextElementSibling = new TestElement();
    next.nextElementSibling.nextElementSibling = new TestElement();
    file.querySelector(".b3-select").setAttribute("value", "all");
    const requests: {url: string, callback: (response: unknown) => void}[] = [];
    let confirmations = 0;
    let repoRollbacks = 0;
    let comparisons = 0;
    const snapshots = {reset: noop, load: noop, select: noop};
    const module = loadModule("history/doc.ts", mobile, {
        "../dialog": {Dialog: class {element = root;}},
        "../dialog/confirmDialog": {confirmDialog: () => { confirmations++; }},
        "../protyle": {Protyle: class {protyle = {options: {history: {}}};}},
        "../protyle/util/onGet": {disabledProtyle: noop, onGet: noop},
        "../util/fetch": {fetchPost: (url: string, _body: unknown, callback: (response: unknown) => void) =>
            requests.push({url, callback})},
        "../util/functions": {isMobile: () => mobile},
        "../util/escape": {escapeHtml: String},
        "../constants": {Constants: {LOCAL_HISTORY: "history"}},
        "./docSnapshots": {getDocHistorySnapshots: () => snapshots, DocHistorySnapshots: class {select = noop;}},
        "./docDiff": {showDocVersionDiff: () => { comparisons++; }},
        "./repoFile": {rollbackRepoFile: () => { repoRollbacks++; }},
        "./notebookDialogs": {trackNotebookHistoryDialog: noop},
        "./resizeSide": {resizeSide: noop},
        dayjs: () => ({format: () => "date"}),
    }, {window: {siyuan: {config: {readonly: false}, storage: {history: {}}, languages: {
        pageCountAndHistoryCount: "${x} ${y}", rollbackConfirm: "${name} ${time}"}}},
        CustomEvent: class {constructor(public type: string) {}}}) as typeof import("./doc");
    module.openDocHistory({app: {} as Parameters<typeof module.openDocHistory>[0]["app"],
        id: "doc", notebookId: "notebook", pathString: "Document", readonly});
    requests.shift().callback({data: {histories: ["1"], pageCount: 1, totalCount: 1}});
    const click = (type: string, row = false) => {
        const target = new TestElement();
        target.row = row;
        target.setAttribute("data-type", type);
        target.setAttribute("data-created", "1");
        target.parentElement = new TestElement();
        target.parentElement.setAttribute("data-created", "1");
        root.listeners.get("click")({target, stopPropagation: noop, preventDefault: noop});
        return target;
    };
    return {file, requests, click, root, confirmations: () => confirmations,
        repoRollbacks: () => repoRollbacks, comparisons: () => comparisons};
};

for (const mobile of [false, true]) {
    test(`viewing locked history preserves preview and comparison while blocking both rollback paths (${mobile ? "mobile" : "desktop"})`, () => {
        const view = createHistory(mobile, true);
        const html = view.file.querySelector(".b3-list--background").innerHTML;
        assert.ok(!html.includes('data-type="rollback"'));
        assert.ok(html.includes('data-type="selectVersion"'));
        view.click("rollback");
        const target = new TestElement();
        target.setAttribute("data-type", "rollback");
        target.repoRow = new TestElement();
        view.root.listeners.get("click")({target, stopPropagation: noop, preventDefault: noop});
        assert.equal(view.requests.length, 0);
        assert.equal(view.confirmations(), 0);
        assert.equal(view.repoRollbacks(), 0);

        view.click("", true);
        const history = view.requests.shift();
        assert.equal(history.url, "/api/history/getHistoryItems");
        history.callback({data: {items: [{path: "history/doc.sy", title: "Document"}]}});
        const preview = view.requests.shift();
        assert.equal(preview.url, "/api/history/getDocHistoryContent");
        preview.callback({data: {content: "Historical content", isLargeDoc: true}});
        assert.equal((view.file.querySelector('.history__text[data-type="mdPanel"]') as TestElement & {value: string}).value,
            "Historical content");
        view.click("selectVersion");
        view.requests.shift().callback({data: {items: [{path: "history/doc.sy", title: "Document"}]}});
        view.click("compareVersions");
        assert.equal(view.comparisons(), 1);
    });
}

test("editable document history retains rollback", () => {
    const view = createHistory(false, false);
    assert.ok(view.file.querySelector(".b3-list--background").innerHTML.includes('data-type="rollback"'));
    view.click("rollback");
    view.requests.shift().callback({data: {items: [{path: "history/doc.sy", title: "Document"}]}});
    assert.equal(view.confirmations(), 1);
});

test("snapshot file list permits viewing and comparison without rollback", () => {
    const module = loadModule("history/repoFile.ts", false, {
        "../util/escape": {escapeAttr: String, escapeHtml: String},
        "../util/hostCapabilities": {getHostCapabilities: () => ({importExport: true})},
        dayjs: () => ({format: () => "date"}),
    }, {window: {siyuan: {languages: {}}}}) as typeof import("./repoFile");
    const list = {innerHTML: ""} as HTMLElement;
    const files = [{fileID: "file", indexID: "snapshot", title: "Document", hSize: "1KB", updated: 1}];
    module.renderRepoFileList(files, list, false, true, false);
    assert.ok(list.innerHTML.includes('data-type="searchFileItem"'));
    assert.ok(list.innerHTML.includes('data-type="selectVersion"'));
    assert.ok(!list.innerHTML.includes('data-type="rollback"'));
    module.renderRepoFileList(files, list, false, true);
    assert.ok(list.innerHTML.includes('data-type="rollback"'));
});
