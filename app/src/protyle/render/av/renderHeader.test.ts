import {before, describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getAVHeaderEditingState} from "./headerEditing";

before(() => {
    Object.assign(globalThis, {
        window: {
            siyuan: {
                languages: {
                    delete: "Delete",
                    editFields: "Edit fields",
                    new: "New",
                    template: "Template",
                },
            },
        },
    });
});

describe("database header editing controls", () => {
    it("keeps editing controls in the DOM when the editor is read-only", () => {
        const state = getAVHeaderEditingState(false);

        assert.equal(state.contenteditable, "false");
        assert.match(state.newItemHTML, /class="av__new fn__flex"/);
        assert.match(state.selectionHTML, /data-type="av-selection-edit"/);
    });

    it("omits editing controls in a context that does not support editing", () => {
        const state = getAVHeaderEditingState(false, false);

        assert.equal(state.newItemHTML, "");
        assert.equal(state.selectionHTML, "");
    });
});
