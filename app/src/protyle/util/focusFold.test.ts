import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {applyFocusFold, stopFocusFold, updateFocusFoldSource} from "./focusFold";

class FoldElement {
    attrs: Record<string, string>;

    constructor(id: string, type = "NodeListItem", fold = "1") {
        this.attrs = {"data-node-id": id, "data-type": type, fold};
    }

    getAttribute(name: string) {
        return this.attrs[name] ?? null;
    }

    hasAttribute(name: string) {
        return name in this.attrs;
    }

    setAttribute(name: string, value: string) {
        this.attrs[name] = value;
    }

    removeAttribute(name: string) {
        delete this.attrs[name];
    }
}

const editor = (elements: FoldElement[]) => ({
    block: {id: "parent", rootID: "doc", showAll: true},
    options: {},
    wysiwyg: {
        element: {
            querySelector: (selector: string) => elements.find(element =>
                selector === `[data-node-id="${element.attrs["data-node-id"]}"][data-type="${element.attrs["data-type"]}"]`),
        },
    },
} as unknown as IProtyle);

describe("focused list folding", () => {
    it("temporarily unfolds only the focused item and restores it on exit", () => {
        const parent = new FoldElement("parent");
        const child = new FoldElement("child");
        const protyle = editor([parent, child]);
        applyFocusFold(protyle);
        assert.equal(parent.getAttribute("fold"), null);
        assert.equal(parent.getAttribute("data-view-fold-source"), "1");
        assert.equal(child.getAttribute("fold"), "1");
        protyle.block.showAll = false;
        applyFocusFold(protyle);
        assert.equal(parent.getAttribute("fold"), "1");
        assert.equal(parent.hasAttribute("data-view-fold-source"), false);
    });

    it("restores each level when navigating into a child and back", () => {
        const parent = new FoldElement("parent");
        const child = new FoldElement("child");
        const protyle = editor([parent, child]);
        applyFocusFold(protyle);
        protyle.block.id = "child";
        applyFocusFold(protyle);
        assert.equal(parent.getAttribute("fold"), "1");
        assert.equal(child.getAttribute("fold"), null);
        protyle.block.id = "parent";
        applyFocusFold(protyle);
        assert.equal(child.getAttribute("fold"), "1");
        assert.equal(parent.getAttribute("fold"), null);
    });

    it("keeps the automatic override when content is replaced", () => {
        const elements = [new FoldElement("parent")];
        const protyle = editor(elements);
        applyFocusFold(protyle);
        elements[0] = new FoldElement("parent");
        applyFocusFold(protyle);
        assert.equal(elements[0].getAttribute("fold"), null);
        assert.equal(elements[0].getAttribute("data-view-fold-source"), "1");
    });

    it("honors manual folding across refreshes until focus is entered again", () => {
        const elements = [new FoldElement("parent")];
        const protyle = editor(elements);
        applyFocusFold(protyle);
        stopFocusFold(protyle, "parent");
        elements[0].setAttribute("fold", "1");
        assert.equal(elements[0].hasAttribute("data-view-fold-source"), false);
        elements[0] = new FoldElement("parent");
        applyFocusFold(protyle);
        assert.equal(elements[0].getAttribute("fold"), "1");
        protyle.block.showAll = false;
        applyFocusFold(protyle);
        protyle.block.showAll = true;
        applyFocusFold(protyle);
        assert.equal(elements[0].getAttribute("fold"), null);
    });

    it("preserves manual child folding and isolates editor instances", () => {
        const parent = new FoldElement("parent");
        const otherParent = new FoldElement("parent");
        const protyle = editor([parent]);
        const other = editor([otherParent]);
        applyFocusFold(protyle);
        stopFocusFold(protyle, "child");
        applyFocusFold(protyle);
        assert.equal(parent.getAttribute("fold"), null);
        assert.equal(otherParent.getAttribute("fold"), "1");
        applyFocusFold(other);
        stopFocusFold(protyle, "parent");
        parent.setAttribute("fold", "1");
        applyFocusFold(other);
        assert.equal(otherParent.getAttribute("fold"), null);
    });

    it("restores the latest source state after a remote fold change", () => {
        const parent = new FoldElement("parent");
        const protyle = editor([parent]);
        applyFocusFold(protyle);
        updateFocusFoldSource(protyle, "parent", false);
        applyFocusFold(protyle);
        protyle.block.showAll = false;
        applyFocusFold(protyle);
        assert.equal(parent.getAttribute("fold"), null);
    });

    it("does not unfold headings, ordinary document views, or backlink views", () => {
        const heading = new FoldElement("parent", "NodeHeading");
        applyFocusFold(editor([heading]));
        assert.equal(heading.getAttribute("fold"), "1");
        const parent = new FoldElement("parent");
        const protyle = editor([parent]);
        protyle.block.showAll = false;
        applyFocusFold(protyle);
        assert.equal(parent.getAttribute("fold"), "1");
        protyle.block.showAll = true;
        protyle.options.backlinkData = {} as IProtyle["options"]["backlinkData"];
        applyFocusFold(protyle);
        assert.equal(parent.getAttribute("fold"), "1");
    });
});
