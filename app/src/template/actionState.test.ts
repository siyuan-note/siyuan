import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getTemplateActionState} from "./actionState";

describe("template manager action state", () => {
    it("keeps native button appearance stable while blocking repeated operations", () => {
        const entry = {path: "note.md", isDir: false};
        for (const action of ["new", "mkdir", "rename", "move", "remove", "refresh", "save", "preview"]) {
            const idle = getTemplateActionState(action, entry, true, false);
            const busy = getTemplateActionState(action, entry, true, true);
            assert.equal(idle.disabled, false, action);
            assert.equal(busy.disabled, idle.disabled, action);
            assert.equal(busy.ariaDisabled, true, action);
            assert.equal(idle.ariaDisabled, false, action);
        }
    });

    it("still disables unavailable actions and protects package directories", () => {
        for (const busy of [true, false]) {
            assert.equal(getTemplateActionState("save", {path: "note.md", isDir: false}, false, busy).disabled, true);
            for (const action of ["save", "preview", "rename", "move", "remove"]) {
                assert.equal(getTemplateActionState(action, undefined, false, busy).disabled, true, action);
            }
            const folder = {path: "package", isDir: true, isPackage: true};
            for (const action of ["rename", "move"]) {
                const state = getTemplateActionState(action, folder, false, busy);
                assert.equal(state.disabled, true);
                assert.equal(state.packageMove, true);
            }
            assert.equal(getTemplateActionState("remove", folder, false, busy).disabled, false);
            assert.equal(getTemplateActionState("preview", folder, false, busy).disabled, true);
        }
    });

    it("requires a document context only for preview", () => {
        const entry = {path: "note.md", isDir: false};
        assert.equal(getTemplateActionState("preview", entry, false, false, false).disabled, true);
        assert.equal(getTemplateActionState("save", entry, true, false, false).disabled, false);
        assert.equal(getTemplateActionState("remove", entry, false, false, false).disabled, false);
    });
});
