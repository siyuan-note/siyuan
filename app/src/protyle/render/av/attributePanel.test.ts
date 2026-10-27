import * as assert from "node:assert/strict";
import {test} from "node:test";
import {ScriptTarget} from "typescript";
import {loadModule} from "../../../testSupport/loadModule";

const exports = loadModule<typeof import("./attributePanel")>("src/protyle/render/av/attributePanel.ts", {
    require: () => ({}),
}, ScriptTarget.ES2021);

const setup = (database = "", item = "") => {
    const panel = Object.create(exports.AVAttributePanel.prototype);
    let refreshed = 0;
    Object.assign(panel, {
        targetID: "document",
        hasDatabase: (id: string) => id === database,
        hasItem: (id: string) => !!id && id === item,
        refresh: () => { refreshed++; },
    });
    return {panel, refreshed: () => refreshed};
};

test("binding refreshes a newly bound document even before its database panel exists", () => {
    const {panel, refreshed} = setup();
    panel.refreshForOperation({action: "replaceAttrViewBlock", avID: "database", previousID: "item",
        nextID: "document", isDetached: false});
    assert.equal(refreshed(), 1);
});

test("rebinding, detaching and undo refresh the existing database and item panels", () => {
    for (const [database, item] of [["database", ""], ["", "item"]]) {
        const {panel, refreshed} = setup(database, item);
        for (const [nextID, isDetached] of [["other-document", false], ["", true], ["document", false]]) {
            panel.refreshForOperation({action: "replaceAttrViewBlock", avID: "database", previousID: "item",
                nextID, isDetached});
        }
        assert.equal(refreshed(), 3);
    }
});

test("binding transactions do not refresh unrelated panels or operations without a database", () => {
    const {panel, refreshed} = setup("other-database", "other-item");
    panel.refreshForOperation({action: "replaceAttrViewBlock", avID: "database", previousID: "item", nextID: "other"});
    panel.refreshForOperation({action: "replaceAttrViewBlock", previousID: "other-item", nextID: "document"});
    assert.equal(refreshed(), 0);
});
