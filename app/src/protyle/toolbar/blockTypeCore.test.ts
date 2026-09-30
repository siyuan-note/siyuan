import * as assert from "node:assert/strict";
import {test} from "node:test";
import {
    captureTextBlockSelection,
    getBlockTypeOptions,
    getTextSelectionBlock,
    ITextBlockContext,
    isSameTextRange,
    isTextBlockSelectionValid,
} from "./blockTypeCore";

class TestElement {
    nodeType = 1;
    isConnected = true;
    parentElement: TestElement;
    children: TestElement[] = [];
    dataset: Record<string, string> = {};
    style = {width: "", flex: ""};
    textContent = "selected words and remaining content";
    editable: string;
    classes = new Set<string>();
    classList = {contains: (name: string) => this.classes.has(name)};
    excluded = false;

    constructor(type?: string) {
        if (type) {
            this.dataset = {nodeId: type, type};
        }
    }

    append(element: TestElement) {
        element.parentElement = this;
        this.children.push(element);
        return element;
    }

    closest(selector: string): TestElement | null {
        const match = selector === ".protyle-wysiwyg" ? this.classes.has("protyle-wysiwyg") :
            selector === "[data-node-id][data-type]" ? !!this.dataset.nodeId && !!this.dataset.type :
                selector === "[contenteditable]" ? this.editable !== undefined : this.excluded;
        return match ? this : this.parentElement?.closest(selector) || null;
    }

    getAttribute(name: string) {
        return name === "contenteditable" ? this.editable : name.startsWith("data-") ?
            this.dataset[name.slice(5).replace(/-([a-z])/g, (_match, char: string) => char.toUpperCase())] || null : null;
    }

    querySelector(selector: string): TestElement | null {
        for (const child of this.children) {
            if (selector === ".protyle-wysiwyg--select" && child.classes.has("protyle-wysiwyg--select")) {
                return child;
            }
            const found = child.querySelector(selector);
            if (found) {
                return found;
            }
        }
        return null;
    }

    querySelectorAll() {
        return this.children.filter(child => child.dataset.nodeId);
    }
}

const asElement = (element: TestElement) => element as unknown as HTMLElement;

const fixture = (type = "NodeParagraph", parentType?: string) => {
    const editor = new TestElement();
    editor.classes.add("protyle-wysiwyg");
    const parent = parentType ? editor.append(new TestElement(parentType)) : editor;
    const block = parent.append(new TestElement(type));
    if (type === "NodeHeading") {
        block.dataset.subtype = "h2";
    }
    const editable = block.append(new TestElement());
    editable.editable = "true";
    const inline = editable.append(new TestElement());
    const start = {nodeType: 3, parentElement: inline, isConnected: true} as unknown as Node;
    const end = {nodeType: 3, parentElement: editable, isConnected: true} as unknown as Node;
    const range = {startContainer: start, endContainer: end, startOffset: 1, endOffset: 5,
        collapsed: false, toString: () => "selected words",
        cloneRange() { return {...this}; },
    } as Range;
    const context: ITextBlockContext = {editor: asElement(editor), range, disabled: false, lite: false};
    return {editor, parent, block, editable, inline, start, end, range, context};
};

test("single text blocks expose explicit targets including structural wrappers", () => {
    for (const type of ["NodeParagraph", "NodeHeading"]) {
        const {context, block} = fixture(type);
        assert.equal(getTextSelectionBlock(context), block);
        const options = getBlockTypeOptions(asElement(block));
        assert.deepEqual(options.map(item => item.key), ["paragraph", "heading1", "heading2", "heading3", "heading4",
            "heading5", "heading6", "list", "orderedList", "check", "quote", "callout"]);
        assert.equal(options.filter(item => item.current).length, 1);
        assert.equal(options.find(item => item.current).key, type === "NodeParagraph" ? "paragraph" : "heading2");
        assert.equal(options.some(item => item.disabled), false);
    }
});

test("nested selections keep their actual child as the conversion target", () => {
    for (const parentType of ["NodeListItem", "NodeBlockquote", "NodeCallout", "NodeTabItem", "NodeSuperBlock"]) {
        const {context, parent, block} = fixture("NodeParagraph", parentType);
        const before = JSON.stringify(parent.dataset);
        assert.equal(getTextSelectionBlock(context), block);
        assert.notEqual(getTextSelectionBlock(context), parent);
        assert.equal(JSON.stringify(parent.dataset), before);
    }
});

test("cross-child selections are rejected even inside the same container", () => {
    for (const type of ["NodeListItem", "NodeBlockquote"]) {
        const {context, parent, range} = fixture("NodeParagraph", type);
        const other = parent.append(new TestElement("NodeParagraph"));
        const editable = other.append(new TestElement());
        editable.editable = "true";
        Object.assign(range, {endContainer: {nodeType: 3, parentElement: editable, isConnected: true}});
        assert.equal(getTextSelectionBlock(context), undefined);
    }
});

test("editable element offsets are accepted while block boundary ranges are rejected", () => {
    const {context, range, editable, block} = fixture();
    Object.assign(range, {startContainer: editable, endContainer: editable});
    assert.equal(getTextSelectionBlock(context), block);
    Object.assign(range, {startContainer: block});
    assert.equal(getTextSelectionBlock(context), undefined);
});

test("empty, collapsed, readonly, lite, image and explicit block selections have no entry", () => {
    for (const value of ["", " \n\t", "\u200b", "\u2060\ufeff"]) {
        const {context, range} = fixture();
        range.toString = () => value;
        assert.equal(getTextSelectionBlock(context), undefined);
    }
    for (const flag of ["disabled", "lite"] as const) {
        const {context} = fixture();
        context[flag] = true;
        assert.equal(getTextSelectionBlock(context), undefined);
    }
    const {context, range, inline, block} = fixture();
    Object.assign(range, {collapsed: true});
    assert.equal(getTextSelectionBlock(context), undefined);
    Object.assign(range, {collapsed: false});
    inline.editable = "false";
    assert.equal(getTextSelectionBlock(context), undefined);
    delete inline.editable;
    block.classes.add("protyle-wysiwyg--select");
    assert.equal(getTextSelectionBlock(context), undefined);
});

test("unsupported sources, table cells, hidden tabs and nested editors cannot convert their parent", () => {
    for (const type of ["NodeCodeBlock", "NodeTable", "NodeCallout", "NodeTabItem", "NodeList", "NodeBlockquote"]) {
        const {context, block} = fixture(type);
        assert.equal(getTextSelectionBlock(context), undefined);
        assert.deepEqual(getBlockTypeOptions(asElement(block)), []);
    }
    const {context, parent, editable} = fixture();
    parent.excluded = true;
    assert.equal(getTextSelectionBlock(context), undefined);
    parent.excluded = false;
    editable.classes.add("protyle-wysiwyg");
    assert.equal(getTextSelectionBlock(context), undefined);
});

test("superblock protection is per operation and preserves safe heading conversion", () => {
    const {parent, block} = fixture("NodeParagraph", "NodeSuperBlock");
    parent.classes.add("sb");
    const disabled = () => getBlockTypeOptions(asElement(block)).filter(option => option.disabled).map(option => option.key);
    assert.deepEqual(disabled(), ["list", "orderedList", "check", "quote", "callout"]);
    parent.append(new TestElement("NodeParagraph"));
    assert.deepEqual(disabled(), []);
    block.style.width = "30%";
    assert.deepEqual(disabled(), ["list", "orderedList", "check", "quote", "callout"]);
});

test("snapshots reject document switches, readonly state and stale or redirected ranges", () => {
    const {context, block, range} = fixture();
    const snapshot = captureTextBlockSelection(context, "document");
    const valid = (root = "document") => isTextBlockSelectionValid(snapshot, context, root);
    assert.equal(valid(), true);
    assert.equal(isSameTextRange(range, snapshot.range), true);
    assert.equal(valid("another-document"), false);
    assert.equal(isTextBlockSelectionValid(snapshot, fixture().context, "document"), false);
    context.disabled = true;
    assert.equal(valid(), false);
    context.disabled = false;
    block.textContent += "changed";
    assert.equal(valid(), false);
    block.textContent = snapshot.text;
    block.dataset.subtype = "h3";
    assert.equal(valid(), false);
    delete block.dataset.subtype;
    Object.assign(snapshot.range, {startContainer: block.parentElement});
    assert.equal(valid(), false);
    Object.assign(snapshot.range, {startContainer: snapshot.start});
    block.parentElement = new TestElement();
    assert.equal(valid(), false);
});

test("snapshots reject ancestor layout changes and readonly roots", () => {
    const {context, editor, parent} = fixture("NodeParagraph", "NodeSuperBlock");
    parent.dataset.sbLayout = "row";
    const snapshot = captureTextBlockSelection(context, "document");
    parent.dataset.sbLayout = "col";
    assert.equal(isTextBlockSelectionValid(snapshot, context, "document"), false);
    parent.dataset.sbLayout = "row";
    assert.equal(isTextBlockSelectionValid(snapshot, context, "document"), true);
    editor.dataset.readonly = "true";
    assert.equal(getTextSelectionBlock(context), undefined);
});
