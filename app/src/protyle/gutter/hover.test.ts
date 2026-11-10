import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const source = transpileModule(readFileSync(__dirname + "/hover.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const fixture = () => {
    const timers = new Map<number, () => void>();
    let nextTimer = 0;
    const api = {} as typeof import("./hover");
    runInNewContext(source, {exports: api, require: () => ({hasClosestBlock: (target: unknown) => root.has(target as typeof current) ? target : false}), window: {
        setTimeout: (callback: () => void, delay: number) => {
            assert.equal(delay, 150);
            timers.set(++nextTimer, callback);
            return nextTimer;
        },
        clearTimeout: (id: number) => timers.delete(id),
    }});
    const classes = new Set(["protyle-gutters--full"]);
    const buttons = [{dataset: {nodeId: "current"}}];
    const bounds = {left: 100, right: 124, top: 100, bottom: 400};
    const element = {
        isConnected: true, style: {flexDirection: "column"},
        classList: {contains: (name: string) => classes.has(name)},
        querySelectorAll: () => buttons,
        contains: (button: typeof buttons[number]) => buttons.includes(button),
        getBoundingClientRect: () => ({...bounds}),
    };
    const listeners = new Map<string, ((event: unknown) => void)[]>();
    const pane = {addEventListener: (type: string, listener: (event: unknown) => void) => {
        const callbacks = listeners.get(type) ?? [];
        callbacks.push(listener);
        listeners.set(type, callbacks);
    }};
    const block = (id: string) => {
        const node = {isConnected: true, getAttribute: () => id, closest: () => pane,
            contains: (target: unknown) => target === node};
        return node;
    };
    const current = block("current");
    const neighbor = block("neighbor");
    const other = block("other");
    const root = new Set([current, neighbor, other]);
    const calls: unknown[][] = [];
    const gutter = {element, render: (...args: unknown[]) => calls.push(args), getNodeElement: () => current};
    const owner = {element: pane, gutter, wysiwyg: {element: {contains: (item: typeof neighbor) => root.has(item)}}};
    const protyle = owner as unknown as IProtyle;
    const render = (target = neighbor) => api.renderGutterOnHover(protyle, target as unknown as HTMLElement);
    const cancel = () => api.cancelGutterHover(element as unknown as HTMLElement);
    const flush = () => {
        const callbacks = Array.from(timers.values());
        timers.clear();
        callbacks.forEach(callback => callback());
    };
    const bind = (pointerEvents = false) => api.bindGutterHover(protyle, pointerEvents);
    const dispatch = (type: string, event = {}) => listeners.get(type)?.forEach(callback => callback(event));
    const move = (x: number, y: number, target = current, type = "mousemove", extra = {}) =>
        dispatch(type, {target, clientX: x, clientY: y, buttons: 0, pointerType: "mouse", ...extra});
    return {render, cancel, flush, timers, classes, buttons, element, current, neighbor, other, root, calls, owner,
        bind, dispatch, move, bounds};
};

test("crossing adjacent blocks preserves a vertical chain until the pointer settles", () => {
    const f = fixture();
    f.render();
    assert.equal(f.calls.length, 0);
    assert.equal(f.timers.size, 1);
    f.render(f.other);
    assert.equal(f.timers.size, 1, "only the most recent hovered block remains pending");
    f.flush();
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0][1], f.other);
});

test("slow diagonal paths to either end of a column preserve it beyond the hover delay", () => {
    for (const pointerEvents of [false, true]) {
        const f = fixture();
        f.bind(pointerEvents);
        const type = pointerEvents ? "pointermove" : "mousemove";
        f.move(300, 110, f.current, type);
        for (const [x, y] of [[280, 130], [250, 180], [200, 240], [110, 390], [110, 105]]) {
            f.move(x, y, f.neighbor, type);
            f.render();
            f.flush();
            assert.equal(f.calls.length, 0, `${type}: ${x},${y}`);
        }
    }
});

test("returning towards body content switches even without another mouseover event", () => {
    const f = fixture();
    f.bind();
    f.move(300, 110);
    f.move(250, 180, f.neighbor);
    f.render();
    f.move(280, 180, f.neighbor);
    f.flush();
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0][1], f.neighbor);
});

test("moving vertically over body content still switches to the hovered block", () => {
    const f = fixture();
    f.bind();
    f.move(300, 110);
    f.move(300, 180, f.neighbor);
    f.render();
    f.flush();
    assert.equal(f.calls.length, 1);
});

test("column protection cancels an already pending block switch", () => {
    const f = fixture();
    f.bind();
    f.render();
    f.move(110, 250, f.neighbor);
    f.flush();
    assert.equal(f.calls.length, 0);
});

test("clicking, scrolling and leaving clear pending switches and pointer paths", () => {
    for (const type of ["pointerdown", "scroll", "mouseleave"]) {
        const f = fixture();
        f.bind();
        f.render();
        f.dispatch(type);
        f.flush();
        assert.equal(f.calls.length, 0, type);
        f.move(300, 110);
        f.move(250, 180, f.neighbor);
        f.dispatch(type);
        f.render();
        f.flush();
        assert.equal(f.calls.length, 1, type);
    }
});

test("a column to the right of the source has the same safe approach path", () => {
    const f = fixture();
    f.bind();
    f.move(30, 110);
    f.move(50, 160, f.neighbor);
    f.render();
    f.flush();
    assert.equal(f.calls.length, 0);
});

test("touch, pressed buttons, nested editors and changed geometry release pointer protection", () => {
    for (const change of ["touch", "pressed", "nested", "moved", "replaced", "hidden"]) {
        const f = fixture();
        f.bind(true);
        f.move(300, 110, f.current, "pointerover");
        f.move(250, 180, f.neighbor, "pointermove");
        if (change === "moved") f.bounds.top++;
        if (change === "replaced") f.buttons[0] = {dataset: {nodeId: "current"}};
        if (change === "hidden") f.classes.add("fn__none");
        if (change === "nested") f.neighbor.closest = () => ({addEventListener: () => {}});
        f.move(230, 190, f.neighbor, "pointermove", {
            pointerType: change === "touch" ? "touch" : "mouse", buttons: change === "pressed" ? 1 : 0,
        });
        f.render();
        f.flush();
        assert.equal(f.calls.length, 1, change);
    }
});

test("entering the gutter or leaving the editor cancels the pending switch", () => {
    const f = fixture();
    f.render();
    f.cancel();
    f.cancel();
    f.flush();
    assert.equal(f.calls.length, 0);
});

test("horizontal, compact, hidden and current-block gutters render immediately", () => {
    for (const mode of ["horizontal", "compact", "hidden", "current"]) {
        const f = fixture();
        if (mode === "horizontal") f.element.style.flexDirection = "";
        if (mode === "compact") f.classes.delete("protyle-gutters--full");
        if (mode === "hidden") f.classes.add("fn__none");
        f.render(mode === "current" ? f.current : f.neighbor);
        assert.equal(f.calls.length, 1, mode);
        assert.equal(f.timers.size, 0, mode);
    }
});

test("expired hover targets cannot restore hidden, replaced or disconnected editors", () => {
    for (const change of ["hidden", "redrawn", "gutter-removed", "block-removed", "document-changed", "gutter-replaced"]) {
        const f = fixture();
        f.render();
        if (change === "hidden") f.classes.add("fn__none");
        if (change === "redrawn") f.buttons.splice(0);
        if (change === "gutter-removed") f.element.isConnected = false;
        if (change === "block-removed") f.neighbor.isConnected = false;
        if (change === "document-changed") f.root.delete(f.neighbor);
        if (change === "gutter-replaced") f.owner.gutter = {...f.owner.gutter};
        f.flush();
        assert.equal(f.calls.length, 0, change);
    }
});
