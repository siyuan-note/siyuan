import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {getBlockDragSelectContentBounds} from "./blockDragSelect";

const compiled = transpileModule(readFileSync(__dirname + "/touchBlockDragSelect.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const fixture = (enabled = true) => {
    const calls: string[] = [];
    const element = Object.assign(new EventTarget(), {
        closest: (selector: string): unknown => selector === ".protyle-wysiwyg" ? element : null,
        getBoundingClientRect: () => ({left: 0, right: 500}),
    });
    class MouseEvent extends Event {
        constructor(type: string, options: MouseEventInit) {
            super(type, options);
            Object.defineProperty(this, "clientX", {value: options.clientX});
        }
    }
    ["mousedown", "mousemove", "mouseup", "click"].forEach(type => element.addEventListener(type, () => calls.push(type)));
    const exports = {} as typeof import("./touchBlockDragSelect");
    runInNewContext(compiled, {
        exports, MouseEvent, window: {},
        document: {elementFromPoint: () => element},
        getComputedStyle: () => ({paddingLeft: "50px", paddingRight: "50px"}),
        require: () => ({getBlockDragSelectContentBounds}),
    });
    exports.bindTouchBlockDragSelect(element as unknown as HTMLElement, () => enabled);
    const send = (type: string, clientX: number) => {
        const event = new Event(type, {cancelable: true});
        const touch = {identifier: 1, clientX, clientY: 30};
        Object.defineProperties(event, {touches: {value: [touch]}, changedTouches: {value: [touch]}});
        element.dispatchEvent(event);
        return event;
    };
    return {calls, send};
};

test("touching either editor margin forwards mouse selection without synthesizing a click", () => {
    for (const x of [20, 480]) {
        const {calls, send} = fixture();
        assert.equal(send("touchstart", x).defaultPrevented, true);
        assert.equal(send("touchend", x).defaultPrevented, true);
        assert.deepEqual(calls, ["mousedown", "mouseup"]);
    }
});

test("margin dragging still forwards movement and cleans up cancellation", () => {
    const {calls, send} = fixture();
    send("touchstart", 20);
    send("touchmove", 25);
    send("touchcancel", 25);
    send("touchend", 25);
    assert.deepEqual(calls, ["mousedown", "mousemove", "mouseup"]);
});

test("content touches and disabled margin gestures retain their native event handling", () => {
    for (const [enabled, x] of [[true, 100], [false, 20]] as const) {
        const {calls, send} = fixture(enabled);
        assert.equal(send("touchstart", x).defaultPrevented, false);
        assert.equal(send("touchend", x).defaultPrevented, false);
        assert.deepEqual(calls, []);
    }
});
