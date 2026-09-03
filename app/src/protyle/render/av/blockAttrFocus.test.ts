import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getAVAttributeEditorRange, restoreAVAttributeEditorRange} from "./blockAttrFocus";

class TestElement {
    public readonly nodeType = 1;
    public isConnected = true;
    public focused = false;

    constructor(public parentElement: TestElement | null = null, public editable = false) {
    }

    public closest(): TestElement | null {
        return this.editable ? this : this.parentElement?.closest() || null;
    }

    public contains(node: TestElement | TestText | null) {
        let element = node?.nodeType === 1 ? node as TestElement : node?.parentElement;
        while (element) {
            if (element === this) {
                return true;
            }
            element = element.parentElement;
        }
        return false;
    }

    public focus() {
        this.focused = true;
    }
}

class TestText {
    public readonly nodeType = 3;
    public isConnected = true;

    constructor(public parentElement: TestElement) {
    }
}

const createRange = (container: TestElement | TestText) => {
    const range = {
        startContainer: container,
        endContainer: container,
        cloneRange: () => clone,
    };
    const clone = {...range} as unknown as Range;
    return range as unknown as Range;
};

const createSelection = () => {
    const state = {removed: false, range: undefined as Range | undefined};
    return {
        state,
        selection: {
            removeAllRanges() {
                state.removed = true;
            },
            addRange(range: Range) {
                state.range = range;
            },
        } as Selection,
    };
};

describe("database attribute editor focus", () => {
    it("prefers the current editor range", () => {
        const editor = new TestElement();
        const editable = new TestElement(editor, true);
        const currentRange = createRange(new TestText(editable));
        const savedRange = createRange(new TestText(editable));

        const range = getAVAttributeEditorRange(editor as unknown as HTMLElement, currentRange, savedRange);

        assert.equal(range, currentRange.cloneRange());
    });

    it("falls back to the saved editor range", () => {
        const editor = new TestElement();
        const editable = new TestElement(editor, true);
        const outside = new TestElement();
        const savedRange = createRange(new TestText(editable));

        const range = getAVAttributeEditorRange(editor as unknown as HTMLElement,
            createRange(new TestText(outside)), savedRange);

        assert.equal(range, savedRange.cloneRange());
    });

    it("restores the range and focuses its editable element", () => {
        const editor = new TestElement();
        const editable = new TestElement(editor, true);
        const range = createRange(new TestText(editable));
        const {selection, state} = createSelection();

        const restored = restoreAVAttributeEditorRange(editor as unknown as HTMLElement, range, selection);

        assert.equal(restored, true);
        assert.equal(editable.focused, true);
        assert.equal(state.removed, true);
        assert.equal(state.range, range);
    });

    it("ignores a disconnected saved range", () => {
        const editor = new TestElement();
        const editable = new TestElement(editor, true);
        const text = new TestText(editable);
        text.isConnected = false;
        const {selection, state} = createSelection();

        const restored = restoreAVAttributeEditorRange(editor as unknown as HTMLElement,
            createRange(text), selection);

        assert.equal(restored, false);
        assert.equal(editable.focused, false);
        assert.equal(state.removed, false);
    });
});
