import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {matchesBlockPanelRemoval, planBlockPanelRemoval} from "./panelRemoval";

describe("matchesBlockPanelRemoval", () => {
    it("matches editors from a closed notebook", () => {
        assert.equal(matchesBlockPanelRemoval({
            notebookId: "20260811000000-notebook",
            rootID: "20260811000000-document",
        }, {
            notebookId: "20260811000000-notebook",
            rootIDs: new Set(),
        }), true);
    });

    it("matches editors from removed root documents", () => {
        assert.equal(matchesBlockPanelRemoval({
            notebookId: "20260811000000-notebook",
            rootID: "20260811000000-document",
        }, {
            rootIDs: new Set(["20260811000000-document"]),
        }), true);
    });

    it("keeps editors outside the removal scope", () => {
        assert.equal(matchesBlockPanelRemoval({
            notebookId: "20260811000000-notebook-a",
            rootID: "20260811000000-document-a",
        }, {
            notebookId: "20260811000000-notebook-b",
            rootIDs: new Set(["20260811000000-document-b"]),
        }), false);
        assert.equal(matchesBlockPanelRemoval(undefined, {
            rootIDs: new Set(["20260811000000-document-b"]),
        }), false);
    });
});

describe("planBlockPanelRemoval", () => {
    it("separates matching, retained, and unresolved editors", () => {
        const items = ["removed", "retained", "unresolved"];
        const infos = new Map([
            ["removed", {notebookId: "20260811000000-notebook-a"}],
            ["retained", {notebookId: "20260811000000-notebook-b"}],
        ]);
        assert.deepEqual(planBlockPanelRemoval(items, item => infos.get(item), {
            notebookId: "20260811000000-notebook-a",
            rootIDs: new Set(),
        }), {
            removeItems: ["removed"],
            unresolvedItems: ["unresolved"],
        });
    });

    it("returns an empty plan when the panel has no editors", () => {
        assert.deepEqual(planBlockPanelRemoval([], () => undefined, {
            rootIDs: new Set(["20260811000000-document"]),
        }), {
            removeItems: [],
            unresolvedItems: [],
        });
    });
});
