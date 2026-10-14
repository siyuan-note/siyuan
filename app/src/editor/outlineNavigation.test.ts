import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isClassDeclaration, isVariableStatement, ScriptTarget, transpileModule} from "typescript";

const getDeclarations = (path: string, names: string[]) => {
    const source = createSourceFile(path, readFileSync(path, "utf8"), ScriptTarget.ES2021, true);
    return source.statements.filter(statement => isVariableStatement(statement) &&
        statement.declarationList.declarations.some(item => names.includes(item.name.getText(source))))
        .map(statement => statement.getText(source).replace(/^export /, "")).join("\n");
};
const outlineSource = createSourceFile("Outline.ts", readFileSync("src/layout/dock/Outline.ts", "utf8"), ScriptTarget.ES2021, true);
const methods = outlineSource.statements.find(isClassDeclaration).members.filter(member =>
    ["setCurrent", "setCurrentById", "invalidateCurrent"].includes(member.name?.getText(outlineSource)));
const protyleSource = createSourceFile("Protyle.ts", readFileSync("src/protyle/index.ts", "utf8"), ScriptTarget.ES2021, true);
const afterOnGet = protyleSource.statements.find(isClassDeclaration).members.find(member =>
    member.name?.getText(protyleSource) === "afterOnGet");
const compiled = transpileModule(getDeclarations("src/editor/util.ts", [
    "outlineRequests", "syncOutlineCurrent", "updateOutline", "switchEditor", "updatePanelByEditor",
]) + "\n" + getDeclarations("src/protyle/util/onGet.ts", ["focusElementById"]) + `
class OutlineHarness {
    currentRequestID = 0; blockId = "doc"; type = "pin"; isPreview = false;
    getNotebookId() { return ""; }
    ${methods.map(method => method.getText(outlineSource)).join("\n")}
}
class ProtyleHarness { ${afterOnGet.getText(protyleSource)} }
Object.assign(globalThis, {switchEditor, updatePanelByEditor, focusElementById, OutlineHarness, ProtyleHarness});`, {
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
        block: {id: "doc", rootID: "doc"}, notebookId: "box", toolbar: {range: selected},
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
        getBoundingClientRect: () => ({top: (index ? 900 : 100) - panel.scrollTop}),
    }));
    const context: any = {
        Constants: {CB_GET_FOCUS: "focus", CB_GET_HL: "highlight", CB_GET_OUTLINE: "outline",
            CB_GET_CONTEXT: "context", LOCAL_OUTLINE: "outlineStorage"}, AbortController,
        window: {siyuan: {config: {editor: {dynamicLoadBlocks: 64}}, storage: {outlineStorage: {keepCurrentExpand: false}}}},
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
        fetchPost: (url: string, _params: unknown, callback: (response: unknown) => void) => requests.push({url, callback}),
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
    const initialized = new context.ProtyleHarness();
    initialized.protyle = protyle;
    const syncPanel = () => context.updatePanelByEditor({
        protyle, focus: false, pushBackStack: false, reload: false, resize: false,
    });
    const editor = {editor: {protyle}, parent: {headElement: {}, parent: {
        switchTab: (_head: unknown, _pushBack: boolean, update = true) => {if (update) { syncPanel(); }},
        showHeading() {},
    }}};
    return {
        panel, scrollWrites, requests, syncPanel,
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
    assert.equal(fixture.panel.scrollTop, 50);
    assert.deepEqual(fixture.scrollWrites, [50]);
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
