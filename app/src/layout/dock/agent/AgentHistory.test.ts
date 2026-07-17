import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    findAgentUserEntryIndex,
    filterAgentReferencesForContent,
    hasAgentExecutedToolsAfter,
    isAgentRegenerateStateCurrent
} from "./AgentHistory";

describe("AgentHistory", () => {
    const entries = [
        {id: "user-1", type: "user"},
        {id: "assistant-1", type: "assistant"},
        {id: "user-2", type: "user"},
        {id: "assistant-2", type: "assistant"},
    ];

    it("finds the requested user entry or the latest user entry", () => {
        assert.equal(findAgentUserEntryIndex(entries, "user-1"), 0);
        assert.equal(findAgentUserEntryIndex(entries, "user-2"), 2);
        assert.equal(findAgentUserEntryIndex(entries), 2);
        assert.equal(findAgentUserEntryIndex(entries, "missing"), -1);
    });

    it("detects executed tools after the selected user entry", () => {
        assert.equal(hasAgentExecutedToolsAfter([
            {id: "user-1", type: "user"},
            {id: "assistant-1", type: "assistant", toolCalls: [{result: "done"}]},
        ], 0), true);
        assert.equal(hasAgentExecutedToolsAfter([
            {id: "user-1", type: "user"},
            {id: "confirm-1", type: "confirm", status: "rejected"},
        ], 0), false);
        assert.equal(hasAgentExecutedToolsAfter([
            {id: "user-1", type: "user"},
            {id: "snapshot-1", type: "snapshot"},
        ], 0), true);
    });

    it("rejects regenerate state changed while confirmation is open", () => {
        assert.equal(isAgentRegenerateStateCurrent("session-1", "session-1", 2, 2, false, false), true);
        assert.equal(isAgentRegenerateStateCurrent("session-1", "session-2", 2, 2, false, false), false);
        assert.equal(isAgentRegenerateStateCurrent("session-1", "session-1", 2, 3, false, false), false);
        assert.equal(isAgentRegenerateStateCurrent("session-1", "session-1", 2, 2, true, false), false);
        assert.equal(isAgentRegenerateStateCurrent("session-1", "session-1", 2, 2, false, true), false);
    });

    it("drops block references removed from edited content", () => {
        const references = [
            {id: "block-1", title: "First block"},
            {id: "block-2", title: "Second block"},
        ];
        assert.deepEqual(filterAgentReferencesForContent(references, "Review First block"), [references[0]]);
    });
});
