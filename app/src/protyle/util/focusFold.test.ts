import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {applyFocusFold, invalidateFocusFoldRequests, stopFocusFold, updateFocusFoldSource} from "./focusFold";

class FoldElement {
    isConnected = true;
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
                selector === `[data-node-id="${element.attrs["data-node-id"]}"]`),
            contains: (element: FoldElement) => elements.includes(element),
        },
    },
} as unknown as IProtyle);

describe("focused list folding", () => {
    for (const type of ["NodeBlockquote", "NodeCallout", "NodeSuperBlock"]) {
        it(`temporarily expands ${type} without loading or changing child folds`, async () => {
            const parent = new FoldElement("parent", type);
            const child = new FoldElement("child", type);
            const protyle = editor([parent, child]);
            await applyFocusFold(protyle, async () => {
                assert.fail("Container blocks must not load heading content");
            });
            assert.equal(parent.getAttribute("fold"), null);
            assert.equal(child.getAttribute("fold"), "1");
            protyle.block.showAll = false;
            applyFocusFold(protyle);
            assert.equal(parent.getAttribute("fold"), "1");
            assert.equal(parent.hasAttribute("data-view-fold-source"), false);
        });
    }

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

    it("requires a loader for headings and excludes ordinary document and backlink views", () => {
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

describe("focused heading loading", () => {
    it("loads once, preserves child folds, and restores the source on exit", async () => {
        const heading = new FoldElement("parent", "NodeHeading");
        const child = new FoldElement("child", "NodeHeading");
        const protyle = editor([heading, child]);
        let loads = 0;
        const load = async () => {
            loads++;
            return true;
        };
        await applyFocusFold(protyle, load);
        await applyFocusFold(protyle, load);
        assert.equal(loads, 1);
        assert.equal(heading.getAttribute("fold"), null);
        assert.equal(heading.getAttribute("data-view-fold-source"), "1");
        assert.equal(child.getAttribute("fold"), "1");
        protyle.block.showAll = false;
        await applyFocusFold(protyle, load);
        assert.equal(heading.getAttribute("fold"), "1");
    });

    it("shares an in-flight load and ignores it after a focus switch", async () => {
        const protyle = editor([new FoldElement("parent", "NodeHeading")]);
        let complete: (value: boolean) => void;
        let valid: () => boolean;
        const load = (_element: Element, isValid: () => boolean) => {
            valid = isValid;
            return new Promise<boolean>(resolve => complete = resolve);
        };
        const request = applyFocusFold(protyle, load);
        assert.equal(applyFocusFold(protyle, load), request);
        await Promise.resolve();
        protyle.block.id = "another";
        assert.equal(valid(), false);
        complete(true);
        await request;
    });

    it("invalidates pending content after an edit and allows a fresh request", async () => {
        const protyle = editor([new FoldElement("parent", "NodeHeading")]);
        let complete: (value: boolean) => void;
        let valid: () => boolean;
        const request = applyFocusFold(protyle, (_element, isValid) => {
            valid = isValid;
            return new Promise<boolean>(resolve => complete = resolve);
        });
        await Promise.resolve();
        invalidateFocusFoldRequests(protyle);
        assert.equal(valid(), false);
        let fresh = false;
        await applyFocusFold(protyle, async () => {
            fresh = true;
            return true;
        });
        complete(false);
        await request;
        assert.equal(fresh, true);
        assert.equal(protyle.wysiwyg.element.querySelector('[data-node-id="parent"]').getAttribute("fold"), null);
    });

    it("honors manual folding while loading and after refreshing the heading", async () => {
        const elements = [new FoldElement("parent", "NodeHeading")];
        const protyle = editor(elements);
        let complete: (value: boolean) => void;
        let valid: () => boolean;
        const request = applyFocusFold(protyle, (_element, isValid) => {
            valid = isValid;
            return new Promise<boolean>(resolve => complete = resolve);
        });
        await Promise.resolve();
        stopFocusFold(protyle, "parent");
        elements[0].setAttribute("fold", "1");
        assert.equal(valid(), false);
        complete(true);
        await request;
        elements[0] = new FoldElement("parent", "NodeHeading");
        await applyFocusFold(protyle, async () => assert.fail("manual folding must survive refresh"));
        assert.equal(elements[0].getAttribute("fold"), "1");
    });

    it("rejects a detached or replaced heading and reloads the new element", async () => {
        const elements = [new FoldElement("parent", "NodeHeading")];
        const protyle = editor(elements);
        let complete: (value: boolean) => void;
        let valid: () => boolean;
        const request = applyFocusFold(protyle, (_element, isValid) => {
            valid = isValid;
            return new Promise<boolean>(resolve => complete = resolve);
        });
        await Promise.resolve();
        elements[0].isConnected = false;
        assert.equal(valid(), false);
        elements[0] = new FoldElement("parent", "NodeHeading");
        await applyFocusFold(protyle, async () => true);
        complete(false);
        await request;
        assert.equal(elements[0].getAttribute("fold"), null);
    });

    it("restores folding on failure without repeatedly retrying and retries after refresh", async () => {
        const elements = [new FoldElement("parent", "NodeHeading")];
        const protyle = editor(elements);
        await applyFocusFold(protyle, async () => false);
        assert.equal(elements[0].getAttribute("fold"), "1");
        assert.equal(elements[0].hasAttribute("data-view-fold-source"), false);
        await applyFocusFold(protyle, async () => assert.fail("failed loads must not loop"));
        elements[0] = new FoldElement("parent", "NodeHeading");
        await applyFocusFold(protyle, async () => true);
        assert.equal(elements[0].getAttribute("fold"), null);
    });
});
