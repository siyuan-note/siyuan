import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    createNewFileSelectionContext,
    isNewFileSelectionValid,
    isRangeInEditor,
    isSameBlockRange,
    isSameRange,
    NewFileSelectionContext
} from "./newFileSelection";

class TestElement {
    nodeType = 1;
    tagName = "DIV";
    parentElement: TestElement | null = null;
    isConnected = true;
    private attributes = new Map<string, string>();
    private children: Array<TestElement | TestText> = [];
    classList = {
        contains: (name: string) => name === "protyle-wysiwyg" && this.attributes.get("class") === name,
    };

    constructor(id?: string, type?: string) {
        if (id) {
            this.attributes.set("data-node-id", id);
        }
        if (type) {
            this.attributes.set("data-type", type);
        }
    }

    append(...children: Array<TestElement | TestText>) {
        children.forEach(child => {
            child.parentElement = this;
            this.children.push(child);
        });
        return this;
    }

    setEditor() {
        this.attributes.set("class", "protyle-wysiwyg");
        return this;
    }

    getAttribute(name: string) {
        return this.attributes.get(name) || null;
    }

    hasAttribute(name: string) {
        return this.attributes.has(name);
    }

    contains(node: TestElement | TestText) {
        let current: TestElement | TestText | null = node;
        while (current) {
            if (current === this) {
                return true;
            }
            current = current.parentElement;
        }
        return false;
    }
}

class TestText {
    nodeType = 3;
    parentElement: TestElement | null = null;
    isConnected = true;
}

const asNode = (node: TestElement | TestText) => node as unknown as Node;
const asElement = (element: TestElement) => element as unknown as Element;

const createRange = (start: TestText, end: TestText, text = "selected") => ({
    startContainer: asNode(start),
    startOffset: 0,
    endContainer: asNode(end),
    endOffset: text.length,
    toString: () => text,
    cloneRange: () => createRange(start, end, text),
}) as unknown as Range;

const createFixture = () => {
    const startText = new TestText();
    const endText = new TestText();
    const startBlock = new TestElement("start", "NodeParagraph").append(startText);
    const endBlock = new TestElement("end", "NodeParagraph").append(endText);
    const editor = new TestElement().setEditor().append(startBlock, endBlock);
    const range = createRange(startText, endText);
    const context: NewFileSelectionContext = {
        range,
        notebookId: "notebook",
        rootID: "root",
        path: "/root.sy",
        startBlockID: "start",
        endBlockID: "end",
        text: "selected",
    };
    const protyle = {
        notebookId: "notebook",
        block: {rootID: "root"},
        path: "/root.sy",
        wysiwyg: {element: asElement(editor)},
    } as IProtyle;
    return {context, editor, endText, protyle, range, startText};
};

describe("new document selection context", () => {
    it("captures the selected document and block boundaries", () => {
        const {protyle, range} = createFixture();
        const undoContext = {undoFocusId: "start", undoFocusStart: "8"};

        const context = createNewFileSelectionContext(protyle, range, undoContext);

        assert.notEqual(context?.range, range);
        assert.equal(context?.notebookId, "notebook");
        assert.equal(context?.rootID, "root");
        assert.equal(context?.path, "/root.sy");
        assert.equal(context?.startBlockID, "start");
        assert.equal(context?.endBlockID, "end");
        assert.equal(context?.text, "selected");
        assert.equal(context?.undoContext, undoContext);
    });

    it("keeps a connected selection in the original document valid", () => {
        const {context, protyle} = createFixture();

        assert.equal(isNewFileSelectionValid(protyle, context), true);
    });

    it("rejects detached or changed selections", () => {
        const {context, protyle, startText} = createFixture();
        startText.isConnected = false;
        assert.equal(isNewFileSelectionValid(protyle, context), false);

        const changed = createFixture();
        changed.context.range = createRange(changed.startText, changed.endText, "changed");
        assert.equal(isNewFileSelectionValid(changed.protyle, changed.context), false);
    });

    it("rejects a selection after navigating to another document", () => {
        const {context, protyle} = createFixture();
        protyle.block.rootID = "another-root";

        assert.equal(isNewFileSelectionValid(protyle, context), false);
    });

    it("distinguishes the saved selection from a moved caret", () => {
        const {editor, range, startText} = createFixture();
        const movedRange = createRange(startText, startText, "");

        assert.equal(isSameRange(range, range), true);
        assert.equal(isSameRange(range, movedRange), false);
        assert.equal(isRangeInEditor(asElement(editor), movedRange), true);
    });

    it("distinguishes single-block and cross-block selections", () => {
        const {range, startText} = createFixture();

        assert.equal(isSameBlockRange(createRange(startText, startText)), true);
        assert.equal(isSameBlockRange(range), false);
        assert.equal(isSameBlockRange(createRange(new TestText(), startText)), false);
    });
});
