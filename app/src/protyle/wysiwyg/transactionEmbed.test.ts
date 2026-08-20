import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getMoveAffectedEmbedElements, shouldSyncMoveCopies} from "./transactionEmbed";

class TestEmbedElement {
    constructor(private nodeIDs: string[]) {
    }

    querySelector(selector: string) {
        const id = selector.match(/\[data-node-id="([^"]+)"\]/)?.[1];
        return id && this.nodeIDs.includes(id) ? {} : null;
    }

    querySelectorAll() {
        return this.nodeIDs.map(id => ({
            getAttribute: (name: string) => name === "data-node-id" ? id : null,
        }));
    }
}

const asElement = (element: TestEmbedElement) => element as unknown as Element;

describe("getMoveAffectedEmbedElements", () => {
    it("preserves the locally updated embed while refreshing other affected copies", () => {
        const editingEmbed = asElement(new TestEmbedElement(["moved", "parent"]));
        const otherEmbed = asElement(new TestEmbedElement(["parent"]));
        const unrelatedEmbed = asElement(new TestEmbedElement(["unrelated"]));

        const result = getMoveAffectedEmbedElements(
            [editingEmbed, otherEmbed, unrelatedEmbed],
            {id: "moved", parentID: "parent", previousID: "previous"},
            editingEmbed,
        );

        assert.deepEqual(result, [otherEmbed]);
    });

    it("matches the previous block when the destination parent is outside the embed", () => {
        const embed = asElement(new TestEmbedElement(["previous"]));

        assert.deepEqual(getMoveAffectedEmbedElements(
            [embed],
            {id: "moved", previousID: "previous"},
        ), [embed]);
    });

    it("matches visible members that move with a folded heading", () => {
        const embed = asElement(new TestEmbedElement(["heading-child"]));

        assert.deepEqual(getMoveAffectedEmbedElements(
            [embed],
            {id: "heading", blockIDs: ["heading-child"]},
        ), [embed]);
    });
});

describe("shouldSyncMoveCopies", () => {
    it("replays moves in normal copies when editing an embed", () => {
        assert.equal(shouldSyncMoveCopies(false, true), true);
    });

    it("keeps ordinary document moves local", () => {
        assert.equal(shouldSyncMoveCopies(false, false), false);
    });
});
