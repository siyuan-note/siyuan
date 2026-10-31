import * as assert from "node:assert/strict";
import {test} from "node:test";
import {loadModule} from "../testSupport/loadModule";
import type {DocumentAncestorAmbiguity, DocumentPath} from "../types/api";

const candidate = (id = "chosen"): DocumentPath => ({id, notebook: "box", parentID: null, path: `/${id}.sy`,
    title: {format: "plain", text: "<Same>", empty: false}, displayPath: "/<Same>", segments: [], depth: 1, revision: "revision"});
const ambiguity = (truncated = false): DocumentAncestorAmbiguity => ({index: 0, parentID: null, title: "<Same>",
    candidates: [candidate("first"), candidate("second")], candidatesTruncated: truncated, time: "fixed", targetRevision: "target"});

function setup(lookup = async () => ({code: 0, data: {documents: [candidate("unlisted")], missingIDs: new Array<string>()}})) {
    let confirm: () => void;
    let cancel: () => void;
    let extra: {callback: () => void};
    let picker: {cb: (paths: string[], notebooks: string[]) => void; restoreFocus: () => void;
        validate: (paths: string[], notebooks: string[]) => boolean};
    let html = "";
    let valid = true;
    const button = {disabled: false};
    const select = {value: "", focused: false, focus() { this.focused = true; }};
    const dialog = {element: {querySelector: (selector: string) => selector === "[data-ancestor-select]" ? select : button}};
    const pickerDialog = {};
    const opened: unknown[] = [];
    const closed: unknown[] = [];
    const messages: string[] = [];
    const methods = loadModule<typeof import("./documentAncestor")>("src/util/documentAncestor.ts", {
        window: {siyuan: {languages: {newFile: "New", documentAncestorAmbiguous: "Choose parent", documentAncestorMore: "Other"}}},
        require: (name: string) => ({
            "../dialog/confirmDialog": {confirmDialog: (_title: string, text: string, yes: () => void,
                no: () => void, _isDelete: boolean, action: {callback: () => void}) => {
                html = text; confirm = yes; cancel = no; extra = action; return dialog;
            }},
            "./escape": {escapeHtml: (text: string) => text.replaceAll("<", "&lt;").replaceAll(">", "&gt;")},
            "./pathName": {movePathTo: (options: typeof picker) => { picker = options; return pickerDialog; }},
            "./documentCreate": {documentParentID: (path: string) => path === "/" ? null : path.split("/").pop().replace(/\.sy$/, "")},
            "./fetch": {fetchSyncPost: lookup},
            "../dialog/message": {showMessage: (text: string) => messages.push(text)},
        })[name] || {},
    });
    const choose = (truncated = false, candidates = ambiguity().candidates) => methods.selectDocumentAncestor("box", {...ambiguity(truncated), candidates}, {
        open: dialog => opened.push(dialog), close: dialog => closed.push(dialog), valid: () => valid,
    });
    return {choose, select, button, opened, closed, messages, dialog, pickerDialog,
        confirm: () => confirm(), cancel: () => cancel(), more: () => extra.callback(),
        html: () => html, picker: () => picker, invalidate: () => { valid = false; }};
}

test("ancestor selector shows titles only in candidate paths, distinguishes IDs and allows changing the default", async () => {
    const state = setup();
    const pending = state.choose();
    assert.equal(state.button.disabled, false);
    assert.equal(state.select.value, "0");
    assert.equal(state.select.focused, true);
    assert.equal(state.html().match(/&lt;Same&gt;/g)?.length, 2);
    assert.doesNotMatch(state.html(), /<Same>/);
    assert.match(state.html(), /\[first\]/);
    assert.match(state.html(), /\[second\]/);
    assert.doesNotMatch(state.html(), /<option value="">/);
    state.select.value = "1";
    assert.equal(state.button.disabled, false);
    state.confirm();
    assert.equal((await pending).id, "second");
    assert.deepEqual(state.closed, [state.dialog]);
});

test("confirmation without changing the selection uses the first candidate", async () => {
    const state = setup();
    const pending = state.choose();
    state.confirm();
    assert.equal((await pending).id, "first");
});

test("canceling the default selection does not select a parent", async () => {
    const state = setup();
    const pending = state.choose();
    state.cancel();
    assert.equal(await pending, undefined);
});

test("an empty candidate list cannot confirm a parent", async () => {
    const state = setup();
    const pending = state.choose(false, []);
    assert.equal(state.button.disabled, true);
    state.confirm();
    assert.equal(await pending, undefined);
});

test("complete and truncated candidate lists can use the shared picker and retain its lifecycle", async () => {
    for (const truncated of [false, true]) {
        const state = setup();
        const pending = state.choose(truncated);
        state.more();
        assert.deepEqual(state.opened, [state.dialog, state.pickerDialog]);
        assert.equal(state.picker().validate(["/"], ["box"]), false);
        assert.equal(state.picker().validate(["/id.sy"], ["other"]), false);
        state.picker().cb(["/unlisted.sy"], ["box"]);
        state.picker().restoreFocus();
        assert.equal((await pending).id, "unlisted");
        assert.deepEqual(state.closed, [state.dialog, state.pickerDialog]);
    }
});

test("canceling the shared picker or locking before submission cannot choose a document", async () => {
    for (const locked of [true, false]) {
        const state = setup();
        const pending = state.choose(true);
        state.more();
        if (locked) {
            state.invalidate();
            state.picker().cb(["/unlisted.sy"], ["box"]);
        }
        state.picker().restoreFocus();
        assert.equal(await pending, undefined);
        assert.deepEqual(state.messages, []);
    }
});

test("locking during a shared picker lookup suppresses late documents and errors", async () => {
    for (const failure of [false, true]) {
        let resolve: (value: {code: number; data: {documents: DocumentPath[]; missingIDs: string[]}}) => void;
        let reject: (error: Error) => void;
        const pendingLookup = new Promise<{code: number; data: {documents: DocumentPath[]; missingIDs: string[]}}>((yes, no) => {
            resolve = yes; reject = no;
        });
        const state = setup(() => pendingLookup);
        const pending = state.choose(true);
        state.more();
        state.picker().cb(["/unlisted.sy"], ["box"]);
        state.invalidate();
        if (failure) reject(new Error("late error")); else resolve({code: 0, data: {documents: [candidate()], missingIDs: []}});
        assert.equal(await pending, undefined);
        assert.deepEqual(state.messages, []);
    }
});
