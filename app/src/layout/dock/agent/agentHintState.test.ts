import * as assert from "node:assert/strict";
import test from "node:test";
import {isSkillHintRequestActive, shouldYieldSkillHint} from "./agentHintState";

const activeState = {
    requestID: 2,
    currentRequestID: 2,
    enableExtend: true,
    enableSlash: true,
    splitChar: "/",
    hidden: false,
    connected: true,
};

test("skill hint renders the current active request", () => {
    assert.equal(isSkillHintRequestActive(activeState), true);
});

test("skill hint ignores a response after Escape", () => {
    assert.equal(isSkillHintRequestActive({...activeState, enableExtend: false, hidden: true}), false);
});

test("skill hint ignores stale responses and changed triggers", () => {
    assert.equal(isSkillHintRequestActive({...activeState, currentRequestID: 3}), false);
    assert.equal(isSkillHintRequestActive({...activeState, splitChar: "[["}), false);
});

test("skill hint yields to a multi-character hint prefix before requesting", () => {
    const hintKeys = ["((", "[[", "/", "、"];
    assert.equal(shouldYieldSkillHint("(", hintKeys), true);
    assert.equal(shouldYieldSkillHint("query", hintKeys), false);
});
