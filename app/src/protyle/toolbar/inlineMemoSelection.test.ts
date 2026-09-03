import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    getFirstSelectedInlineMemoContent,
    isExactInlineMemoSelection,
    setInlineMemoContentIfMissing
} from "./inlineMemoSelection";

const element = (type: string | null, content?: string, parentElement: HTMLElement | null = null) => {
    const attributes = new Map<string, string>();
    if (type !== null) {
        attributes.set("data-type", type);
    }
    if (content !== undefined) {
        attributes.set("data-inline-memo-content", content);
    }
    return {
        nodeType: 1,
        tagName: "SPAN",
        parentElement,
        classList: {contains: () => false},
        getAttribute: (name: string) => attributes.get(name) ?? null,
        hasAttribute: (name: string) => attributes.has(name),
        setAttribute: (name: string, value: string) => attributes.set(name, value),
    } as unknown as HTMLElement;
};

const text = (parentElement: HTMLElement) => ({
    nodeType: 3,
    parentElement,
}) as unknown as Text;

const range = (startContainer: Node, clonedMemoElement?: HTMLElement) => ({
    startContainer,
    cloneContents: () => ({
        querySelector: () => clonedMemoElement || null,
    }),
}) as unknown as Range;

describe("getFirstSelectedInlineMemoContent", () => {
    it("uses the memo containing the selection start", () => {
        const memoElement = element("inline-memo", "first");

        assert.equal(getFirstSelectedInlineMemoContent(range(text(memoElement), element("inline-memo", "second"))),
            "first");
    });

    it("uses the first memo cloned from a selection that starts outside a memo", () => {
        const normalElement = element(null);
        const memoElement = element("inline-memo", "selected");

        assert.equal(getFirstSelectedInlineMemoContent(range(text(normalElement), memoElement)), "selected");
    });

    it("preserves an explicitly empty memo value", () => {
        const memoElement = element("inline-memo", "");

        assert.equal(getFirstSelectedInlineMemoContent(range(text(memoElement))), "");
    });

    it("returns undefined when the selection contains no memo", () => {
        assert.equal(getFirstSelectedInlineMemoContent(range(text(element(null)))), undefined);
    });
});

describe("setInlineMemoContentIfMissing", () => {
    it("sets the selected memo content on a new memo element", () => {
        const memoElement = element("inline-memo");

        setInlineMemoContentIfMissing(memoElement, "selected");

        assert.equal(memoElement.getAttribute("data-inline-memo-content"), "selected");
    });

    it("preserves the content of an existing memo element", () => {
        const memoElement = element("inline-memo", "existing");

        setInlineMemoContentIfMissing(memoElement, "selected");

        assert.equal(memoElement.getAttribute("data-inline-memo-content"), "existing");
    });

    it("does not add an attribute when the selection contains no memo", () => {
        const memoElement = element("inline-memo");

        setInlineMemoContentIfMissing(memoElement);

        assert.equal(memoElement.hasAttribute("data-inline-memo-content"), false);
    });
});

describe("isExactInlineMemoSelection", () => {
    it("recognizes matching selection boundaries", () => {
        const selectedRange = {} as Range;
        const memoRange = {selectNodeContents: (): void => undefined} as unknown as Range;
        const memoElement = element("inline-memo", "111");
        Object.defineProperty(memoElement, "ownerDocument", {value: {createRange: () => memoRange}});

        assert.equal(isExactInlineMemoSelection(selectedRange, memoElement, currentRange =>
            currentRange === selectedRange ? {start: 3, end: 6} : {start: 3, end: 6}), true);
    });

    it("does not compare equal text selected from different boundaries", () => {
        const selectedRange = {} as Range;
        const memoRange = {selectNodeContents: (): void => undefined} as unknown as Range;
        const memoElement = element("inline-memo", "111");
        Object.defineProperty(memoElement, "ownerDocument", {value: {createRange: () => memoRange}});

        assert.equal(isExactInlineMemoSelection(selectedRange, memoElement, currentRange =>
            currentRange === selectedRange ? {start: 4, end: 7} : {start: 3, end: 6}), false);
    });
});
