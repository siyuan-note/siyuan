import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    getPendingBlockFocusMode,
    getSavedTabFocusTarget,
    getZoomFocusScrollAttr,
    hasFocusOffsets,
    shouldFocusAfterZoom
} from "./focusRestore";

class FocusElement {
    children: FocusElement[] = [];
    parentElement: FocusElement;
    classList = {contains: (name: string) => this.kind === name};
    constructor(private kind = "", private attrs: Record<string, string> = {}) {}
    append(child: FocusElement) {
        this.children.push(child);
        child.parentElement = this;
        return child;
    }
    closest(selector: string): FocusElement {
        return this.kind === selector.substring(1) ? this : this.parentElement?.closest(selector);
    }
    getAttribute(name: string) {
        return this.attrs[name];
    }
    asElement() {
        return this as unknown as Element;
    }
}

describe("saved focus respects persisted tab selection", () => {
    it("redirects stale first-page focus before visual tab initialization", () => {
        const tabs = new FocusElement("tabs", {"tabs-active-id": "second"});
        const first = tabs.append(new FocusElement("tab-item", {"data-node-id": "first"}));
        const second = tabs.append(new FocusElement("tab-item", {"data-node-id": "second"}));
        const oldFocus = first.append(new FocusElement());
        const activeFocus = second.append(new FocusElement());
        assert.equal(getSavedTabFocusTarget(oldFocus.asElement()), tabs.asElement());
        assert.equal(getSavedTabFocusTarget(activeFocus.asElement()), activeFocus.asElement());
    });
    it("uses the outermost hidden page in nested tabs", () => {
        const outer = new FocusElement("tabs", {"tabs-active-id": "outer-active"});
        const hidden = outer.append(new FocusElement("tab-item", {"data-node-id": "outer-hidden"}));
        outer.append(new FocusElement("tab-item", {"data-node-id": "outer-active"}));
        const inner = hidden.append(new FocusElement("tabs", {"tabs-active-id": "inner-active"}));
        const first = inner.append(new FocusElement("tab-item", {"data-node-id": "inner-hidden"}));
        inner.append(new FocusElement("tab-item", {"data-node-id": "inner-active"}));
        assert.equal(getSavedTabFocusTarget(first.asElement()), outer.asElement());
    });
    it("leaves ordinary focus and a missing target unchanged", () => {
        const paragraph = new FocusElement();
        assert.equal(getSavedTabFocusTarget(paragraph.asElement()), paragraph.asElement());
        assert.equal(getSavedTabFocusTarget(undefined), undefined);
    });
});

describe("shouldFocusAfterZoom", () => {
    it("focuses a block entered through regular navigation", () => {
        assert.equal(shouldFocusAfterZoom({
            id: "block-id",
            rootID: "root-id",
            isPushBack: true,
        }), true);
    });

    it("leaves back and forward navigation to its focus callback", () => {
        assert.equal(shouldFocusAfterZoom({
            id: "block-id",
            rootID: "root-id",
            isPushBack: false,
        }), false);
    });

    it("focuses an explicit target when exiting focus", () => {
        assert.equal(shouldFocusAfterZoom({
            focusId: "block-id",
            id: "root-id",
            rootID: "root-id",
            isPushBack: false,
        }), true);
    });

    it("does not move focus for a regular root document reload", () => {
        assert.equal(shouldFocusAfterZoom({
            id: "root-id",
            rootID: "root-id",
            isPushBack: true,
        }), false);
    });
});

describe("hasFocusOffsets", () => {
    it("accepts zero offsets", () => {
        assert.equal(hasFocusOffsets({
            rootId: "root-id",
            focusId: "block-id",
            focusStart: 0,
            focusEnd: 0,
        }), true);
    });

    it("rejects a focus target without offsets", () => {
        assert.equal(hasFocusOffsets({
            rootId: "root-id",
            focusId: "block-id",
        }), false);
    });

    it("rejects offsets without a focus target", () => {
        assert.equal(hasFocusOffsets({
            rootId: "root-id",
            focusStart: 0,
            focusEnd: 0,
        }), false);
    });
});

describe("getZoomFocusScrollAttr", () => {
    it("preserves block offsets while zooming out", () => {
        assert.deepEqual(getZoomFocusScrollAttr("root-id", "block-id", {start: 7, end: 7}), {
            rootId: "root-id",
            focusId: "block-id",
            focusStart: 7,
            focusEnd: 7,
        });
    });

    it("keeps block-only focus behavior without a position", () => {
        assert.deepEqual(getZoomFocusScrollAttr("root-id", "block-id"), {
            rootId: "root-id",
            focusId: "block-id",
            focusStart: undefined,
            focusEnd: undefined,
        });
    });

    it("does not create scroll attributes without a focus target", () => {
        assert.equal(getZoomFocusScrollAttr("root-id"), undefined);
    });
});

describe("getPendingBlockFocusMode", () => {
    it("preserves the zoom focus strategy through asynchronous rendering", () => {
        assert.equal(getPendingBlockFocusMode("zoom"), "zoom");
    });

    it("keeps the existing default focus strategy", () => {
        assert.equal(getPendingBlockFocusMode("true"), "default");
    });

    it("ignores unrelated attribute values", () => {
        assert.equal(getPendingBlockFocusMode("false"), undefined);
    });
});
