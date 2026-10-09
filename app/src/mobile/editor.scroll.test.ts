import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import test from "node:test";
import {runInNewContext} from "node:vm";
import {
    createSourceFile, forEachChild, isBlock, isMethodDeclaration, isVariableStatement, ModuleKind, ScriptTarget, transpileModule,
} from "typescript";
import * as scrollRequest from "../protyle/scroll/scrollRequest";

const constants = {
    LOCAL_FILEPOSITION: "positions", CB_GET_SCROLL: "scroll", CB_GET_HL: "highlight", CB_GET_ALL: "all",
    CB_GET_ROOTSCROLL: "root-scroll", CB_GET_SETID: "set-id", CB_GET_FOCUS: "focus", SIZE_GET_MAX: 100000,
};
const read = (file: string) => readFileSync(join(__dirname, file), "utf8");
const compile = (source: string) => transpileModule(source, {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;
const loaderSource = compile(read("editor.ts"));
const scrollSource = compile(read("../protyle/scroll/saveScroll.ts"));

// 执行构造器实际的恢复分支，避免替身自行读取页签参数而掩盖调用链中的参数遗漏。
const protyleSource = createSourceFile("index.ts", read("../protyle/index.ts"), ScriptTarget.ES2021, true);
let restoreSource: string;
let getDocSource: string;
const findRestore = (node: import("typescript").Node) => {
    if (isBlock(node)) {
        const index = node.statements.findIndex(statement => isVariableStatement(statement) &&
            statement.declarationList.declarations.some(item => item.name.getText(protyleSource) === "savedScroll"));
        if (index >= 0) {
            restoreSource = node.statements.slice(index, index + 2).map(item => item.getText(protyleSource)).join("\n");
        }
    }
    if (isMethodDeclaration(node) && node.name.getText(protyleSource) === "getDoc") {
        getDocSource = `exports.getDoc = function (${node.parameters.map(item => item.getText(protyleSource)).join(",")}) ` +
            node.body.getText(protyleSource);
    }
    forEachChild(node, findRestore);
};
findRestore(protyleSource);
assert.ok(restoreSource);
assert.ok(getDocSource);
const constructorSource = compile(`exports.restore = function (options, mergedOptions) {${restoreSource}};\n${getDocSource}`);
const clone = <T>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value));
const position = (scrollTop: number, extra: Partial<IScrollAttr> = {}): IScrollAttr => ({
    rootId: "root", startId: "first", endId: "last", scrollTop, ...extra,
});

const setup = (legacy?: IScrollAttr, encrypted = false) => {
    const notebookID = encrypted ? "encrypted-box" : "box";
    const requests: Array<{url: string, data: any}> = [];
    const rendered: Array<{scrollAttr?: IScrollAttr}> = [];
    const constructed: IProtyleOptions[] = [];
    const toolbar = {value: "Document"};
    const window: any = {siyuan: {
        storage: {positions: {root: clone(legacy)}},
        config: {editor: {dynamicLoadBlocks: 128}, fileTree: {}}, mobile: {},
    }};
    const document = {querySelector: (): null => null,
        getElementById: (id: string) => id === "toolbarName" ? toolbar : {}};
    const noop = () => {};
    const makeProtyle = (options: IProtyleOptions) => ({
        options: {mode: "wysiwyg"}, notebookId: options.notebookId, path: "/root.sy",
        block: {id: options.blockId, rootID: options.rootId},
        title: {element: {removeAttribute: noop}},
        contentElement: {scrollTop: 0, classList: {contains: () => false}},
        wysiwyg: {element: {querySelectorAll: (): Element[] => [], childElementCount: 1}},
        undo: {clear: noop},
    });
    const fetchPost = (url: string, data: any, callback?: (response: any) => void) => {
        requests.push({url, data: clone(data)});
        callback?.({code: 0, data: {id: data.id, rootID: "root", box: notebookID}});
        return Promise.resolve();
    };
    const onGet = (options: any) => {
        rendered.push({scrollAttr: clone(options.scrollAttr)});
        options.protyle.contentElement.scrollTop = options.scrollAttr?.scrollTop ?? 0;
        options.afterCB?.();
    };
    const execute = (source: string, modules: Record<string, unknown>, globals: Record<string, unknown> = {}) => {
        const api: any = {};
        runInNewContext(source, {exports: api, require: (name: string) => modules[name] || {},
            window, document, console, ...globals});
        return api;
    };
    const scroll = execute(scrollSource, {
        "../../constants": {Constants: constants},
        "../../util/fetch": {fetchPost},
        "../../util/pathName": {isEncryptedBox: (id: string) => id === "encrypted-box"},
        "../util/onGet": {onGet},
        "../render/searchMarkRender": {isSupportCSSHL: () => true},
        "./scrollRequest": scrollRequest,
    });
    const constructor = execute(constructorSource, {}, {
        Constants: constants, getDocByScroll: scroll.getDocByScroll,
        fetchPost, onGet, isEncryptedBox: (id: string) => id === "encrypted-box",
    });
    class Protyle {
        protyle: ReturnType<typeof makeProtyle>;
        constructor(_app: unknown, _element: unknown, options: IProtyleOptions) {
            constructed.push(options);
            this.protyle = makeProtyle(options);
            // 与实际异步加载一样，等主编辑器安装后再通知打开完成。
            queueMicrotask(() => constructor.restore.call(this, options, options));
        }
        afterOnGet(options: IProtyleOptions) {
            options.after(this as any);
        }
        getDoc(options: IProtyleOptions) {
            constructor.getDoc.call(this, options);
        }
    }
    const loader = execute(loaderSource, {
        "../constants": {Constants: constants},
        "../protyle": {Protyle},
        "../util/fetch": {fetchPost},
        "../util/pathName": {isEncryptedBox: (id: string) => id === "encrypted-box"},
        "../protyle/scroll/saveScroll": {getDocByScroll: scroll.getDocByScroll, saveScroll: noop},
        "../protyle/ui/hideElements": {hideElements: noop},
        "../protyle/ui/initUI": {addLoading: noop},
        "../protyle/util/trackedRange": {invalidateTrackedRanges: noop},
        "../protyle/undo/globalUndo": {initMirror: noop},
        "../protyle/render/av/cellEditor": {closeAVCellEditor: noop},
        "../plugin/EventBusCore": {forEachPluginSubscriber: noop},
        "./util/setEmpty": {setEditor: noop},
        "./util/closePanel": {closePanel: noop},
        "./util/mobileBars": {bindMobileBarsScroll: noop},
        "./util/mobileTopBar": {restoreMobileTopBarLayout: noop},
        "./util/MobileEditorDialog": {closeMobileEditorSheets: noop},
        "./util/openReference": {invalidateMobileReferenceOpen: noop},
    });
    const load = (scrollAttr?: IScrollAttr) => new Promise<any>((resolve, reject) => {
        loader.loadMobileFileById({}, "root", [constants.CB_GET_SCROLL], undefined, notebookID, resolve,
            true, () => true, undefined, scrollAttr, false, () => reject(new Error("Loading failed")));
    });
    return {load, requests, rendered, constructed, window,
        get docRequest() { return requests.filter(item => item.url === "/api/filetree/getDoc").at(-1)?.data; }};
};

test("cold mobile loading restores the tab's top instead of the document's old bottom", async () => {
    const state = setup(position(8000, {startId: "old-first", endId: "old-last"}));
    const scroll = position(0);
    const protyle = await state.load(scroll);
    assert.equal(protyle.contentElement.scrollTop, 0);
    assert.deepEqual(state.rendered[0].scrollAttr, scroll);
    assert.equal(state.constructed[0].scrollAttr, scroll);
    assert.equal(state.docRequest.startID, "first");
    assert.equal(state.docRequest.endID, "last");
    assert.equal(state.window.siyuan.storage.positions.root.scrollTop, 8000);
});

test("cold and reused mobile editors forward each tab's full saved range and focus", async () => {
    const state = setup(position(8000));
    const first = position(240, {focusId: "paragraph", focusStart: 2, focusEnd: 5});
    const second = position(680, {startId: "second-first", endId: "second-last", focusId: "other", focusStart: 7, focusEnd: 7});
    const protyle = await state.load(first);
    assert.equal(protyle.contentElement.scrollTop, 240);
    assert.deepEqual(state.rendered[0].scrollAttr, first);
    assert.equal(await state.load(second), protyle);
    assert.equal(protyle.contentElement.scrollTop, 680);
    assert.deepEqual(state.rendered[1].scrollAttr, second);
    assert.equal(state.docRequest.startID, "second-first");
    assert.equal(state.docRequest.endID, "second-last");
    assert.equal(state.constructed.length, 1);
});

test("cold mobile loading restores a zoomed block from the tab snapshot", async () => {
    const state = setup(position(8000));
    const scroll = position(72, {zoomInId: "zoomed-block"});
    await state.load(scroll);
    assert.equal(state.docRequest.id, "zoomed-block");
    assert.equal(state.docRequest.size, constants.SIZE_GET_MAX);
    assert.deepEqual(state.rendered[0].scrollAttr, scroll);
});

test("cold mobile loading falls back to the document position without a matching tab snapshot", async () => {
    for (const scroll of [undefined, position(0, {rootId: "different-document"})]) {
        const legacy = position(8000, {startId: "legacy-first", endId: "legacy-last"});
        const state = setup(legacy);
        const protyle = await state.load(scroll);
        assert.equal(protyle.contentElement.scrollTop, 8000);
        assert.deepEqual(state.rendered[0].scrollAttr, legacy);
        assert.equal(state.docRequest.startID, "legacy-first");
        assert.equal(state.docRequest.endID, "legacy-last");
    }
});

test("cold mobile loading without either saved position uses normal document loading", async () => {
    const state = setup();
    await state.load();
    assert.equal(state.rendered[0].scrollAttr, undefined);
    assert.equal(state.docRequest.id, "root");
    assert.equal(state.docRequest.startID, undefined);
    assert.equal(state.docRequest.endID, undefined);
});

test("explicit mobile scroll restoration retains encrypted notebook request scoping", async () => {
    const state = setup(undefined, true);
    const scroll = position(120);
    await state.load(scroll);
    assert.equal(state.requests.find(item => item.url === "/api/block/getBlockInfo").data.notebook, "encrypted-box");
    assert.equal(state.docRequest.notebook, "encrypted-box");
    assert.deepEqual(state.rendered[0].scrollAttr, scroll);
});
