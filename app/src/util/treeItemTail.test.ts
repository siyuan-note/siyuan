import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getTreeItemTailHTML} from "./treeItemTail";

describe("tree item tail", () => {
    const countHTML = '<span class="counter">121</span>';
    const actionHTML = '<span class="b3-list-item__action"></span>';

    it("places mobile counters before actions", () => {
        assert.equal(getTreeItemTailHTML(countHTML, actionHTML, true), `${countHTML}${actionHTML}`);
    });

    it("preserves the desktop action order", () => {
        assert.equal(getTreeItemTailHTML(countHTML, actionHTML, false), `${actionHTML}${countHTML}`);
    });

    it("handles items without counters or actions", () => {
        assert.equal(getTreeItemTailHTML("", actionHTML, true), actionHTML);
        assert.equal(getTreeItemTailHTML(countHTML, "", true), countHTML);
    });
});
