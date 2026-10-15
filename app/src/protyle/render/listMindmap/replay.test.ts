import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isArrowFunction, isClassDeclaration, isVariableDeclaration, isVariableStatement, ScriptTarget, transpileModule} from "typescript";

const compile = (source: string) => transpileModule(source, {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
const indexSource = createSourceFile("index.ts", readFileSync("src/protyle/render/listMindmap/index.ts", "utf8"),
    ScriptTarget.ES2021, true);
const controller = indexSource.statements.find(item => isClassDeclaration(item) && item.name?.text === "ListMindmapController");
assert.ok(controller && isClassDeclaration(controller));
const replay = controller.members.find(item => item.name?.getText(indexSource) === "replay");
const replaySource = compile(`class Controller { ${replay.getText(indexSource)} } globalThis.Controller = Controller;`);

// 小型 DOM 替身验证对象身份和替换顺序；真实布局/选区另由 Electron 回归覆盖。
class ElementFixture {
    public nodeType = 1;
    public nodeValue = "";
    public childNodes: ElementFixture[] = [];
    public parentElement?: ElementFixture;
    public isConnected = true;
    public ownerDocument: {createElement: () => unknown};
    private attrs = new Map<string, string>();
    constructor(id?: string, type = "NodeMindmap") {
        if (id) {
            this.setAttribute("data-node-id", id);
            this.setAttribute("data-type", type);
        }
    }
    get attributes() { return Array.from(this.attrs, ([name, value]) => ({name, value})); }
    get dataset(): Record<string, string> {
        const name = (key: string) => "data-" + key.replace(/[A-Z]/g, value => "-" + value.toLowerCase());
        return new Proxy({}, {get: (_target, key: string) => this.getAttribute(name(key)),
            set: (_target, key: string, value: string) => { this.setAttribute(name(key), value); return true; }});
    }
    getAttribute(name: string) { return this.attrs.get(name) ?? null; }
    setAttribute(name: string, value: string) { this.attrs.set(name, value); }
    removeAttribute(name: string) { this.attrs.delete(name); }
    append(child: ElementFixture) { this.insertBefore(child, null); }
    remove() {
        if (this.parentElement) {
            this.parentElement.childNodes.splice(this.parentElement.childNodes.indexOf(this), 1);
            this.parentElement = undefined;
        }
    }
    insertBefore(child: ElementFixture, before: ElementFixture | null) {
        child.remove();
        const index = before ? this.childNodes.indexOf(before) : this.childNodes.length;
        assert.ok(index >= 0);
        this.childNodes.splice(index, 0, child);
        child.parentElement = this;
    }
}

const fixture = () => {
    const list = new ElementFixture("map");
    const old = new ElementFixture("old", "NodeMindmapItem");
    const host = new ElementFixture();
    list.append(old);
    list.append(host);
    let next = new ElementFixture("map");
    const heading = new ElementFixture("heading", "NodeHeading");
    heading.setAttribute("fold", "1");
    const hidden = new ElementFixture("hidden", "NodeParagraph");
    next.append(heading);
    next.append(hidden);
    next.setAttribute("style", "height:420px");
    const calls: [string, unknown][] = [];
    list.ownerDocument = {createElement: () => ({
        content: {get firstElementChild() { return next; }, childElementCount: 1},
        set innerHTML(value: string) { calls.push(["parse", value]); },
    })};
    const context: any = {
        Element: ElementFixture, Node: {COMMENT_NODE: 8}, Constants: {CUSTOM_SY_LIST_MINDMAP: "custom-sy-list-mindmap"},
        canEdit: () => true, cleanListMindmapHTML: (html: string) => html,
        normalizeHTMLAssetIFrameBlockDOM: (html: string) => { calls.push(["normalize", html]); return html; },
        readListMindmap: (source: unknown) => { calls.push(["validate", source]); },
        disposeCustomBlocksInElement: (source: unknown) => calls.push(["dispose", source]),
        processRender: (source: unknown) => calls.push(["process", source]),
        highlightRender: (source: unknown) => calls.push(["highlight", source]),
        avRender: (source: unknown) => calls.push(["av", source]),
        blockRender: (_owner: unknown, source: unknown) => calls.push(["embed", source]),
    };
    runInNewContext(replaySource, context);
    const target = Object.assign(new context.Controller(), {list, host, owner: {}, refresh: () => calls.push(["refresh", list])});
    return {target, list, host, old, heading, hidden, calls, setNext: (value: ElementFixture) => { next = value; }};
};

test("complete replay retains the list and canvas, restores folded source and renders only replacement source", () => {
    const {target, list, host, old, heading, hidden, calls} = fixture();
    assert.equal(target.replay("raw complete snapshot"), true);
    assert.equal(target.list, list);
    assert.equal(target.host, host);
    assert.deepEqual(list.childNodes, [heading, hidden, host]);
    assert.equal(list.dataset.mindmapViewRendered, "true");
    assert.equal(list.getAttribute("style"), "height:420px");
    assert.deepEqual(calls.filter(([kind]) => kind === "dispose"), [["dispose", old]]);
    for (const kind of ["process", "highlight", "av", "embed"]) {
        assert.deepEqual(calls.filter(([name]) => name === kind).map(([, node]) => node), [heading, hidden]);
    }
    assert.equal(calls.at(-1)[0], "refresh");
});

test("fullscreen replay preserves the exact return marker while the canvas is outside the list", () => {
    const {target, list, host, heading, hidden} = fixture();
    host.remove();
    const marker = new ElementFixture();
    marker.nodeType = 8;
    marker.nodeValue = "mindmap-view";
    list.append(marker);
    assert.equal(target.replay("complete"), true);
    assert.deepEqual(list.childNodes, [heading, hidden, marker]);
    assert.equal(target.host, host);
});

test("equivalent snapshots still invalidate the model source cache after replacing its DOM", () => {
    const {target, hidden} = fixture();
    target.snapshot = "same serialized source";
    let rebound = false;
    target.refresh = () => {
        assert.equal(target.snapshot, "");
        assert.ok(target.list.childNodes.includes(hidden));
        rebound = true;
    };
    assert.equal(target.replay("same serialized source"), true);
    assert.equal(rebound, true);
});

test("replay falls back without mutation for another ID, type, inactive map or active editor", () => {
    for (const state of ["id", "type", "editor", "disposed", "disconnected"]) {
        const fixtureState = fixture();
        const {target, list, old, host, calls} = fixtureState;
        if (state === "id") { fixtureState.setNext(new ElementFixture("other")); }
        if (state === "type") { fixtureState.setNext(new ElementFixture("map", "NodeList")); }
        if (state === "editor") { target.activeEditor = {}; }
        if (state === "disposed") { target.disposed = true; }
        if (state === "disconnected") { list.isConnected = false; }
        assert.equal(target.replay("snapshot"), false, state);
        assert.deepEqual(list.childNodes, [old, host]);
        assert.ok(!calls.some(([kind]) => kind === "dispose"));
    }
});

const renderSource = createSourceFile("render.ts", readFileSync("src/protyle/render/listMindmap/render.ts", "utf8"),
    ScriptTarget.ES2021, true);
const names = ["editorRoots", "registerListMindmapRoot", "replayListMindmap", "readListMindmapSelection", "restoreListMindmapFocus"];
const declarations = renderSource.statements.filter(item => isVariableStatement(item) &&
    item.declarationList.declarations.some(declaration => names.includes(declaration.name.getText(renderSource))));
const registry = new Function(compile(declarations.map(item => item.getText(renderSource)).join("\n").replace(/^export /gm, "")) +
    "; return {registerListMindmapRoot, replayListMindmap, readListMindmapSelection};")();

test("full snapshot permission is bound to each operation and registered source instance", () => {
    const root = {};
    const source = new ElementFixture("map");
    const mirror = new ElementFixture("map");
    const calls: unknown[] = [];
    registry.registerListMindmapRoot(root, () => {}, () => {}, (element: unknown, html: string) => {
        calls.push([element, html]);
        return element === source;
    });
    const operation = {action: "update", id: "map", data: "complete", context: {mindmapSnapshotId: "map"}};
    assert.equal(registry.replayListMindmap(root, source, operation), true);
    assert.equal(registry.replayListMindmap(root, mirror, operation), false);
    assert.equal(registry.replayListMindmap(root, source, {...operation, context: {}}), false);
    assert.equal(registry.replayListMindmap(root, source, {...operation, id: "other"}), false);
    assert.equal(calls.length, 2);
});

test("text selection validation preserves exact block offsets and rejects malformed context", () => {
    const selection = {undoFocusId: "paragraph-1", undoFocusEndId: "paragraph-2", undoFocusStart: "2",
        undoFocusEnd: "5", undoFocusIgnoreZWSP: "true", backward: "true"};
    assert.deepEqual(registry.readListMindmapSelection(JSON.stringify(selection)), selection);
    for (const value of [undefined, "{", "null", "[]", JSON.stringify({}),
        JSON.stringify({...selection, undoFocusId: 'x"]'}), JSON.stringify({...selection, undoFocusStart: "-1"}),
        JSON.stringify({...selection, undoFocusEnd: "1.5"}), JSON.stringify({...selection, backward: true}),
        JSON.stringify({...selection, undoFocusEndIndex: "Infinity"})]) {
        assert.equal(registry.readListMindmapSelection(value), undefined);
    }
});

test("delayed global history focus targets the exact map instance and expires on a later interaction", () => {
    let declaration: string;
    const visit = (item: import("typescript").Node) => {
        if (isVariableDeclaration(item) && item.name.getText(indexSource) === "restoreFocus" &&
            item.initializer && isArrowFunction(item.initializer)) {
            declaration = item.getText(indexSource);
        }
        item.forEachChild(visit);
    };
    visit(indexSource);
    assert.ok(declaration);
    const owner = {};
    const state = {focusRevision: 0, interactionRevision: 0};
    const root = {};
    const mirror = {dataset: {nodeId: "map"}};
    const source = {dataset: {nodeId: "map"}};
    const roots = new WeakMap([[owner, state]]);
    const dependencies = {owner, root, roots, disposed: false, getListMindmapElements: () => [mirror, source],
        hasMindmapFocusOverlay: () => false, instances: new Map(), refresh: () => {}};
    const api = new Function(...Object.keys(dependencies), `let pendingFocus;
        ${compile(`const ${declaration};`)} return {restoreFocus, pending: () => pendingFocus};`)(...Object.values(dependencies));
    api.restoreFocus("map", ["item"], undefined, source);
    const pending = api.pending();
    assert.equal(pending.list, source);
    assert.equal(pending.guard(), true);
    state.interactionRevision++;
    assert.equal(pending.guard(), false, "global history also protects async mounting, without a controller undo guard");
});

test("transaction replay keeps block selection and runs before folded-source clipping or canvas disposal", () => {
    const file = createSourceFile("transaction.ts", readFileSync("src/protyle/wysiwyg/transaction.ts", "utf8"), ScriptTarget.ES2021, true);
    const declaration = file.statements.find(item => isVariableStatement(item) &&
        item.declarationList.declarations.some(value => value.name.getText(file) === "updateBlock"));
    assert.ok(declaration);
    const calls: string[] = [];
    const source = {parentElement: {}};
    const saved = {};
    const dependencies = {
        getSelection: () => ({rangeCount: 0}), isInEmbedBlock: () => false,
        captureBlockSelectionModeState: () => { calls.push("capture"); return saved; },
        replayListMindmap: (_root: unknown, element: unknown, operation: {data: string}) => {
            assert.equal(element, source);
            assert.equal(operation.data, "full untrimmed source");
            calls.push("replay"); return true;
        },
        restoreBlockSelectionModeState: (_root: unknown, element: unknown, value: unknown) => {
            assert.equal(element, source); assert.equal(value, saved); calls.push("restore"); return source;
        },
        focusRestoredBlockSelectionMode: () => calls.push("focus"),
        disposeCustomBlocksInElement: () => assert.fail("must not dispose the preserved canvas"),
        getVisibleFoldHeadingHTML: () => assert.fail("complete source must not be clipped"),
    };
    const update = new Function(...Object.keys(dependencies), compile(declaration.getText(file)) + "; return updateBlock;")(
        ...Object.values(dependencies));
    update([source], {wysiwyg: {element: {}}}, {action: "update", id: "map", data: "full untrimmed source",
        context: {mindmapSnapshotId: "map"}}, true);
    assert.deepEqual(calls, ["capture", "replay", "restore", "focus"]);
});
