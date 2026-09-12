import * as assert from "node:assert/strict";
import {test} from "node:test";
import {bindMobileToolbar} from "./mobileToolbar";

test("mobile fragment toolbar follows its own selection and cleans up pending rendering", () => {
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
    const events = new EventTarget();
    const frames = new Map<number, FrameRequestCallback>();
    let frameID = 0;
    const root = {};
    const ownNode = {nodeType: 1, closest: () => root};
    const foreignNode = {nodeType: 1, closest: () => ({})};
    let range = {startContainer: ownNode, endContainer: ownNode};
    let collapsed = false;
    let panelFocused = false;
    let renders = 0;
    const classes = new Set<string>();
    const element = Object.assign(new EventTarget(), {
        classList: classes,
        style: {},
        setAttribute: () => {},
    });
    const protyle = {
        wysiwyg: {element: root},
        toolbar: {
            element,
            subElement: {contains: () => panelFocused},
            render: (owner: unknown, selectedRange: unknown) => {
                assert.equal(owner, protyle);
                assert.equal(selectedRange, range);
                renders++;
                classes.delete("fn__none");
            },
        },
    } as unknown as IProtyle;
    Object.defineProperty(globalThis, "document", {configurable: true, value: events});
    Object.defineProperty(globalThis, "window", {configurable: true, value: {
        requestAnimationFrame: (callback: FrameRequestCallback) => {
            frames.set(++frameID, callback);
            return frameID;
        },
        cancelAnimationFrame: (id: number) => frames.delete(id),
        getSelection: () => ({rangeCount: 1, isCollapsed: collapsed, getRangeAt: () => range}),
    }});
    const flush = () => {
        const callbacks = Array.from(frames.values());
        frames.clear();
        callbacks.forEach(callback => callback(0));
    };
    let cleanup: () => void;
    try {
        cleanup = bindMobileToolbar(protyle);
        events.dispatchEvent(new Event("selectionchange"));
        events.dispatchEvent(new Event("selectionchange"));
        assert.equal(frames.size, 1);
        flush();
        assert.equal(renders, 1);

        range = {startContainer: ownNode, endContainer: foreignNode};
        events.dispatchEvent(new Event("selectionchange"));
        flush();
        assert.equal(renders, 1);
        assert.ok(classes.has("fn__none"));

        range = {startContainer: ownNode, endContainer: ownNode};
        collapsed = true;
        events.dispatchEvent(new Event("selectionchange"));
        flush();
        assert.equal(renders, 1);

        panelFocused = true;
        classes.delete("fn__none");
        events.dispatchEvent(new Event("selectionchange"));
        flush();
        assert.ok(!classes.has("fn__none"));

        const pointer = new Event("mousedown", {cancelable: true});
        element.dispatchEvent(pointer);
        assert.ok(pointer.defaultPrevented);

        events.dispatchEvent(new Event("selectionchange"));
        cleanup();
        assert.equal(frames.size, 0);
        events.dispatchEvent(new Event("selectionchange"));
        assert.equal(frames.size, 0);
    } finally {
        cleanup?.();
        if (originalWindow) {
            Object.defineProperty(globalThis, "window", originalWindow);
        } else {
            Reflect.deleteProperty(globalThis, "window");
        }
        if (originalDocument) {
            Object.defineProperty(globalThis, "document", originalDocument);
        } else {
            Reflect.deleteProperty(globalThis, "document");
        }
    }
});
