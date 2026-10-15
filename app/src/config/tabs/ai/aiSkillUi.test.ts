import * as assert from "node:assert/strict";
import test from "node:test";
import {setBuiltinSkillEnabled, setUserSkillEnabled} from "./aiSkillState";

test("user skill selection is case insensitive", () => {
    assert.deepEqual(setUserSkillEnabled(["Review"], "review", true), ["review"]);
    assert.deepEqual(setUserSkillEnabled(["Review", "Write"], "review", false), ["Write"]);
});

test("user skill selection preserves unavailable configured skills", () => {
    assert.deepEqual(setUserSkillEnabled(["missing"], "review", true), ["missing", "review"]);
});

test("builtin selection preserves unknown IDs and uses exact stable identity", () => {
    const id = "builtin:siyuan-plugin-development";
    const configured = ["builtin:future", id, "siyuan-plugin-development"];
    assert.deepEqual(setBuiltinSkillEnabled(configured, id, true), ["builtin:future", "siyuan-plugin-development"]);
    assert.deepEqual(setBuiltinSkillEnabled(configured, id, false), ["builtin:future", "siyuan-plugin-development", id]);
    assert.deepEqual(configured, ["builtin:future", id, "siyuan-plugin-development"]);
    assert.deepEqual(setBuiltinSkillEnabled([], id, false), [id]);
    assert.deepEqual(setBuiltinSkillEnabled([], id, true), []);
});
