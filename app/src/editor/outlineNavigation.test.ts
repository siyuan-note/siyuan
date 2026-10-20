import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {setImmediate} from "node:timers/promises";
import {runInNewContext} from "node:vm";
import {
    createSourceFile, forEachChild, isClassDeclaration, isConstructorDeclaration, isPropertyAssignment,
    isVariableStatement, ScriptTarget, transpileModule,
} from "typescript";

const getDeclarations = (path: string, names: string[]) => {
    const source = createSourceFile(path, readFileSync(path, "utf8"), ScriptTarget.ES2021, true);
    return source.statements.filter(statement => isVariableStatement(statement) &&
        statement.declarationList.declarations.some(item => names.includes(item.name.getText(source))))
        .map(statement => statement.getText(source).replace(/^export /, "")).join("\n");
};
const outlineSource = createSourceFile("Outline.ts", readFileSync("src/layout/dock/Outline.ts", "utf8"), ScriptTarget.ES2021, true);
const outlineClass = outlineSource.statements.find(isClassDeclaration);
const methods = outlineClass.members.filter(member =>
    ["setCurrent", "setCurrentById", "invalidateCurrent", "selectHeading"].includes(member.name?.getText(outlineSource)));
let clickSource: string;
const findClick = (node: import("typescript").Node) => {
    if (!clickSource && isPropertyAssignment(node) && node.name.getText(outlineSource) === "click") {
        clickSource = node.initializer.getText(outlineSource);
    }
    forEachChild(node, findClick);
};
findClick(outlineClass.members.find(isConstructorDeclaration));
const protyleSource = createSourceFile("Protyle.ts", readFileSync("src/protyle/index.ts", "utf8"), ScriptTarget.ES2021, true);
const afterOnGet = protyleSource.statements.find(isClassDeclaration).members.find(member =>
    member.name?.getText(protyleSource) === "afterOnGet");
const compiled = transpileModule(getDeclarations("src/editor/util.ts", [
    "outlineRequests", "invalidateOutlineRequest", "syncOutlineCurrent", "updateOutline", "switchEditor",
    "updatePanelByEditor", "openFileById",
]) + "\n" + getDeclarations("src/protyle/util/onGet.ts", ["focusElementById"]) + "\n" +
    getDeclarations("src/util/noRelyPCFunction.ts", ["checkFold"]) + `
class OutlineHarness {
    currentRequestID = 0; blockId = "doc"; type = "pin"; isPreview = false;
    getNotebookId() { return ""; }
    click = ${clickSource};
    ${methods.map(method => method.getText(outlineSource)).join("\n")}
}
class ProtyleHarness { ${afterOnGet.getText(protyleSource)} }
Object.assign(globalThis, {switchEditor, updatePanelByEditor, updateOutline, focusElementById, OutlineHarness, ProtyleHarness});`, {
    compilerOptions: {target: ScriptTarget.ES2021},
}).outputText;

const classList = (initial: string[] = []) => {
    const values = new Set(initial);
    return {contains: (value: string) => values.has(value), add: (value: string) => values.add(value),
        remove: (value: string) => values.delete(value)};
};

const setupNavigation = (loaded: boolean, action: "focus" | "highlight") => {
    const timers: (() => void)[] = [];
    const requests: {url: string, callback: (response: unknown) => void}[] = [];
    const outlineUpdates: string[] = [];
    const heading = (id: string) => ({id, clientHeight: 20, isConnected: true, classList: classList(),
        getAttribute: (name: string) => name === "data-type" ? "NodeHeading" : id});
    const old = heading("old-heading");
    const clicked = heading("clicked-heading");
    const visible = new Set([old]);
    if (loaded) {
        visible.add(clicked);
    }
    let selected = {startContainer: old, endContainer: old};
    let bodyTarget: string;
    const protyle = {
        block: {id: "doc", rootID: "doc"}, notebookId: "box", toolbar: {range: selected}, background: {ial: {}},
        element: {isConnected: true, classList: classList(), contains: (node: typeof old) => visible.has(node), addEventListener() {}},
        contentElement: {scrollTop: 0, classList: classList(), addEventListener() {}},
        preview: {element: {classList: classList(["fn__none"])}},
        wysiwyg: {element: {contains: (node: typeof old) => visible.has(node), firstElementChild: old,
            ownerDocument: {activeElement: null as HTMLElement | null}, addEventListener() {},
            querySelectorAll: () => visible.has(clicked) ? [clicked] : []}},
        observer: {observe() {}, unobserve() {}},
        model: {element: {parentElement: {parentElement: {}}}},
    };
    const scrollWrites: number[] = [];
    let scrollTop = 320;
    const panel = {
        get scrollTop() { return scrollTop; },
        set scrollTop(value: number) { scrollWrites.push(value); scrollTop = value; },
        getBoundingClientRect: () => ({top: 0, height: 100}),
        querySelectorAll: () => rows,
        querySelector: (query: string) => rows.find(row => query.includes(`data-node-id="${row.id}"`)),
    };
    const rows = [old, clicked].map((node, index) => ({
        id: node.id, clientHeight: 20, classList: classList(index === 1 ? ["b3-list-item--focus"] : []),
        getAttribute: (name: string) => name === "data-node-id" ? node.id : null,
        getBoundingClientRect: () => ({top: (index ? 900 : 100) - panel.scrollTop,
            bottom: (index ? 920 : 120) - panel.scrollTop, height: 20}),
    }));
    const context: any = {
        Constants: {CB_GET_FOCUS: "focus", CB_GET_HL: "highlight", CB_GET_OUTLINE: "outline",
            CB_GET_CONTEXT: "context", CB_GET_ALL: "all", CB_GET_HTML: "html", CB_GET_SETID: "setid",
            CB_GET_ROOTSCROLL: "root-scroll", CB_GET_SEARCH: "search", LOCAL_OUTLINE: "outlineStorage"}, AbortController,
        options: {app: {}},
        window: {siyuan: {config: {editor: {dynamicLoadBlocks: 64}, appearance: {outlineKeepCurrentExpand: false}},
            menus: {menu: {remove() {}}}}},
        getSelection: () => ({rangeCount: 1, getRangeAt: () => selected}),
        hasClosestByAttribute: (node: typeof old, name: string) => name === "data-node-id" ? node : undefined,
        hasClosestByClassName: (): undefined => undefined, getPreviousBlock: (): undefined => undefined,
        isEncryptedBox: () => false, isCurrentEditor: () => true, isInEmbedBlock: () => false,
        revealTabsForTarget() {}, preventScroll() {}, hideElements() {}, updateBacklinkGraph() {},
        initMirror() {}, setPanelFocus() {}, resize() {},
        isPhablet: () => action === "highlight", resolveVisibleListMindmapBlock: (): undefined => undefined,
        hasFocusOffsets: () => false, recordRestoredSpellcheckFocus() {},
        focusBlock: (node: typeof old) => {selected = {startContainer: node, endContainer: node}; return selected;},
        pushBack() {}, pushBackByEditor() {},
        scrollCenter: (_protyle: unknown, node: typeof old) => { bodyTarget = node.id; },
        highlightById: (_protyle: unknown, id: string) => { bodyTarget = id; },
        bgFade() {}, getContenteditableElement: (node: typeof old) => node,
        document: {createRange: () => ({selectNodeContents() {}, collapse() {}})},
        ResizeObserver: class {observe() {} disconnect() {}},
        setTimeout: (callback: () => void, delay: number) => {if (!delay) { timers.push(callback); }},
        fetchPost: (url: string, _params: unknown, callback: (response: unknown) => void) =>
            new Promise<void>(resolve => requests.push({url, callback: response => {
                callback(response);
                resolve();
            }})),
        fetchSyncPost: (url: string) => new Promise(resolve => requests.push({url, callback: resolve})),
        onGet: (options: {action: string[], scrollPosition: string}) => {
            // 模拟文档响应完成渲染，再执行实际定位逻辑。
            visible.clear();
            visible.add(clicked);
            protyle.block.id = clicked.id;
            context.focusElementById(protyle, options.action, undefined, options.scrollPosition);
        },
        getAllModels: () => ({outline: [context.outline], editor: [] as unknown[]}),
    };
    runInNewContext(compiled, context);
    context.outline = new context.OutlineHarness();
    context.outline.element = panel;
    context.outline.update = (_response: unknown, id: string) => {
        context.outline.blockId = id;
        outlineUpdates.push(id);
    };
    context.outline.updateDocTitle = () => {};
    const initialized = new context.ProtyleHarness();
    initialized.protyle = protyle;
    const syncPanel = () => context.updatePanelByEditor({
        protyle, focus: false, pushBackStack: false, reload: false, resize: false,
    });
    const editor = {editor: {protyle}, parent: {headElement: {}, parent: {
        switchTab: (_head: unknown, _pushBack: boolean, update = true) => {if (update) { syncPanel(); }},
        showHeading() {},
    }}};
    context.openFile = (options: unknown) => context.switchEditor(editor, options, {});
    return {
        panel, scrollWrites, requests, syncPanel, outlineUpdates,
        reloadOutline: () => context.updateOutline({outline: [context.outline]}, protyle, true),
        clickHeading: () => context.outline.click(rows[1]),
        highlight: () => rows.find(row => row.classList.contains("b3-list-item--focus"))?.id,
        bodyTarget: () => bodyTarget,
        caret: () => selected.startContainer.id,
        navigate: () => context.switchEditor(editor, {id: clicked.id, rootID: "doc", scrollPosition: "start",
            action: [action, "outline", "context"]}, {}),
        initialize: () => initialized.afterOnGet({blockId: clicked.id, action: [action, "outline"]}),
        requestBreadcrumb: () => context.outline.setCurrent({isConnected: true,
            getAttribute: (name: string) => name === "data-type" ? "NodeParagraph" : "old-paragraph"}),
        selectHeading: () => context.outline.setCurrentById(clicked.id, false),
        flushFocus: () => timers.splice(0).forEach(callback => callback()),
    };
};

for (const loaded of [true, false]) {
    for (const action of ["focus", "highlight"] as const) {
        for (const pending of ["fold", "block-info"]) {
            test(`outline clicks reject older reloads while awaiting ${pending} (${loaded ? "loaded" : "unloaded"}, ${action})`, async () => {
                const fixture = setupNavigation(loaded, action);
                fixture.reloadOutline();
                const reload = fixture.requests[0];
                assert.equal(reload.url, "/api/outline/getDocOutline");
                fixture.clickHeading();
                assert.equal(fixture.requests[1].url, "/api/block/checkBlockFold");
                if (pending === "fold") {
                    reload.callback({data: []});
                }
                fixture.requests[1].callback({data: {isFolded: false, isRoot: false}});
                assert.equal(fixture.requests[2].url, "/api/block/getBlockInfo");
                if (pending === "block-info") {
                    reload.callback({data: []});
                }
                assert.equal(fixture.highlight(), "clicked-heading");
                assert.equal(fixture.panel.scrollTop, 320);
                assert.deepEqual(fixture.outlineUpdates, []);
                assert.deepEqual(fixture.scrollWrites, []);
                fixture.requests[2].callback({code: 0, data: {rootID: "doc"}});
                await setImmediate();
                if (!loaded) {
                    assert.equal(fixture.requests[3].url, "/api/filetree/getDoc");
                    fixture.requests[3].callback({data: {}});
                }
                fixture.flushFocus();
                assert.equal(fixture.bodyTarget(), "clicked-heading");
                assert.equal(fixture.highlight(), "clicked-heading");
                assert.equal(fixture.panel.scrollTop, 320);
                assert.deepEqual(fixture.scrollWrites, []);
            });
        }
    }
}

for (const loaded of [true, false]) {
    for (const action of ["focus", "highlight"] as const) {
        test(`outline navigation preserves the selected heading and scroll position (${loaded ? "loaded" : "unloaded"}, ${action})`, () => {
            const fixture = setupNavigation(loaded, action);
            fixture.navigate();
            assert.equal(fixture.highlight(), "clicked-heading");
            assert.equal(fixture.panel.scrollTop, 320);
            assert.deepEqual(fixture.scrollWrites, []);
            if (!loaded) {
                assert.equal(fixture.requests.length, 1);
                assert.equal(fixture.requests[0].url, "/api/filetree/getDoc");
                fixture.requests[0].callback({data: {}});
            }
            fixture.flushFocus();
            assert.equal(fixture.bodyTarget(), "clicked-heading");
            if (action === "focus") {
                assert.equal(fixture.caret(), "clicked-heading");
            }
            assert.equal(fixture.highlight(), "clicked-heading");
            assert.equal(fixture.panel.scrollTop, 320);
            assert.deepEqual(fixture.scrollWrites, []);
        });
    }
}

test("ordinary editor panel updates still follow and reveal the caret heading", () => {
    const fixture = setupNavigation(true, "focus");
    fixture.syncPanel();
    assert.equal(fixture.highlight(), "old-heading");
    assert.equal(fixture.panel.scrollTop, 70);
    assert.deepEqual(fixture.scrollWrites, [70]);
});

for (const action of ["focus", "highlight"] as const) {
    test(`newly initialized editors retain the requested outline heading before focus settles (${action})`, () => {
        const fixture = setupNavigation(false, action);
        fixture.initialize();
        assert.equal(fixture.highlight(), "clicked-heading");
        assert.equal(fixture.panel.scrollTop, 320);
        assert.deepEqual(fixture.scrollWrites, []);
    });
}

test("selecting an outline heading cancels an older paragraph breadcrumb response", async () => {
    const fixture = setupNavigation(true, "focus");
    await fixture.requestBreadcrumb();
    assert.equal(fixture.requests[0].url, "/api/block/getBlockBreadcrumb");
    fixture.selectHeading();
    fixture.requests[0].callback({data: [{type: "NodeHeading", id: "old-heading"}]});
    assert.equal(fixture.highlight(), "clicked-heading");
    assert.equal(fixture.panel.scrollTop, 320);
    assert.deepEqual(fixture.scrollWrites, []);
});
