import * as assert from "node:assert/strict";
import {test} from "node:test";
import {DocumentCreationAttempt} from "./documentCreationPlan";
import {loadModule} from "../testSupport/loadModule";
import type {DocumentAncestorAmbiguity, DocumentCreatePlan, DocumentPath, PlanDocCreateRequestInput} from "../types/api";

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
    const selections: Array<{notebook: string; ambiguity: DocumentAncestorAmbiguity; pick: (document?: DocumentPath) => void;
        destroyed: boolean; destroy: () => void}> = [];
    const methods = loadModule<typeof import("./configuredDocument")>("src/util/configuredDocument.ts", {
        Lute: {NewNodeID: () => "allocated-once"},
        window: {siyuan: {languages: {documentCreationRecovery: "Review", documentCreationLimit: "Limit"}}},
        require: (name: string) => ({
            "./fetch": {fetchSyncPost: fetch},
            "./documentCreationPlan": {DocumentCreationAttempt},
            "./documentAncestor": {selectDocumentAncestor: (notebook: string, ambiguity: DocumentAncestorAmbiguity,
                lifecycle: {open: (dialog: unknown) => void; close: (dialog: unknown) => void}) => new Promise(resolve => {
                const selection = {notebook, ambiguity, destroyed: false,
                    pick(document?: DocumentPath) { lifecycle.close(selection); resolve(document); },
                    destroy() { this.destroyed = true; this.pick(); }};
                selections.push(selection);
                lifecycle.open(selection);
            })},
            "./escape": {escapeHtml: (text: string) => text},
            "../dialog/message": {showMessage: (text: string) => messages.push(text)},
            "../dialog/confirmDialog": {confirmDialog: (_title: string, _message: string, yes: () => void, no: () => void) => {
                const dialog = {yes, no, destroyed: false, destroy() { this.destroyed = true; }};
                dialogs.push(dialog);
                return dialog;
            }},
        })[name] || {},
    });
    return {methods, dialogs, messages, selections};
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

const ambiguity = (index = 0): DocumentAncestorAmbiguity => ({index, title: "Same", parentID: null,
    candidates: [{...location(), id: `parent-${index}`}], candidatesTruncated: false,
    time: "2026-10-31T23:59:59+08:00", targetRevision: "configured-revision"});

test("nested ancestor choices keep one ID and time and execute only after the final selection", async () => {
    const requests: PlanDocCreateRequestInput[] = [];
    const created: string[] = [];
    let writes = 0;
    const {methods, selections} = setup(async (url, request) => {
        if (url.endsWith("planDocCreate")) {
            requests.push(JSON.parse(JSON.stringify(request)));
            return requests.length < 3 ? {code: -1, data: {...plan(), ambiguity: ambiguity(requests.length - 1)}} :
                {code: 0, data: plan()};
        }
        writes++;
        return {code: 0, data: {id: "fixed", document: location()}};
    });
    const pending = methods.createConfiguredDocument({...input, purpose: "reference", title: "Requested"}, {
        sortTargetID: "sibling", sortPosition: "after", onCreated: id => created.push(id),
    });
    await settle();
    assert.equal(writes, 0);
    selections[0].pick(ambiguity().candidates[0]);
    await settle();
    assert.equal(writes, 0);
    selections[1].pick(ambiguity(1).candidates[0]);
    await pending;
    assert.equal(writes, 1);
    assert.deepEqual(created, ["fixed"]);
    assert.deepEqual(requests.map(item => item.id), ["allocated-once", "allocated-once", "allocated-once"]);
    assert.equal(requests[2].time, ambiguity().time);
    assert.equal(requests[2].targetRevision, ambiguity().targetRevision);
    assert.equal(requests[2].purpose, "reference");
    assert.equal(requests[2].title, "Requested");
    assert.deepEqual(requests[2].ancestorChoices, [
        {index: 0, id: "parent-0", revision: "saved"}, {index: 1, id: "parent-1", revision: "saved"},
    ]);
});

test("canceling ancestor selection performs no creation and simultaneous clicks share the selection", async () => {
    let calls = 0;
    const {methods, selections} = setup(async () => {
        calls++;
        return {code: -1, data: {...plan(), ambiguity: ambiguity()}};
    });
    const options = {onCreated() { assert.fail("cancel created a document"); }};
    const pending = methods.createConfiguredDocument(input, options);
    await settle();
    await methods.createConfiguredDocument(input, options);
    assert.equal(selections.length, 1);
    selections[0].pick();
    await pending;
    assert.equal(calls, 1);
});

test("closing either source or target notebook destroys ancestor selection and cannot resume it", async () => {
    for (const notebook of ["box", "target"]) {
        let calls = 0;
        const {methods, selections} = setup(async () => {
            calls++;
            return {code: -1, data: {...plan(), notebook: "target", ambiguity: ambiguity()}};
        });
        const pending = methods.createConfiguredDocument(input, {onCreated() { assert.fail("locked selection created"); }});
        await settle();
        methods.clearDocumentCreationPlans(notebook);
        await pending;
        assert.equal(selections[0].destroyed, true);
        selections[0].pick(location());
        await settle();
        assert.equal(calls, 1);
    }
});

test("a stale selection error is shown without another selection or creation request", async () => {
    let calls = 0;
    const {methods, selections, messages} = setup(async () => {
        calls++;
        return calls === 1 ? {code: -1, data: {...plan(), ambiguity: ambiguity()}} :
            {code: -1, msg: "selection changed", data: null};
    });
    const pending = methods.createConfiguredDocument(input, {onCreated() { assert.fail("stale selection created"); }});
    await settle();
    selections[0].pick(location());
    await pending;
    assert.equal(calls, 2);
    assert.equal(selections.length, 1);
    assert.deepEqual(messages, ["selection changed"]);
});
