import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isClassDeclaration, ScriptTarget, transpileModule} from "typescript";

const source = createSourceFile("view.ts", readFileSync("src/protyle/render/listMindmap/view.ts", "utf8"),
    ScriptTarget.ES2021, true);
const view = source.statements.find(item => isClassDeclaration(item) && item.name?.text === "ListMindmapView");
assert.ok(view && isClassDeclaration(view));
const names = ["readOnly", "startTouchNodeDrag", "pointerMove", "cancelPointer"];
const methods = view.members.filter(item => item.name && names.includes(item.name.getText(source)));
assert.equal(methods.length, names.length);
const compiled = transpileModule(`class View {${methods.map(item => item.getText(source)).join("\n")}}
globalThis.View = View;`, {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;

const setup = () => {
    const timers = new Map<number, () => void>();
    let nextTimer = 0;
    const classes = new Set<string>();
    const selected: string[] = [];
    const context: any = {
        Constants: {TIMEOUT_LONGPRESS: 460},
        window: {setTimeout: (callback: () => void) => { timers.set(++nextTimer, callback); return nextTimer; }},
        clearTimeout: (id: number) => timers.delete(id), cancelAnimationFrame: () => {},
    };
    runInNewContext(compiled, context);
    const element = {classList: {add: (name: string) => classes.add(name),
        remove: (...names: string[]) => names.forEach(name => classes.delete(name))}};
    const target = Object.assign(new context.View(), {
        options: {}, model: {nodes: new Map([["child", {}]])},
        nodeElements: new Map([["child", element]]), inspector: {}, selectionBox: {},
        viewport: {classList: element.classList},
        selectNode: (id: string) => selected.push(id), clearDrop: () => {},
        setHoveredLine: () => {}, requestDraw: () => {},
        boundedPan: (x: number, y: number) => ({x, y}),
        pointer: {pointerId: 1, touchNode: "child", pan: true, startX: 0, startY: 0, x: 0, y: 0, moved: false},
    });
    const pointer = target.pointer;
    target.startTouchNodeDrag(pointer);
    return {target, pointer, timers, classes, selected, flush: () => {
        const callbacks = [...timers.values()];
        timers.clear();
        callbacks.forEach(callback => callback());
    }};
};

test("touch node dragging is armed only after the hold and provides visible feedback", () => {
    const {target, pointer, classes, selected, flush} = setup();
    assert.equal(pointer.id, undefined);
    assert.equal(pointer.pan, true);
    assert.equal(classes.size, 0);
    flush();
    assert.equal(pointer.id, "child");
    assert.equal(pointer.pan, false);
    assert.deepEqual(selected, ["child"]);
    assert.equal(target.inspector.hidden, true);
    assert.equal(target.suppressLinkClick, true);
    assert.ok(classes.has("mindmap-view__node--drag-ready"));
    target.cancelPointer();
    assert.equal(classes.has("mindmap-view__node--drag-ready"), false);
});

test("a quick swipe starting on a node pans and permanently cancels the pending hold", () => {
    const {target, pointer, timers, selected, flush} = setup();
    target.pointerMove({pointerId: 1, clientX: 30, clientY: 20, preventDefault() {}});
    assert.equal(pointer.id, undefined);
    assert.equal(pointer.moved, true);
    assert.equal(timers.size, 0);
    assert.equal(target.offsetX, 30);
    assert.equal(target.offsetY, 20);
    flush();
    assert.equal(pointer.id, undefined);
    assert.deepEqual(selected, [], "panning across dense nodes does not change the selected node");
});

test("small finger jitter preserves the hold until the drag threshold is reached", () => {
    const {target, pointer, flush} = setup();
    target.pointerMove({pointerId: 1, clientX: 2, clientY: 2, preventDefault() {}});
    assert.equal(pointer.moved, false);
    flush();
    assert.equal(pointer.id, "child");
});

test("cancellation and pointer replacement cannot leave a delayed node drag", () => {
    for (const replace of [false, true]) {
        const {target, pointer, timers, classes, flush} = setup();
        const staleCallback = [...timers.values()][0];
        if (replace) {
            target.pointer = {pointerId: 2};
        } else {
            target.cancelPointer();
            assert.equal(timers.size, 0);
        }
        staleCallback();
        flush();
        assert.equal(pointer.id, undefined);
        assert.equal(classes.size, 0);
    }
});

test("read-only, locked, gesture and selection modes, destroyed and removed-node states reject a pending hold", () => {
    for (const mode of ["readOnly", "locked", "pinching", "panning", "multiSelect", "relationFrom", "destroyed", "removed"]) {
        const {target, pointer, selected, flush} = setup();
        if (mode === "readOnly") {
            target.options.readOnly = true;
        } else if (mode === "removed") {
            target.model.nodes.clear();
        } else {
            target[mode] = true;
        }
        flush();
        assert.equal(pointer.id, undefined, mode);
        assert.deepEqual(selected, [], mode);
    }
});
