import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isClassDeclaration, ScriptTarget, transpileModule} from "typescript";

const source = createSourceFile("view.ts", readFileSync("src/protyle/render/listMindmap/view.ts", "utf8"),
    ScriptTarget.ES2021, true);
const view = source.statements.find(item => isClassDeclaration(item) && item.name?.text === "ListMindmapView");
assert.ok(view && isClassDeclaration(view));
const names = ["focusNode", "revealNode", "isPanTarget", "dismissControls", "pointerDown", "preparePointer", "beginPointer", "pointerUp"];
const methods = view.members.filter(item => item.name && names.includes(item.name.getText(source)));
assert.equal(methods.length, names.length);
const compiled = transpileModule(`class View { ${methods.map(item => item.getText(source)).join("\n")} }
globalThis.View = View;`, {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;

const setup = () => {
    const frames: (() => void)[] = [];
    const context: any = {clearTimeout, requestAnimationFrame: (action: () => void) => frames.push(action)};
    runInNewContext(compiled, context);
    let focus = "editor";
    let finished = 0;
    let drawn = 0;
    const host = {focus: () => focus = "canvas"};
    const target = Object.assign(new context.View(), {
        options: {host}, editingId: "new", model: {nodes: new Map([["new", {}]])},
        selectedId: "new", tooltip: {},
        nodeElements: new Map(), offsetX: 0, offsetY: 0,
        viewport: {contains: (element: unknown) => !!element, setPointerCapture: () => {},
            getBoundingClientRect: () => ({left: 0, top: 0, right: 400, bottom: 300, width: 400, height: 300})},
        selectNode: () => {}, findLine: (): unknown => undefined, selectLine: () => {},
        clearSelection: () => { target.selectedId = undefined; },
        boundedPan: (x: number, y: number) => ({x, y}), draw: () => drawn++,
        finishThen: (action: () => void) => { finished++; target.editingId = undefined; action(); },
        cancelPointer: () => { target.pointer = undefined; },
    });
    const element = (kind = "background") => ({
        dataset: {mindmapId: "other"},
        closest: (selector: string) => {
            if (selector === ".mindmap-view") {
                return host;
            }
            return kind !== "background" && selector.includes(kind) ? element() : null;
        },
    });
    const event = (kind = "background", overrides: Record<string, unknown> = {}) => ({
        target: element(kind), pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0,
        clientX: 20, clientY: 20, defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; }, ...overrides,
    });
    return {target, frames, event, focus: () => focus, finished: () => finished, drawn: () => drawn};
};

test("focusing a new offscreen node reveals it after the pending layout", () => {
    const {target, frames, drawn} = setup();
    target.frame = 1;
    let rect = {left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0};
    target.nodeElements.set("new", {getBoundingClientRect: () => rect});
    target.focusNode("new");
    assert.equal(drawn(), 0);
    rect = {left: 420, top: 320, right: 500, bottom: 360, width: 80, height: 40};
    frames.forEach(action => action());
    assert.equal(target.offsetX, -116);
    assert.equal(target.offsetY, -76);
    assert.equal(drawn(), 1);
});

test("focusing visible, missing or removed nodes does not pan", () => {
    const {target, drawn} = setup();
    target.nodeElements.set("new", {getBoundingClientRect: () =>
        ({left: 100, top: 100, right: 200, bottom: 140, width: 100, height: 40})});
    target.focusNode("new");
    target.focusNode("missing");
    target.destroyed = true;
    target.focusNode("new");
    assert.equal(drawn(), 0);
});

test("mouse, right-button and primary touch panning preserve the editing focus", () => {
    for (const overrides of [{}, {button: 2}, {pointerType: "touch"}]) {
        const {target, event, focus, finished} = setup();
        const down = event("background", overrides);
        target.dismissControls(down);
        target.pointerDown(down);
        assert.equal(down.defaultPrevented, true);
        assert.equal(focus(), "editor");
        assert.equal(finished(), 0);
        assert.ok(target.pointer);
        target.pointer.moved = true;
        target.pointerUp(down);
        assert.equal(focus(), "editor");
        assert.equal(finished(), 0);
        assert.equal(target.editingId, "new");
        assert.equal(target.selectedId, "new");
    }
});

test("a background click still finishes editing while a canceled drag leaves it active", () => {
    const {target, event, focus, finished} = setup();
    const down = event();
    target.pointerDown(down);
    target.pointerUp(down);
    assert.equal(finished(), 1);
    assert.equal(focus(), "canvas");
    target.editingId = "new";
    target.pointerDown(event());
    target.cancelPointer();
    assert.equal(target.editingId, "new");
    assert.equal(finished(), 1);
});

test("nodes, controls, nested maps, lines and non-pan modes retain their own interactions", () => {
    const {target, event} = setup();
    for (const kind of [".mindmap-view__node", "button", ".mindmap-view__node--editing", ".mindmap-view__summary"]) {
        assert.equal(target.isPanTarget(event(kind)), false, kind);
    }
    assert.equal(target.isPanTarget(event("background", {pointerType: "touch", isPrimary: false})), false);
    assert.equal(target.isPanTarget(event("background", {target: {closest: () => ({})}})), false);
    target.findLine = () => ({relation: true});
    assert.equal(target.isPanTarget(event()), false);
    target.findLine = (): unknown => undefined;
    for (const key of ["locked", "pinching", "summarySelecting", "relationFrom"]) {
        target[key] = true;
        assert.equal(target.isPanTarget(event()), false, key);
        target[key] = false;
    }
});

test("clicking a virtual root preserves its selection for title editing", () => {
    const {target, event} = setup();
    target.editingId = undefined;
    target.model.nodes.set("new", {virtual: true});
    const down = event();
    target.beginPointer(down, "new");
    target.pointerUp(down);
    assert.equal(target.selectedId, "new");
});
