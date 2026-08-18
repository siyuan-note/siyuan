import * as assert from "node:assert/strict";
import test from "node:test";
import {buildAgentConfirmEvent} from "./agentConfirmEvent";

test("confirmation SSE data preserves effects and forced approval", () => {
    const event = buildAgentConfirmEvent({
        name: "search",
        arguments: {action: "fulltext"},
        confirmID: "confirm-1",
        effects: {localRead: true},
        forced: true,
    });

    assert.deepEqual(event, {
        type: "confirm",
        name: "search",
        arguments: {action: "fulltext"},
        confirmID: "confirm-1",
        effects: {localRead: true},
        forced: true,
    });
});

test("legacy confirmation SSE data defaults forced approval to false", () => {
    const event = buildAgentConfirmEvent({name: "search", confirmID: "confirm-2"});

    assert.equal(event.forced, false);
    assert.equal(event.effects, undefined);
    assert.deepEqual(event.arguments, {});
});
