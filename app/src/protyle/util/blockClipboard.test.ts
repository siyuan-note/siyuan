import {afterEach, describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {copyBlockSelection} from "./blockClipboard";

const globals = new Map(["navigator", "document", "window"].map(key =>
    [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
afterEach(() => globals.forEach((descriptor, key) => {
    if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor);
    } else {
        Reflect.deleteProperty(globalThis, key);
    }
}));

const setup = (platform = "MacIntel", maxTouchPoints = 5) => {
    const savedRange = {collapsed: true, startContainer: {isConnected: true}, endContainer: {isConnected: true}};
    let currentRange: unknown = savedRange;
    let selected: unknown;
    let focused = false;
    const editable = {focus: () => { focused = true; currentRange = null; }};
    const element = {matches: () => false, querySelector: () => editable};
    const copyRange = {selectNodeContents: (target: unknown) => { selected = target; }};
    Object.defineProperty(globalThis, "navigator", {configurable: true, value: {
        userAgent: platform === "iPhone" ? "iPhone" : "Mozilla/5.0 (Macintosh)", platform, maxTouchPoints,
    }});
    Object.assign(globalThis, {
        document: {createRange: () => copyRange},
        window: {getSelection: () => ({
            rangeCount: 1,
            getRangeAt: () => ({cloneRange: () => savedRange}),
            removeAllRanges: () => { currentRange = null; },
            addRange: (range: unknown) => { currentRange = range; },
        })},
    });
    return {element: element as unknown as Element, editable, savedRange, copyRange,
        current: () => currentRange, selected: () => selected, focused: () => focused};
};

describe("block menu clipboard selection", () => {
    for (const platform of ["MacIntel", "iPhone"]) {
        it(`creates a native selection for block copy on ${platform} and restores the cursor`, () => {
            const state = setup(platform);
            let copied = false;
            copyBlockSelection(state.element, () => {
                assert.equal(state.focused(), true);
                assert.equal(state.current(), state.copyRange);
                assert.equal(state.selected(), state.editable);
                copied = true;
            });
            assert.equal(copied, true);
            assert.equal(state.current(), state.savedRange);
        });
    }

    it("restores the cursor when copying throws", () => {
        const state = setup();
        assert.throws(() => copyBlockSelection(state.element, () => { throw new Error("copy failed"); }), /copy failed/);
        assert.equal(state.current(), state.savedRange);
    });

    it("does not restore a selection whose source was removed", () => {
        const state = setup();
        copyBlockSelection(state.element, () => { state.savedRange.startContainer.isConnected = false; });
        assert.equal(state.current(), null);
    });

    it("preserves desktop selection behavior", () => {
        const state = setup("MacIntel", 0);
        copyBlockSelection(state.element, () => assert.equal(state.current(), state.savedRange));
        assert.equal(state.focused(), false);
        assert.equal(state.current(), state.savedRange);
    });
});
