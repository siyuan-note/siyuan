import * as assert from "node:assert/strict";
import {test} from "node:test";
import {FlashcardV2OrderedState} from "./flashcardV2OrderedState";

const loaded = () => ({steps: [{id: "a", text: "Alpha"}, {id: "b", text: "Beta"}, {id: "c", text: "Gamma"}],
    revisionID: "revision", contentFingerprint: "fingerprint"});
const setup = () => {
    let sequence = 0;
    const state = new FlashcardV2OrderedState("source", () => ({operationID: `operation-${++sequence}`, updatedAt: sequence}));
    const token = state.beginLoad();
    assert.equal(state.completeLoad(token, loaded()), true);
    return state;
};

test("ordered load generations freeze edits and cannot revive a closed controller", () => {
    const state = setup();
    assert.equal(state.move("a", 1), true);
    const first = state.beginLoad();
    const second = state.beginLoad();
    assert.equal(state.move("b", 1), false);
    assert.equal(state.beginSave(), undefined);
    assert.equal(state.completeLoad(first, loaded()), false);
    assert.equal(state.failLoad(first), false);
    assert.equal(state.busy, true);
    assert.equal(state.failLoad(second), true);
    assert.deepEqual(state.steps.map(step => step.id), ["b", "a", "c"]);
    assert.equal(state.dirty, true);
    const last = state.beginLoad();
    state.close();
    assert.equal(state.completeLoad(last, loaded()), false);
    assert.equal(state.failLoad(last), false);
    assert.equal(state.beginLoad(), undefined);
});

test("ordered moves preserve identities and snapshots are not externally mutable", () => {
    const state = setup();
    assert.equal(state.move("a", -1), false);
    assert.equal(state.move("c", 1), false);
    assert.equal(state.move("missing", 1), false);
    assert.equal(state.beginSave(), undefined);
    const external = state.steps;
    external[0].id = "other";
    assert.equal(state.steps[0].id, "a");
    assert.equal(state.move("a", 1), true);
    assert.equal(state.dirty, true);
    assert.equal(state.move("a", -1), true);
    assert.equal(state.dirty, false);
});

test("failed ordered save retains input and operation identity until the plan changes", () => {
    const state = setup();
    state.move("a", 1);
    const first = state.beginSave();
    assert.equal(state.busy, true);
    assert.equal(state.move("a", 1), false);
    assert.equal(state.beginLoad(), undefined);
    assert.equal(state.beginSave(), undefined);
    assert.equal(state.completeSave(first.token, false), true);
    const retry = state.beginSave();
    assert.deepEqual(retry.request, first.request);
    retry.request.orderedStepIDs[0] = "external";
    assert.equal(state.completeSave(first.token, true), false);
    assert.equal(state.completeSave(retry.token, false), true);
    const again = state.beginSave();
    assert.deepEqual(again.request, first.request);
    state.completeSave(again.token, false);
    state.move("a", 1);
    const changed = state.beginSave();
    assert.notEqual(changed.request.operationID, first.request.operationID);
    assert.equal(state.completeSave(changed.token, true), true);
    assert.equal(state.dirty, false);
});

test("reload uses a fresh revision and fingerprint while late save completion is inert after close", () => {
    const state = setup();
    const data = loaded();
    data.revisionID = "new-revision";
    data.contentFingerprint = "new-fingerprint";
    state.completeLoad(state.beginLoad(), data);
    data.steps[0].text = "external";
    assert.equal(state.steps[0].text, "Alpha");
    state.move("a", 1);
    const save = state.beginSave();
    assert.equal(save.request.expectedRevisionID, "new-revision");
    assert.equal(save.request.contentFingerprint, "new-fingerprint");
    state.close();
    assert.equal(state.completeSave(save.token, true), false);
    assert.equal(state.dirty, true);
    assert.equal(state.beginSave(), undefined);
});
