import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const noop = () => {};

const setup = () => {
    const exports = {} as typeof import("./GraphEngine");
    const source = readFileSync("src/layout/dock/graph/GraphEngine.ts", "utf8")
        .replaceAll("import.meta.url", '"file:///graph/GraphEngine.ts"');
    const code = transpileModule(source, {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const listeners = new Map<string, (event: unknown) => void>();
    const canvas = () => ({setAttribute: noop, addEventListener: noop, removeEventListener: noop, remove: noop});
    runInNewContext(code, {
        exports, require: () => ({GraphLabelRenderer: class {destroy = noop;}}),
        document: {createElement: canvas},
        ResizeObserver: class {observe = noop; disconnect = noop;},
    });
    Object.assign(exports.GraphEngine.prototype, {
        resize: noop, createRenderer: () => ({destroy: noop}), scheduleRender: noop,
        hideTooltip: noop, stopLayout: noop, resetInteraction: noop,
    });
    const container = {append: noop,
        getBoundingClientRect: () => ({left: 40, top: 60}),
        addEventListener: (name: string, listener: (event: unknown) => void) => listeners.set(name, listener),
        removeEventListener: (name: string) => listeners.delete(name)};
    const menus: import("./types").IGraphNodeContextMenu[] = [];
    let clicks = 0;
    const engine = new exports.GraphEngine(container as unknown as HTMLElement, {
        onNodeClick: () => { clicks++; },
        onNodeContextMenu: details => {
            if (details.node.type !== "NodeDocument") { return false; }
            menus.push(details);
            return true;
        },
    });
    const state = Object.assign(engine, {
        data: {nodes: [{id: "doc", type: "NodeDocument"}, {id: "tag", type: "tag"}], sizes: [10, 10]},
        positions: new Float32Array([5, 8, 100, 100]), camera: {scale: 2, x: 20, y: 30},
    }) as unknown as {selected: number, pointerAction: unknown, pointers: Map<number, unknown>, destroy: () => void};
    const context = (clientX: number, clientY: number) => {
        let prevented = false;
        let stopped = false;
        listeners.get("contextmenu")({clientX, clientY,
            preventDefault: () => { prevented = true; }, stopPropagation: () => { stopped = true; }});
        return {prevented, stopped};
    };
    return {state, listeners, menus, context, clicks: () => clicks};
};

test("graph context menu resolves transformed coordinates without opening or dragging the document", () => {
    const {state, listeners, menus, context, clicks} = setup();
    listeners.get("pointerdown")({pointerType: "mouse", button: 2});
    assert.equal(state.pointerAction, undefined);
    assert.equal(state.pointers.size, 0);
    assert.deepEqual(context(70, 106), {prevented: true, stopped: true});
    assert.equal(menus[0].node.id, "doc");
    assert.equal(menus[0].x, 70);
    assert.equal(menus[0].y, 106);
    assert.equal(state.selected, 0);
    assert.equal(clicks(), 0);
    state.destroy();
    assert.equal(listeners.has("contextmenu"), false);
});

test("graph background and tag nodes do not receive a document context menu", () => {
    const {context, menus, state} = setup();
    assert.deepEqual(context(260, 290), {prevented: false, stopped: false});
    assert.deepEqual(context(500, 500), {prevented: false, stopped: false});
    assert.equal(menus.length, 0);
    assert.equal(state.selected, -1);
});
