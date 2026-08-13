import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {createUploadInsertPosition, isUploadInsertPositionAvailable} from "./insertPosition";

class TestElement {
    public parent?: TestElement;
    public children: TestElement[] = [];

    append(...children: TestElement[]) {
        children.forEach(child => {
            child.parent = this;
            this.children.push(child);
        });
        return this;
    }

    contains(node: TestElement): boolean {
        return node === this || this.children.some(child => child.contains(node));
    }
}

const createRange = (startContainer: TestElement, endContainer = startContainer) => {
    const range = {
        startContainer: startContainer as unknown as Node,
        endContainer: endContainer as unknown as Node,
        cloneRange() {
            return createRange(this.startContainer as unknown as TestElement,
                this.endContainer as unknown as TestElement);
        },
    } as unknown as Range;
    return range;
};

describe("upload insert position", () => {
    it("keeps an independent range snapshot", () => {
        const source = new TestElement();
        const range = createRange(source);
        const position = createUploadInsertPosition(range, {undoFocusId: "target"});

        assert.notEqual(position.range, range);
        assert.equal(position.startContainer, source);
        assert.deepEqual(position.context, {undoFocusId: "target"});
    });

    it("uses the live range while its original boundaries remain in the editor", () => {
        const start = new TestElement();
        const end = new TestElement();
        const editor = new TestElement().append(start, end);
        const position = createUploadInsertPosition(createRange(start, end));

        assert.equal(isUploadInsertPositionAvailable(editor as unknown as Element, position), true);
    });

    it("rejects a rehomed range after its original boundary is replaced", () => {
        const original = new TestElement();
        const replacement = new TestElement();
        const editor = new TestElement().append(original);
        const position = createUploadInsertPosition(createRange(original));
        editor.children = [replacement];
        replacement.parent = editor;
        (position.range as unknown as {startContainer: Node; endContainer: Node}).startContainer =
            editor as unknown as Node;
        (position.range as unknown as {startContainer: Node; endContainer: Node}).endContainer =
            editor as unknown as Node;

        assert.equal(isUploadInsertPositionAvailable(editor as unknown as Element, position), false);
    });
});
