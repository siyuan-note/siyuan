import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const noop = () => {};

const setup = (mobile = false) => {
    const exports = {} as typeof import("./relation");
    const listeners = new Map<string, (event: unknown) => void>();
    const timers = new Map<number, () => void>();
    const requests: {signal: AbortSignal, callback: (response: unknown) => void}[] = [];
    const positions: IPosition[] = [];
    let closeCallback: () => void;
    let focusCount = 0;
    let resetCount = 0;
    let timerId = 0;
    const input = {value: "", addEventListener: (name: string, listener: (event: unknown) => void) => listeners.set(name, listener),
        focus: () => { focusCount++; }};
    const list = {innerHTML: "", querySelector: (): null => null};
    const element = {querySelector: (selector: string) => selector === "input" ? input : list,
        lastElementChild: {addEventListener: noop}, classList: {add: noop}, setAttribute: noop};
    const menu = {resetPosition: () => { resetCount++; }, remove: () => {
        const callback = closeCallback;
        closeCallback = undefined;
        callback?.();
    }};
    runInNewContext(transpileModule(readFileSync("src/protyle/render/av/relation.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText, {
        exports, AbortController,
        clearTimeout: (id: number) => timers.delete(id),
        require: (name: string) => {
            if (name === "../../../plugin/Menu") { return {Menu: class {
                element = element;
                constructor(_id: string, onClose: () => void) { closeCallback = onClose; }
                addItem(options: IMenu) { options.bind(element as unknown as HTMLElement); }
                open(position: IPosition) { positions.push(position); }
            }}; }
            if (name === "../../../util/fetch") { return {fetchPost: (_url: string, _data: unknown,
                callback: (response: unknown) => void, _headers: unknown, _process: unknown, signal: AbortSignal) => {
                requests.push({signal, callback});
            }}; }
            if (name === "../../../util/functions") { return {isMobile: () => mobile}; }
            if (name === "../../util/hasClosest") { return {hasTopClosestByClassName: (): null => null}; }
            if (name === "./searchAVFocus") { return {getSearchAVFocus: (): null => null}; }
            if (name === "../../../constants") { return {Constants: {TIMEOUT_INPUT: 1}}; }
            return {};
        },
        window: {siyuan: {menus: {menu}, languages: {}},
            setTimeout: (callback: () => void) => { timers.set(++timerId, callback); return timerId; }},
    });
    exports.openSearchAV({avID: "", purpose: "addToDatabase", position: {x: 60, y: 90},
        target: {getBoundingClientRect: () => ({left: 0, bottom: 0, height: 0})} as HTMLElement});
    const respond = (index: number) => requests[index].callback({data: {results: []}});
    const search = () => {
        input.value = "database";
        listeners.get("input")({stopPropagation: noop, isComposing: false});
    };
    const runTimers = () => {
        const callbacks = Array.from(timers.values());
        timers.clear();
        callbacks.forEach(callback => callback());
    };
    return {requests, positions, timers, respond, search, runTimers, close: menu.remove,
        focusCount: () => focusCount, resetCount: () => resetCount};
};

test("closing a pending database picker aborts its request and prevents reopening or focusing on a late response", () => {
    const picker = setup();
    picker.close();
    assert.equal(picker.requests[0].signal.aborted, true);
    picker.respond(0);
    assert.equal(picker.positions.length, 0);
    assert.equal(picker.focusCount(), 0);
    assert.equal(picker.resetCount(), 0);
});

test("closing a database picker clears debounced search work", () => {
    const picker = setup();
    picker.respond(0);
    picker.search();
    assert.equal(picker.timers.size, 1);
    picker.close();
    assert.equal(picker.timers.size, 0);
    picker.search();
    assert.equal(picker.timers.size, 0);
    picker.runTimers();
    assert.equal(picker.requests.length, 1);
});

for (const mobile of [false, true]) {
    test(`database searching keeps its position and cancels in-flight work on close (${mobile ? "mobile" : "desktop"})`, () => {
        const picker = setup(mobile);
        picker.respond(0);
        assert.equal(JSON.stringify(picker.positions), '[{"x":60,"y":90}]');
        assert.equal(picker.focusCount(), 1);
        picker.search();
        picker.runTimers();
        assert.equal(picker.requests.length, 2);
        picker.close();
        assert.equal(picker.requests[1].signal.aborted, true);
        picker.respond(1);
        assert.equal(picker.positions.length, 1);
        assert.equal(picker.resetCount(), 1);
    });
}
