import * as assert from "node:assert/strict";
import {test} from "node:test";
import {ScriptTarget} from "typescript";
import {compileModule, evaluateModule} from "../../testSupport/loadModule";

const compiled = compileModule("src/protyle/wysiwyg/blockDragSelectionGesture.ts", ScriptTarget.ES2021);

class Surface {
    listeners = new Map<string, Set<(event: any) => void>>();

    addEventListener(type: string, listener: (event: any) => void) {
        if (!this.listeners.has(type)) {
            this.listeners.set(type, new Set());
        }
        this.listeners.get(type).add(listener);
    }

    removeEventListener(type: string, listener: (event: any) => void) {
        this.listeners.get(type)?.delete(listener);
    }

    send(type: string, properties: Record<string, unknown> = {}) {
        const event = {
            type, clientX: 20, clientY: 20, button: 0, buttons: 1, detail: 1,
            cancelable: true, defaultPrevented: false, stopped: false,
            preventDefault() { this.defaultPrevented = true; },
            stopImmediatePropagation() { this.stopped = true; },
            ...properties,
        };
        for (const listener of Array.from(this.listeners.get(type) || [])) {
            listener(event);
            if (event.stopped) {
                break;
            }
        }
        return event;
    }

    count() {
        return Array.from(this.listeners.values()).reduce((total, listeners) => total + listeners.size, 0);
    }
}

const fixture = (mountScroll = true) => {
    let time = 10000;
    const window = new Surface();
    const document = Object.assign(new Surface(), {defaultView: window});
    const blocks = [{id: "a"}, {id: "b"}, {id: "c"}];
    const element = Object.assign(new Surface(), {ownerDocument: document, contains: (): boolean => true});
    const scrollElement = new Surface();
    let enabled = true;
    const selections: string[][] = [];
    const finishes: boolean[] = [];
    const scrolls: unknown[] = [];
    const exports = evaluateModule<any>(compiled, {Date: {now: () => time}});
    let mountedScrollElement: Surface;
    const dispose = exports.bindBlockDragSelectionGesture(element, () => mountedScrollElement, {
        canStart: () => enabled,
        getStartBlock: (target: object) => blocks.includes(target as typeof blocks[0]) ? target : undefined,
        getBlockAtPoint: (point: {clientY: number}) => blocks[Math.floor(point.clientY / 100)],
        select: (start: typeof blocks[0], end: typeof blocks[0]) => selections.push([start.id, end.id]),
        scroll: (point: unknown) => scrolls.push(point),
        finish: (cancelled: boolean) => finishes.push(cancelled),
    });
    if (mountScroll) {
        mountedScrollElement = scrollElement;
    }
    const mouseDown = (properties = {}) => element.send("mousedown", {target: blocks[0], ...properties});
    const touch = (type: string, y = 20, properties = {}) => {
        const point = {identifier: 1, clientX: 20, clientY: y};
        return (type === "touchmove" ? document : element).send(type, {
            target: blocks[0], touches: type === "touchend" ? [] : [point], changedTouches: [point], ...properties,
        });
    };
    return {
        element, document, window, scrollElement, selections, finishes, scrolls, blocks, dispose, mouseDown, touch,
        advance: (milliseconds: number) => time += milliseconds,
        disable: () => enabled = false,
        mount: () => mountedScrollElement = scrollElement,
    };
};

test("scroll containers can be initialized after binding and disposal before a gesture is safe", () => {
    const unused = fixture(false);
    assert.doesNotThrow(unused.dispose);
    assert.equal(unused.element.count(), 0);
    const mounted = fixture(false);
    mounted.mount();
    mounted.mouseDown();
    assert.equal(mounted.scrollElement.count(), 1);
    mounted.document.send("mouseup");
    assert.equal(mounted.scrollElement.count(), 0);
    mounted.dispose();
});

test("mouse text selection stays native in one block and becomes a reversible whole-block range across blocks", () => {
    const f = fixture();
    f.mouseDown();
    assert.equal(f.document.send("mousemove", {clientY: 50}).defaultPrevented, false);
    assert.deepEqual(f.selections, []);
    assert.equal(f.document.send("mousemove", {clientY: 220}).defaultPrevented, true);
    f.document.send("mousemove", {clientY: 120});
    f.document.send("mousemove", {clientY: 20});
    assert.deepEqual(f.selections, [["a", "c"], ["a", "b"], ["a", "a"]]);
    assert.equal(f.document.send("mouseup").stopped, true);
    assert.deepEqual(f.finishes, [false]);
    assert.equal(f.element.send("click").defaultPrevented, true);
    assert.equal(f.document.count(), 0);
    assert.equal(f.scrollElement.count(), 0);
    assert.equal(f.window.count(), 0);
});

test("new gestures preserve modifier clicks, right clicks, double clicks and handled controls", () => {
    for (const properties of [{ctrlKey: true}, {shiftKey: true}, {metaKey: true}, {altKey: true},
        {button: 2}, {detail: 2}, {defaultPrevented: true}, {target: {}},
        {sourceCapabilities: {firesTouchEvents: true}}]) {
        const f = fixture();
        f.mouseDown(properties);
        f.document.send("mousemove", {clientY: 220});
        assert.deepEqual(f.selections, []);
        assert.equal(f.document.count(), 0);
    }
});

test("touch swipes stay native even after a sustained press and never create a block selection", () => {
    for (const duration of [0, 1600]) {
        const f = fixture();
        assert.equal(f.touch("touchstart").defaultPrevented, false);
        f.advance(duration);
        assert.equal(f.touch("touchmove", 50).defaultPrevented, false);
        f.advance(2000);
        assert.equal(f.touch("touchmove", 220).defaultPrevented, false);
        assert.equal(f.touch("touchend", 220).defaultPrevented, false);
        assert.deepEqual(f.selections, []);
        assert.equal(f.document.count(), 0);
        assert.equal(f.scrollElement.count(), 0);
        assert.deepEqual(f.scrolls, []);
        assert.deepEqual(f.finishes, []);
        assert.equal(f.element.send("click").defaultPrevented, false);
    }
});

test("compatibility mouse events after touch release or cancellation do not start block selection", () => {
    for (const end of ["touchend", "touchcancel"]) {
        const f = fixture();
        f.touch("touchstart");
        f.advance(2000);
        f.touch(end);
        f.mouseDown();
        assert.equal(f.document.count(), 0);
        f.advance(500);
        f.mouseDown();
        f.document.send("mousemove", {clientY: 220});
        assert.deepEqual(f.selections, [["a", "c"]]);
    }
});

test("lost buttons, escape, blur and disposal release mouse gesture listeners", () => {
    for (const end of ["buttons", "escape", "blur", "dispose", "disabled", "detached"]) {
        const f = fixture();
        f.mouseDown();
        f.document.send("mousemove", {clientY: 120});
        if (end === "buttons") {
            f.document.send("mousemove", {buttons: 0});
        } else if (end === "escape") {
            f.document.send("keydown", {key: "Escape"});
        } else if (end === "blur") {
            f.window.send("blur");
        } else if (end === "disabled" || end === "detached") {
            if (end === "disabled") {
                f.disable();
            } else {
                f.element.contains = () => false;
            }
            f.document.send("mousemove", {clientY: 220});
        } else {
            f.dispose();
            assert.equal(f.element.count(), 0);
        }
        assert.equal(f.finishes.length, 1, end);
        assert.equal(f.document.count(), 0, end);
        assert.equal(f.window.count(), 0, end);
        assert.equal(f.scrolls[f.scrolls.length - 1], undefined, end);
    }
});

test("scrolling refreshes the active range and a composition cancels it without consuming IME input", () => {
    const f = fixture();
    f.mouseDown();
    f.document.send("mousemove", {clientY: 120});
    f.scrollElement.send("scroll");
    assert.equal(f.selections.length, 2);
    assert.equal(f.element.send("compositionstart").defaultPrevented, false);
    assert.deepEqual(f.finishes, [true]);
    f.mouseDown();
    assert.equal(f.document.count(), 0);
    f.element.send("compositionend");
    f.mouseDown();
    f.document.send("mousemove", {clientY: 220});
    f.document.send("mouseup");
    assert.deepEqual(f.selections[f.selections.length - 1], ["a", "c"]);
});

test("native drag stays with the browser", () => {
    const f = fixture();
    f.mouseDown();
    assert.equal(f.document.send("dragstart").defaultPrevented, false);
    assert.equal(f.document.count(), 0);
    assert.deepEqual(f.selections, []);
});
