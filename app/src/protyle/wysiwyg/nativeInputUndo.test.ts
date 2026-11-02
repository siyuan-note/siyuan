import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {recordNativeInputUndo} from "./nativeInputUndo";

const setup = (type = "NodeParagraph") => {
    const block = {
        nodeType: 1,
        tagName: "DIV",
        classList: {contains: () => false},
        hasAttribute: (name: string) => name === "data-node-id",
        getAttribute: (name: string) => name === "data-node-id" ? "block" : type,
        outerHTML: `<div data-node-id="block" data-type="${type}"><div contenteditable="true"><strong>beautful</strong></div></div>`,
    };
    const text = {nodeType: 3, parentElement: block};
    const range = {startContainer: text, endContainer: text};
    const element = {
        contains: (node: unknown) => node === text,
        ownerDocument: {getSelection: () => ({rangeCount: 1, getRangeAt: () => range})},
    } as unknown as HTMLElement;
    const event = {
        inputType: "insertReplacementText",
        getTargetRanges: () => [range],
    } as unknown as InputEvent;
    return {block, element, event};
};

describe("native text input undo", () => {
    it("captures direct text commits without compositionstart after undo clears snapshots", () => {
        for (const type of ["NodeParagraph", "NodeHeading", "NodeTable"]) {
            const {block, element, event} = setup(type);
            const snapshots: {[key: string]: string} = {};
            recordNativeInputUndo({...event, inputType: "insertText"} as InputEvent, element, snapshots);
            assert.equal(snapshots.block, block.outerHTML);
        }
    });

    it("preserves keyboard and composition snapshots for text commits", () => {
        const {element, event} = setup();
        const direct = {...event, inputType: "insertText"} as InputEvent;
        const snapshots = {block: "before typing"};
        recordNativeInputUndo(direct, element, snapshots);
        assert.equal(snapshots.block, "before typing");
        const empty = {};
        recordNativeInputUndo(direct, element, empty, true);
        assert.deepEqual(empty, {});
    });

    it("captures a previously untouched block before replacement, including heading and inline formatting", () => {
        for (const type of ["NodeParagraph", "NodeHeading"]) {
            const {block, element, event} = setup(type);
            const snapshots: {[key: string]: string} = {};
            const original = block.outerHTML;
            recordNativeInputUndo(event, element, snapshots);
            block.outerHTML = original.replace("beautful", "beautiful");
            assert.equal(snapshots.block, original);
        }
    });

    it("refreshes stale snapshots for consecutive corrections", () => {
        const {block, element, event} = setup();
        const snapshots = {block: "stale"};
        recordNativeInputUndo(event, element, snapshots);
        assert.equal(snapshots.block, block.outerHTML);
        block.outerHTML = block.outerHTML.replace("beautful", "beautiful");
        recordNativeInputUndo(event, element, snapshots);
        assert.equal(snapshots.block, block.outerHTML);
    });

    it("uses the replacement target even when the current selection is elsewhere", () => {
        const {block, element, event} = setup();
        element.ownerDocument.getSelection = () => null;
        const snapshots: {[key: string]: string} = {};
        recordNativeInputUndo(event, element, snapshots);
        assert.equal(snapshots.block, block.outerHTML);
    });

    it("falls back to the selection when no target ranges are supplied", () => {
        const {block, element, event} = setup();
        event.getTargetRanges = () => [];
        const snapshots: {[key: string]: string} = {};
        recordNativeInputUndo(event, element, snapshots);
        assert.equal(snapshots.block, block.outerHTML);
    });

    it("ignores canceled, composing, unrelated and outside-editor input", () => {
        for (const overrides of [{defaultPrevented: true}, {isComposing: true}, {inputType: "insertParagraph"},
            {getTargetRanges: () => [{startContainer: {}, endContainer: {}}]}]) {
            const {element, event} = setup();
            const snapshots = {};
            recordNativeInputUndo({...event, ...overrides} as InputEvent, element, snapshots);
            assert.deepEqual(snapshots, {});
        }
    });
});
