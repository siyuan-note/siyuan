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
    runInNewContext(source, {exports: api, window: {
        setTimeout: (callback: () => void, delay: number) => {
            assert.equal(delay, 150);
            timers.set(++nextTimer, callback);
            return nextTimer;
        },
        clearTimeout: (id: number) => timers.delete(id),
    }});
    const classes = new Set(["protyle-gutters--full"]);
    const buttons = [{dataset: {nodeId: "current"}}];
    const element = {
        isConnected: true, style: {flexDirection: "column"},
        classList: {contains: (name: string) => classes.has(name)},
        querySelectorAll: () => buttons,
        contains: (button: typeof buttons[number]) => buttons.includes(button),
    };
    const block = (id: string) => ({isConnected: true, getAttribute: () => id});
    const current = block("current");
    const neighbor = block("neighbor");
    const other = block("other");
    const root = new Set([current, neighbor, other]);
    const calls: unknown[][] = [];
    const gutter = {element, render: (...args: unknown[]) => calls.push(args)};
    const owner = {gutter, wysiwyg: {element: {contains: (item: typeof neighbor) => root.has(item)}}};
    const protyle = owner as unknown as IProtyle;
    const render = (target = neighbor) => api.renderGutterOnHover(protyle, target as unknown as HTMLElement);
    const cancel = () => api.cancelGutterHover(element as unknown as HTMLElement);
    const flush = () => {
        const callbacks = Array.from(timers.values());
        timers.clear();
        callbacks.forEach(callback => callback());
    };
    return {render, cancel, flush, timers, classes, buttons, element, current, neighbor, other, root, calls, owner};
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
