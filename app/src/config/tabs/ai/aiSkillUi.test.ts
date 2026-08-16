import * as assert from "node:assert/strict";
import test from "node:test";
import {setUserSkillEnabled} from "./aiSkillState";

test("user skill selection is case insensitive", () => {
    assert.deepEqual(setUserSkillEnabled(["Review"], "review", true), ["review"]);
    assert.deepEqual(setUserSkillEnabled(["Review", "Write"], "review", false), ["Write"]);
});

test("user skill selection preserves unavailable configured skills", () => {
    assert.deepEqual(setUserSkillEnabled(["missing"], "review", true), ["missing", "review"]);
});
