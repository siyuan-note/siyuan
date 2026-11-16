import * as assert from "node:assert/strict";
import {test} from "node:test";
import {ScriptTarget} from "typescript";
import {loadModule} from "../../testSupport/loadModule";
import {getBlockDragSelectContentBounds} from "./blockDragSelect";

const fixture = (enabled = true, gutterSelected = false, handoff = true) => {
    const calls: string[] = [];
    const handedOff: unknown[] = [];
    let released = 0;
    const host = new EventTarget();
    const gutter = {closest: (selector: string): unknown => selector === ".protyle-gutters" ? gutter : selector === ".protyle" ? host : null};
    const element = Object.assign(new EventTarget(), {
        closest: (selector: string): unknown => selector === ".protyle-wysiwyg" ? element : null,
        getBoundingClientRect: () => ({left: 0, right: 500}),
        querySelector: () => gutterSelected ? {} : null,
    });
    class MouseEvent extends Event {
        constructor(type: string, options: MouseEventInit) {
            super(type, options);
            Object.defineProperty(this, "clientX", {value: options.clientX});
        }
    }
    ["mousedown", "mousemove", "mouseup", "click"].forEach(type => element.addEventListener(type, () => calls.push(type)));
    const exports = loadModule<typeof import("./touchBlockDragSelect")>(
        "src/protyle/wysiwyg/touchBlockDragSelect.ts", {
            MouseEvent, window: {},
            document: {elementFromPoint: () => element},
            getComputedStyle: () => ({paddingLeft: "50px", paddingRight: "50px"}),
            require: () => ({getBlockDragSelectContentBounds, cancelTouchDragCandidate: (target: unknown) => {
                handedOff.push(target); return handoff ? () => released++ : false;
            }, Constants: {SIZE_DRAG_THRESHOLD: 5, TIMEOUT_LONGPRESS: 500}}),
        }, ScriptTarget.ES2021);
    const dispose = exports.bindTouchBlockDragSelect(element as unknown as HTMLElement, () => enabled,
        host as HTMLElement);
    const send = (type: string, clientX: number, onGutter = false, clientY = 30, time = 0, count = 1, prevented = false) => {
        const event = new Event(type, {cancelable: true});
        const touch = {identifier: 1, clientX, clientY};
        Object.defineProperties(event, {touches: {value: Array(count).fill(touch)},
            changedTouches: {value: [touch]}, timeStamp: {value: time}});
        Object.defineProperty(event, "target", {value: onGutter ? gutter : element});
        if (prevented) event.preventDefault();
        host.dispatchEvent(event);
        return event;
    };
    return {calls, send, dispose, handedOff, gutter, released: () => released};
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


test("selected gutter taps retain native behavior but dragging starts a new margin selection", () => {
    const {calls, send} = fixture(true, true);
    assert.equal(send("touchstart", 20, true).defaultPrevented, false);
    assert.equal(send("touchend", 20, true).defaultPrevented, false);
    assert.deepEqual(calls, []);
    send("touchstart", 20, true);
    assert.equal(send("touchmove", 20, true, 45).defaultPrevented, true);
    send("touchend", 20, true, 45);
    assert.deepEqual(calls, ["mousedown", "mousemove", "mouseup"]);
});

test("unselected gutter and pending cancellation do not forward mouse events", () => {
    const plain = fixture();
    plain.send("touchstart", 20, true);
    plain.send("touchmove", 20, true, 45);
    plain.send("touchend", 20, true, 45);
    assert.deepEqual(plain.calls, []);
    const selected = fixture(true, true);
    selected.send("touchstart", 20, true);
    selected.send("touchcancel", 20, true);
    selected.send("touchmove", 20, true, 45);
    assert.deepEqual(selected.calls, []);
});


test("gutter long presses and multiple touches retain native dragging", () => {
    const longPress = fixture(true, true);
    longPress.send("touchstart", 20, true);
    assert.equal(longPress.send("touchmove", 20, true, 45, 500).defaultPrevented, false);
    longPress.send("touchend", 20, true, 45, 520);
    assert.deepEqual(longPress.calls, []);
    const multiple = fixture(true, true);
    multiple.send("touchstart", 20, true);
    multiple.send("touchmove", 20, true, 45, 10, 2);
    multiple.send("touchend", 20, true, 45, 20);
    assert.deepEqual(multiple.calls, []);
});

test("disposing the host ends active selection and removes its listeners", () => {
    const {calls, send, dispose} = fixture(true, true);
    send("touchstart", 20, true);
    send("touchmove", 20, true, 45);
    dispose();
    send("touchstart", 20);
    send("touchmove", 20, false, 80);
    send("touchend", 20);
    assert.deepEqual(calls, ["mousedown", "mousemove", "mouseup"]);
});


test("gutter selection requests a same-target handoff and yields to an active drag", () => {
    const active = fixture(true, true, false);
    active.send("touchstart", 20, true);
    assert.equal(active.send("touchmove", 20, true, 45).defaultPrevented, false);
    active.send("touchend", 20, true, 45);
    assert.deepEqual(active.handedOff, [active.gutter]);
    assert.deepEqual(active.calls, []);
    const candidate = fixture(true, true);
    candidate.send("touchstart", 20, true);
    candidate.send("touchmove", 20, true, 45);
    candidate.send("touchmove", 25, true, 60);
    candidate.send("touchcancel", 25, true, 60);
    assert.deepEqual(candidate.handedOff, [candidate.gutter]);
    assert.equal(candidate.released(), 1);
    assert.deepEqual(candidate.calls, ["mousedown", "mousemove", "mousemove", "mouseup"]);
});


test("a move claimed by another control does not take over its gutter gesture", () => {
    const {calls, send, handedOff} = fixture(true, true);
    send("touchstart", 20, true);
    send("touchmove", 20, true, 45, 10, 1, true);
    send("touchend", 20, true, 45);
    assert.deepEqual(handedOff, []);
    assert.deepEqual(calls, []);
});

test("disposing a pending gutter gesture releases only its own drag candidate", () => {
    const {calls, send, handedOff, gutter, dispose} = fixture(true, true);
    send("touchstart", 20, true);
    dispose();
    send("touchmove", 20, true, 45);
    assert.deepEqual(handedOff, [gutter]);
    assert.deepEqual(calls, []);
});
