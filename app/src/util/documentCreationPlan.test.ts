import * as assert from "node:assert/strict";
import {test} from "node:test";
import {DocumentCreationAttempt} from "./documentCreationPlan";
import type {CreateDocByParentRequestInput, DocumentCreatePlan, DocumentPath} from "../types/api";

const fixture = (): DocumentCreatePlan => ({
    notebook: "notebook", title: "Final title",
    steps: [
        {notebook: "notebook", parentID: null, id: "parent", title: {format: "plain", text: "Parent"}, markdown: ""},
        {notebook: "notebook", parentID: "parent", id: "child", title: {format: "plain", text: "Final title"}, markdown: ""},
    ],
});

const document = (id: string): DocumentPath => ({
    id, notebook: "notebook", path: `/${id}.sy`, parentID: null, title: {format: "plain", text: id, empty: false},
    segments: [], depth: 1, displayPath: `/${id}`, revision: `${id}-revision`,
});

test("the original IDs and committed parent revision are used by the next step", async () => {
    const attempt = new DocumentCreationAttempt(fixture());
    const requests: CreateDocByParentRequestInput[] = [];
    const id = await attempt.execute(async request => {
        requests.push({...request});
        return {code: 0, msg: "", data: {id: request.id, document: document(request.id)}};
    });
    assert.equal(id, "child");
    assert.deepEqual(requests.map(request => request.id), ["parent", "child"]);
    assert.equal(requests[1].expectedParentRevision, "parent-revision");
    assert.deepEqual(attempt.completed, ["parent", "child"]);
});

test("a known uncommitted failure retains the remainder and never recreates completed ancestors", async () => {
    const attempt = new DocumentCreationAttempt(fixture());
    await assert.rejects(attempt.execute(async request => request.id === "parent"
        ? {code: 0, msg: "", data: {id: request.id, document: document(request.id)}}
        : {code: -1, msg: "changed", data: {commitState: "none"}}), /changed/);
    const retried: string[] = [];
    await attempt.execute(async request => {
        retried.push(request.id);
        return {code: 0, msg: "", data: {id: request.id, document: document(request.id)}};
    });
    assert.deepEqual(retried, ["child"]);
});

test("lost responses and committed post-processing failures stop automatic replay", async () => {
    for (const unknown of [false, true]) {
        const attempt = new DocumentCreationAttempt(fixture());
        let requests = 0;
        const submit = async () => {
            requests++;
            if (unknown) {
                throw new Error("connection lost");
            }
            return {code: -1, msg: "template failed", data: {commitState: "committed" as const, id: "parent"}};
        };
        await assert.rejects(attempt.execute(submit));
        await assert.rejects(attempt.execute(submit));
        assert.equal(requests, 1);
        assert.equal(attempt.requiresReview, true);
        assert.equal(unknown ? attempt.uncertainID : attempt.completed[0], "parent");
    }
});

test("invalidated editor context prevents subsequent writes", async () => {
    const attempt = new DocumentCreationAttempt(fixture());
    let valid = true;
    const requests: string[] = [];
    assert.equal(await attempt.execute(async request => {
        requests.push(request.id);
        valid = false;
        return {code: 0, msg: "", data: {id: request.id, document: document(request.id)}};
    }, () => valid), undefined);
    assert.deepEqual(requests, ["parent"]);
});

test("explicit recovery verifies fixed identity and skips committed side effects", async () => {
    const attempt = new DocumentCreationAttempt(fixture());
    await assert.rejects(attempt.execute(async () => {throw new Error("lost");}));
    assert.throws(() => attempt.review({...document("parent"), title: {format: "plain", text: "Changed", empty: false}}));
    attempt.review({...document("parent"), title: {format: "plain", text: "Parent", empty: false}});
    const retried: string[] = [];
    await attempt.execute(async request => {
        retried.push(request.id);
        assert.equal(request.expectedParentRevision, "parent-revision");
        return {code: 0, msg: "", data: {id: request.id, document: document(request.id)}};
    });
    assert.deepEqual(retried, ["child"]);
});

test("an authoritatively missing unknown result retries the original ID after review", async () => {
    const attempt = new DocumentCreationAttempt(fixture());
    await assert.rejects(attempt.execute(async () => {throw new Error("lost");}));
    attempt.review();
    const retried: string[] = [];
    await attempt.execute(async request => {
        retried.push(request.id);
        return {code: 0, msg: "", data: {id: request.id, document: document(request.id)}};
    });
    assert.deepEqual(retried, ["parent", "child"]);
});
