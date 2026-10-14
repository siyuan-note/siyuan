import * as assert from "node:assert/strict";
import {test} from "node:test";
import {bindGutterPointerLeave} from "./gutterPointerLeave";

const fixture = (ios = true) => {
    const timers = new Map<number, () => void>();
    const ownerDocument = new EventTarget();
    Object.assign(ownerDocument, {defaultView: {
        setTimeout: (callback: () => void) => { timers.set(1, callback); return 1; },
        clearTimeout: (id: number) => timers.delete(id),
    }});
    const body = Object.assign(new EventTarget(), {ownerDocument});
    let hidden = 0;
    bindGutterPointerLeave(body as unknown as HTMLElement, () => hidden++, ios);
    const send = (type: string, pointerType: string, x = -1, y = -1) => {
        const event = new Event(type);
        Object.defineProperties(event, {pointerType: {value: pointerType}, clientX: {value: x}, clientY: {value: y}});
        (type === "pointerdown" ? ownerDocument : body).dispatchEvent(event);
    };
    return {send, hidden: () => hidden, flush: () => { timers.forEach(callback => callback()); timers.clear(); }};
};

test("iPad mouse leave followed by touch down preserves the gutter hit target", () => {
    const f = fixture();
    f.send("pointerleave", "mouse");
    assert.equal(f.hidden(), 0);
    f.send("pointerdown", "touch", 361.5, 257.5);
    f.send("pointerleave", "touch", 361.5, 257.5);
    f.flush();
    assert.equal(f.hidden(), 0);
});

test("a genuine iPad pointer exit clears the gutter after the transition interval", () => {
    const f = fixture();
    f.send("pointerleave", "mouse");
    f.flush();
    assert.equal(f.hidden(), 1);
});

test("pointer reentry cancels a pending clear before another hover target is shown", () => {
    const f = fixture();
    f.send("pointerleave", "mouse");
    f.send("pointerenter", "mouse", 100, 200);
    f.flush();
    assert.equal(f.hidden(), 0);
});

test("positioned mouse exits and desktop exits retain immediate cleanup", () => {
    for (const [ios, x, y] of [[true, 0, 200], [false, -1, -1]] as const) {
        const f = fixture(ios);
        f.send("pointerleave", "mouse", x, y);
        assert.equal(f.hidden(), 1);
    }
});
