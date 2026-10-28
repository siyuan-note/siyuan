import * as assert from "node:assert/strict";
import {test} from "node:test";
import {DocumentCreationAttempt} from "./documentCreationPlan";
import {loadModule} from "../testSupport/loadModule";
import type {DocumentCreatePlan, DocumentPath, PlanDocCreateRequestInput} from "../types/api";

const plan = (): DocumentCreatePlan => ({notebook: "box", title: "Title", steps: [
    {notebook: "box", parentID: null, id: "fixed", title: {format: "plain", text: "Title"}, markdown: ""},
]});
const location = (): DocumentPath => ({notebook: "box", id: "fixed", parentID: null, path: "/fixed.sy", depth: 1,
    segments: [], displayPath: "/Title", revision: "saved",
    title: {format: "plain", text: "Title", empty: false}});
const input: Omit<PlanDocCreateRequestInput, "id"> = {notebook: "box", contextID: null, purpose: "document"};

function setup(fetch: (url: string, data: unknown) => Promise<unknown>) {
    const dialogs: Array<{yes: () => void; no: () => void; destroyed: boolean; destroy: () => void}> = [];
    const messages: string[] = [];
    const methods = loadModule<typeof import("./configuredDocument")>("src/util/configuredDocument.ts", {
        Lute: {NewNodeID: () => "allocated-once"},
        window: {siyuan: {languages: {documentCreationRecovery: "Review", documentCreationLimit: "Limit"}}},
        require: (name: string) => ({
            "./fetch": {fetchSyncPost: fetch},
            "./documentCreationPlan": {DocumentCreationAttempt},
            "./escape": {escapeHtml: (text: string) => text},
            "../dialog/message": {showMessage: (text: string) => messages.push(text)},
            "../dialog/confirmDialog": {confirmDialog: (_title: string, _message: string, yes: () => void, no: () => void) => {
                const dialog = {yes, no, destroyed: false, destroy() { this.destroyed = true; }};
                dialogs.push(dialog);
                return dialog;
            }},
        })[name] || {},
    });
    return {methods, dialogs, messages};
}
const settle = () => new Promise<void>(resolve => setImmediate(resolve));

test("concurrent clicks share one planning request and a locked notebook cannot publish its response", async () => {
    let resolve: (value: unknown) => void;
    let calls = 0;
    const pending = new Promise(value => { resolve = value; });
    const {methods} = setup(async () => { calls++; return pending; });
    const options = {onCreated() { assert.fail("closed notebook published a created document"); }};
    const first = methods.createConfiguredDocument(input, options);
    await methods.createConfiguredDocument(input, options);
    assert.equal(calls, 1);
    methods.clearDocumentCreationPlans("box");
    resolve({code: 0, data: plan()});
    await first;
    assert.equal(calls, 1);
});

test("canceling an unknown result retains the fixed identity until explicit review", async () => {
    const calls: string[] = [];
    const created: string[] = [];
    const {methods, dialogs} = setup(async url => {
        calls.push(url);
        if (url.endsWith("planDocCreate")) {
            return {code: 0, data: plan()};
        }
        if (url.endsWith("getDocPaths")) {
            return {code: 0, data: {documents: [location()], missingIDs: []}};
        }
        throw new Error("response lost");
    });
    const options = {onCreated: (id: string) => created.push(id)};
    await methods.createConfiguredDocument(input, options);
    dialogs[0].no();
    await methods.createConfiguredDocument(input, options);
    assert.equal(calls.length, 2);
    dialogs[1].yes();
    await settle();
    assert.deepEqual(created, ["fixed"]);
    assert.equal(calls.filter(url => url.endsWith("createDocByParent")).length, 1);
});

test("an explicitly reviewed missing document retries its original ID", async () => {
    const submitted: string[] = [];
    const created: string[] = [];
    const {methods, dialogs} = setup(async (url, request) => {
        if (url.endsWith("planDocCreate")) {
            return {code: 0, data: plan()};
        }
        if (url.endsWith("getDocPaths")) {
            return {code: 0, data: {documents: [], missingIDs: ["fixed"]}};
        }
        submitted.push((request as {id: string}).id);
        if (submitted.length === 1) {
            throw new Error("connection lost");
        }
        return {code: 0, data: {id: "fixed", document: location()}};
    });
    await methods.createConfiguredDocument(input, {onCreated: id => created.push(id)});
    dialogs[0].yes();
    await settle();
    assert.deepEqual(submitted, ["fixed", "fixed"]);
    assert.deepEqual(created, ["fixed"]);
});

test("locking closes recovery dialogs and suppresses their in-flight callbacks", async () => {
    let resolve: (value: unknown) => void;
    const pending = new Promise(value => { resolve = value; });
    const {methods, dialogs, messages} = setup(async url => {
        if (url.endsWith("planDocCreate")) {
            return {code: 0, data: plan()};
        }
        if (url.endsWith("getDocPaths")) {
            return pending;
        }
        throw new Error("connection lost");
    });
    await methods.createConfiguredDocument(input, {onCreated() { assert.fail("locked callback ran"); }});
    methods.clearDocumentCreationPlans("box");
    assert.equal(dialogs[0].destroyed, true);
    dialogs[0].yes();
    resolve({code: 0, data: {documents: [location()], missingIDs: []}});
    await settle();
    assert.equal(messages.length, 0);
});
