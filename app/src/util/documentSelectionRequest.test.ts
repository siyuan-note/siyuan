import * as assert from "node:assert/strict";
import {test} from "node:test";
import {loadModule} from "../testSupport/loadModule";
import type {DocumentPath, DocumentSelectionInput, DocumentSelectionFailure} from "../types/api";

function setup() {
    const selections: Array<{pick: (document?: DocumentPath) => void; destroy: () => void}> = [];
    const messages: string[] = [];
    const common = loadModule<typeof import("./configuredDocument")>("src/util/configuredDocument.ts", {
        require: (name: string) => ({
            "./documentAncestor": {selectDocumentAncestor: (_notebook: string, _ambiguity: unknown,
                lifecycle: {open: (dialog: unknown) => void; close: (dialog: unknown) => void}) => new Promise(resolve => {
                const dialog = {pick(document?: DocumentPath) { lifecycle.close(dialog); resolve(document); }, destroy() { this.pick(); }};
                selections.push(dialog); lifecycle.open(dialog);
            })},
        })[name] || {},
    });
    const methods = loadModule<typeof import("./documentSelectionRequest")>("src/util/documentSelectionRequest.ts", {
        require: (name: string) => ({
            "./configuredDocument": common,
            "../dialog/message": {showMessage: (message: string) => messages.push(message)},
            "./escape": {escapeHtml: (text: string) => text},
        })[name] || {},
    });
    return {common, methods, selections, messages};
}
const settle = () => new Promise<void>(resolve => setImmediate(resolve));
const document: DocumentPath = {id: "parent", notebook: "target", revision: "parent-version", parentID: null,
    path: "/parent.sy", title: {format: "plain", text: "Parent", empty: false}, depth: 1, segments: [], displayPath: "/Parent"};
const failure: {code: number; msg: string; data: DocumentSelectionFailure} = {code: -1, msg: "ambiguous", data: {notebook: "target", ambiguity: {
    index: 2, title: "Parent", parentID: null, candidates: [document], candidatesTruncated: false,
    time: "2026-10-31T23:59:59+08:00", targetRevision: "template-version",
}}};

test("specialized requests continue with a selection without changing the original operation", async () => {
    const state = setup();
    const submitted: Array<DocumentSelectionInput | undefined> = [];
    const pending = state.methods.fetchWithDocumentSelection(async selection => {
        submitted.push(selection);
        return selection ? {code: 0, msg: "", data: {id: "daily"}} : failure;
    }, {notebooks: ["source"]});
    await settle();
    state.selections[0].pick(document);
    const result = await pending;
    assert.equal(result.code, 0);
    assert.equal(submitted.length, 2);
    assert.equal(submitted[1].time, failure.data.ambiguity.time);
    assert.equal(submitted[1].targetRevision, "template-version");
    assert.equal(submitted[1].ancestorChoices[0].id, "parent");
    assert.deepEqual(state.messages, []);
});

test("canceling or closing either notebook cannot repeat a specialized write", async () => {
    for (const closed of ["cancel", "source", "target"]) {
        const state = setup();
        let calls = 0;
        const pending = state.methods.fetchWithDocumentSelection(async () => { calls++; return failure; }, {notebooks: ["source"]});
        await settle();
        if (closed === "cancel") state.selections[0].pick(); else state.common.clearDocumentCreationPlans(closed);
        assert.equal(await pending, undefined);
        assert.equal(calls, 1);
    }
});

test("ordinary failures and lost acknowledgments never retry and late locked errors stay silent", async () => {
    for (const mode of ["ordinary", "network", "locked"]) {
        const state = setup();
        let calls = 0;
        let reject: (error: Error) => void;
        const pending = state.methods.fetchWithDocumentSelection(async () => {
            calls++;
            if (mode === "ordinary") return {code: -1, msg: "failed"};
            return new Promise<{code: number; msg: string}>( (_resolve, fail) => { reject = fail; });
        }, {notebooks: ["source"]});
        if (mode !== "ordinary") {
            if (mode === "locked") state.common.clearDocumentCreationPlans("source");
            reject(new Error("response lost"));
        }
        assert.equal(await pending, undefined);
        assert.equal(calls, 1);
        assert.equal(state.selections.length, 0);
        assert.equal(state.messages.length, mode === "locked" ? 0 : 1);
    }
});
