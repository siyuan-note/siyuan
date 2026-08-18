import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {selectTextToEditorBoundary} from "./selectionBoundary";

class TestElement {
    public childNodes: TestElement[] = [];

    append(...nodes: TestElement[]) {
        this.childNodes.push(...nodes);
        return this;
    }

    contains(node: TestElement): boolean {
        return this.childNodes.some(child => child === node || child.contains(node));
    }
}

const createSelection = (anchorNode: TestElement, anchorOffset: number) => {
    const selectedRange = {} as Range;
    let call: [Node, number, Node, number] | undefined;
    const selection = {
        anchorNode: anchorNode as unknown as Node,
        anchorOffset,
        rangeCount: 1,
        setBaseAndExtent: (...args: [Node, number, Node, number]) => {
            call = args;
        },
        getRangeAt: () => selectedRange,
    } as unknown as Selection;
    return {
        selection,
        selectedRange,
        getCall: () => call,
    };
};

describe("selectTextToEditorBoundary", () => {
    it("preserves the anchor and extends the focus to the editor start", () => {
        const anchorNode = new TestElement();
        const editorElement = new TestElement().append(anchorNode, new TestElement());
        const selection = createSelection(anchorNode, 2);

        const range = selectTextToEditorBoundary(editorElement as unknown as HTMLElement, true,
            selection.selection);

        assert.equal(range, selection.selectedRange);
        assert.deepEqual(selection.getCall(), [anchorNode, 2, editorElement, 0]);
    });

    it("preserves the anchor and extends the focus to the editor end", () => {
        const anchorNode = new TestElement();
        const editorElement = new TestElement().append(new TestElement(), anchorNode, new TestElement());
        const selection = createSelection(anchorNode, 1);

        selectTextToEditorBoundary(editorElement as unknown as HTMLElement, false, selection.selection);

        assert.deepEqual(selection.getCall(), [anchorNode, 1, editorElement, 3]);
    });

    it("does not change a selection whose anchor is outside the editor", () => {
        const editorElement = new TestElement().append(new TestElement());
        const selection = createSelection(new TestElement(), 0);

        const range = selectTextToEditorBoundary(editorElement as unknown as HTMLElement, true,
            selection.selection);

        assert.equal(range, undefined);
        assert.equal(selection.getCall(), undefined);
    });
});
