import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    captureUploadDocument, createUploadInsertPosition, getAvailableUploadInsertRange,
    isUploadDocumentAvailable, isUploadInsertPositionAvailable,
} from "./insertPosition";

class TestElement {
    public isConnected = true;
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
    it("keeps the original range instead of consulting a later selection", () => {
        const original = new TestElement();
        const later = new TestElement();
        const editor = new TestElement().append(original, later);
        const position = createUploadInsertPosition(createRange(original));
        const result = getAvailableUploadInsertRange(editor as unknown as Element, position, () => {
            assert.fail("an available position must not be restored from the current selection");
        });
        assert.equal(result.startContainer, original);
        editor.children = [later];
        assert.equal(getAvailableUploadInsertRange(editor as unknown as Element, position), undefined);
        position.context = {undoFocusId: "original"};
        assert.equal(getAvailableUploadInsertRange(editor as unknown as Element, position, () => undefined), undefined);
        assert.equal(getAvailableUploadInsertRange(editor as unknown as Element), undefined);
    });

    it("restores a rebuilt original target only when restoration succeeds", () => {
        const old = new TestElement();
        const rebuilt = new TestElement();
        const editor = new TestElement().append(rebuilt);
        const position = createUploadInsertPosition(createRange(old), {undoFocusId: "original"});
        const result = getAvailableUploadInsertRange(editor as unknown as Element, position, context => {
            assert.equal(context.undoFocusId, "original");
            return createRange(rebuilt);
        });
        assert.equal(result.startContainer, rebuilt);
        editor.isConnected = false;
        assert.equal(getAvailableUploadInsertRange(editor as unknown as Element, position, () => {
            assert.fail("a detached editor cannot restore the target");
        }), undefined);
    });

    it("rejects a reused editor after its document or notebook changes", () => {
        const protyle = {element: new TestElement(), block: {rootID: "doc-a"}, notebookId: "box-a"} as unknown as IProtyle;
        const target = captureUploadDocument(protyle);
        assert.equal(isUploadDocumentAvailable(protyle, target), true);
        protyle.block.rootID = "doc-b";
        assert.equal(isUploadDocumentAvailable(protyle, target), false);
        assert.equal(target.rootID, "doc-a");
        protyle.block.rootID = "doc-a";
        protyle.notebookId = "box-b";
        assert.equal(isUploadDocumentAvailable(protyle, target), false);
        protyle.notebookId = "box-a";
        assert.equal(isUploadDocumentAvailable(protyle, target), true);
        (protyle.element as unknown as TestElement).isConnected = false;
        assert.equal(isUploadDocumentAvailable(protyle, target), false);
    });

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

    it("rejects a position after the editor is detached", () => {
        const target = new TestElement();
        const editor = new TestElement().append(target);
        const position = createUploadInsertPosition(createRange(target));
        editor.isConnected = false;

        assert.equal(isUploadInsertPositionAvailable(editor as unknown as Element, position), false);
    });
});
