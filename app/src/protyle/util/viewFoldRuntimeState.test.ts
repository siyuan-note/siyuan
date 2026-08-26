import * as assert from "node:assert/strict";
import {test} from "node:test";
import {
    clearViewFoldDefaultsForOccurrence,
    clearViewFoldOccurrenceRuntimeState,
} from "./viewFoldRuntimeState";

const getStateKey = (pane: string, rootID: string, occurrenceID: string, blockID: string) => [
    "fold",
    encodeURIComponent(pane),
    encodeURIComponent(rootID),
    encodeURIComponent(occurrenceID),
    encodeURIComponent(blockID),
].join(":");

const identity = {
    pane: "backlink pane",
    rootID: "root/id",
    occurrenceID: "occurrence:id",
};

test("clearing occurrence defaults preserves transient state", () => {
    const targetKey = getStateKey(identity.pane, identity.rootID, identity.occurrenceID, "block-a");
    const siblingKey = getStateKey(identity.pane, identity.rootID, "occurrence:id-child", "block-b");
    const state = {
        defaults: new Map([[targetKey, true], [siblingKey, false]]),
        transient: new Map([[targetKey, false], [siblingKey, true]]),
    };

    clearViewFoldDefaultsForOccurrence(state, identity);

    assert.equal(state.defaults.has(targetKey), false);
    assert.equal(state.defaults.get(siblingKey), false);
    assert.equal(state.transient.get(targetKey), false);
    assert.equal(state.transient.get(siblingKey), true);
});

test("removing an occurrence clears its default and transient state", () => {
    const targetKey = getStateKey(identity.pane, identity.rootID, identity.occurrenceID, "block-a");
    const siblingKey = getStateKey(identity.pane, identity.rootID, "other-occurrence", "block-b");
    const state = {
        defaults: new Map([[targetKey, true], [siblingKey, false]]),
        transient: new Map([[targetKey, false], [siblingKey, true]]),
    };

    clearViewFoldOccurrenceRuntimeState(state, identity);

    assert.equal(state.defaults.has(targetKey), false);
    assert.equal(state.transient.has(targetKey), false);
    assert.equal(state.defaults.get(siblingKey), false);
    assert.equal(state.transient.get(siblingKey), true);
});
