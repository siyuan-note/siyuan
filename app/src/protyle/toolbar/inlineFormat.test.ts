import {before, describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getRangeInlineFormats, getRangesInlineFormats, INLINE_FORMAT_TYPES} from "./inlineFormat";

before(() => {
    Object.assign(globalThis, {Node: {TEXT_NODE: 3}, NodeFilter: {SHOW_TEXT: 4}});
});

const selection = (segments: {text: string, types?: string, outerTypes?: string}[],
                   startOffset = 0, endOffset?: number) => {
    const editableElement = {getAttribute: (): string | null => null} as unknown as Element;
    const nodes = segments.map(segment => {
        const parent = {
            tagName: "SPAN",
            getAttribute: () => segment.types || null,
            parentElement: segment.outerTypes ? {
                getAttribute: () => segment.outerTypes,
                parentElement: editableElement,
            } : editableElement,
            closest() {
                return this;
            },
        } as unknown as Element;
        const node = {
            nodeType: 3,
            data: segment.text,
            textContent: segment.text,
            parentElement: parent,
        } as unknown as Text;
        Object.assign(parent, {childNodes: [node]});
        return node;
    });
    Object.assign(editableElement, {
        ownerDocument: {
            createTreeWalker() {
                let index = 0;
                return {nextNode: () => nodes[index++]};
            },
        },
    });
    const range = {
        startContainer: nodes[0],
        startOffset,
        endContainer: nodes[nodes.length - 1],
        endOffset: endOffset ?? nodes[nodes.length - 1]?.data.length ?? 0,
        intersectsNode: () => true,
    } as unknown as Range;
    return {editableElement, range};
};

const formats = (selected: ReturnType<typeof selection>) =>
    getRangeInlineFormats(selected.editableElement, selected.range);

describe("inline format selection coverage", () => {
    INLINE_FORMAT_TYPES.forEach(type => {
        it(`adds ${type} when extending formatted text on either side`, () => {
            const marked = {text: "marked", types: type};
            const plain = {text: "plain"};
            assert.deepEqual(formats(selection([plain, marked, plain])), []);
            assert.deepEqual(formats(selection([marked, plain])), []);
            assert.deepEqual(formats(selection([plain, marked])), []);
        });

        it(`removes ${type} only when every selected segment has it`, () => {
            assert.deepEqual(formats(selection([
                {text: "first", types: type},
                {text: "second", types: `${type} text a`},
            ], 2, 3)), [type]);
        });
    });

    it("checks common formats independently and includes inherited marks", () => {
        assert.deepEqual(formats(selection([
            {text: "first", types: "em", outerTypes: "strong"},
            {text: "second", types: "strong u"},
        ])), ["strong"]);
    });

    it("does not count unselected text at either boundary", () => {
        assert.deepEqual(formats(selection([
            {text: "before"}, {text: "selected", types: "strong"}, {text: "after"},
        ], 6, 0)), ["strong"]);
    });

    it("ignores text nodes outside the range and formatting on the editable root", () => {
        const selected = selection([{text: "outside"}, {text: "bold", types: "strong"}]);
        selected.range.intersectsNode = node => node === selected.range.endContainer;
        assert.deepEqual(formats(selected), ["strong"]);
        const plain = selection([{text: "plain"}]);
        plain.editableElement.getAttribute = () => "strong";
        assert.deepEqual(formats(plain), []);
    });

    it("ignores zero-width boundaries and supported internal placeholders", () => {
        assert.deepEqual(formats(selection([
            {text: "\u200b"},
            {text: "\u2060value", types: "strong code"},
            {text: "\u200b\ufeff", types: "kbd"},
            {text: "\u200b"},
        ])), ["strong", "code"]);
    });

    it("keeps ordinary selected whitespace in the coverage check", () => {
        assert.deepEqual(formats(selection([{text: "bold", types: "strong"}, {text: " "}])), []);
    });

    it("ignores image helper text but checks text in semantic elements", () => {
        assert.deepEqual(formats(selection([
            {text: "bold", types: "strong"}, {text: "caption", outerTypes: "img"},
        ])), ["strong"]);
        ["a", "block-ref", "tag", "inline-memo", "inline-math"].forEach(type => {
            assert.deepEqual(formats(selection([
                {text: "bold", types: "strong"}, {text: "value", types: type},
            ])), []);
        });
    });

    it("does not infer formats from empty or collapsed text selections", () => {
        assert.equal(formats(selection([{text: "bold", types: "strong"}], 2, 2)), undefined);
        assert.equal(formats(selection([{text: "\u200b", types: "strong"}])), undefined);
        assert.deepEqual(getRangesInlineFormats([]), []);
    });

    it("requires coverage across every nonempty block or table cell", () => {
        const first = selection([{text: "first", types: "strong em"}]);
        const second = selection([{text: "second", types: "strong"}]);
        const empty = selection([{text: "\u200b"}]);
        assert.deepEqual(getRangesInlineFormats([first, empty, second]), ["strong"]);
        const mixed = selection([{text: "bold", types: "strong"}, {text: "plain"}]);
        assert.deepEqual(getRangesInlineFormats([first, mixed]), []);
        assert.deepEqual(getRangesInlineFormats([mixed, first]), []);
    });
});
