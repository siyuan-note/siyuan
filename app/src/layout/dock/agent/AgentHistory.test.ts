import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    applyAgentUserEdit,
    buildAgentPresentationEntries,
    findAgentUserEntryIndex,
    getAgentThinkingDisplaySeconds,
    getAgentThinkingToolGroups,
    hasAgentExecutedToolsAfter,
    hasAgentModelSpecificContext,
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

    it("displays every positive thinking duration as at least one second", () => {
        assert.equal(getAgentThinkingDisplaySeconds(undefined), undefined);
        assert.equal(getAgentThinkingDisplaySeconds(0), undefined);
        assert.equal(getAgentThinkingDisplaySeconds(-0.1), undefined);
        assert.equal(getAgentThinkingDisplaySeconds(0.001), 1);
        assert.equal(getAgentThinkingDisplaySeconds(0.499), 1);
        assert.equal(getAgentThinkingDisplaySeconds(1.499), 1);
        assert.equal(getAgentThinkingDisplaySeconds(1.5), 2);
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

    it("detects model-specific context in the current session", () => {
        assert.equal(hasAgentModelSpecificContext([
            {type: "assistant", reasoningContent: "reasoning"},
        ]), true);
        assert.equal(hasAgentModelSpecificContext([
            {type: "thinking", steps: [{reasoningContent: "reasoning"}]},
        ]), true);
        assert.equal(hasAgentModelSpecificContext([
            {type: "assistant", toolCalls: [{}]},
        ]), true);
        assert.equal(hasAgentModelSpecificContext([
            {type: "assistant", reasoningContent: "  ", toolCalls: []},
            {type: "thinking", steps: [{reasoningContent: ""}]},
        ]), false);
    });

    it("rejects regenerate state changed while confirmation is open", () => {
        assert.equal(isAgentRegenerateStateCurrent("session-1", "session-1", 2, 2, false, false), true);
        assert.equal(isAgentRegenerateStateCurrent("session-1", "session-2", 2, 2, false, false), false);
        assert.equal(isAgentRegenerateStateCurrent("session-1", "session-1", 2, 3, false, false), false);
        assert.equal(isAgentRegenerateStateCurrent("session-1", "session-1", 2, 2, true, false), false);
        assert.equal(isAgentRegenerateStateCurrent("session-1", "session-1", 2, 2, false, true), false);
    });

    it("updates rich user message data together", () => {
        const entry = {
            content: "Old content",
            blockHTML: "<div>Old content</div>",
            references: [{id: "block-1", title: "Old reference"}],
        };
        const references = [{id: "block-2", title: "New reference"}];
        applyAgentUserEdit(entry, {
            text: "| A | B |",
            blockHTML: '<div data-type="NodeTable">table</div>',
            references,
        });
        assert.deepEqual(entry, {
            content: "| A | B |",
            blockHTML: '<div data-type="NodeTable">table</div>',
            references,
        });
        assert.notEqual(entry.references, references);

        applyAgentUserEdit(entry, {
            text: "No references",
            blockHTML: "<div>No references</div>",
            references: [],
        });
        assert.equal(entry.references, undefined);
    });

    it("renders tool-call protocol messages inside thinking and keeps one final answer", () => {
        const display = buildAgentPresentationEntries([
            {id: "user-1", type: "user", content: "create backlink"},
            {id: "snapshot-1", type: "snapshot"},
            {
                id: "thinking-1",
                type: "thinking",
                steps: [{reasoningContent: "read blocks", toolNames: ["block", "block"]}],
            },
            {id: "assistant-0", type: "assistant", toolCalls: [{name: "block"}, {name: "block"}]},
            {
                id: "thinking-2",
                type: "thinking",
                steps: [
                    {reasoningContent: "append", content: "Both blocks are documents", toolNames: ["block"]},
                    {reasoningContent: "retry", content: "parentID is required", toolNames: ["block"]},
                ],
            },
            {
                id: "assistant-1",
                type: "assistant",
                content: "Both blocks are documents",
                toolCalls: [{name: "block"}],
            },
            {
                id: "assistant-2",
                type: "assistant",
                content: "parentID is required",
                toolCalls: [{name: "block"}],
            },
            {id: "assistant-3", type: "assistant", content: "Done"},
        ]);
        const visibleAnswers = display.filter(entry =>
            entry.type === "assistant" && !!entry.content?.trim());
        assert.deepEqual(visibleAnswers.map(entry => entry.content), ["Done"]);
        assert.equal(display.filter(entry => entry.type === "thinking").length, 2);
        assert.deepEqual(display.find(entry => entry.id === "thinking-2")?.steps?.map(step => step.content), [
            "Both blocks are documents",
            "parentID is required",
        ]);
    });

    it("uses round IDs to restore authoritative process content", () => {
        const display = buildAgentPresentationEntries([
            {id: "user-1", type: "user", content: "work"},
            {
                id: "thinking-1",
                type: "thinking",
                steps: [{roundID: "round-1", reasoningContent: "partial", toolNames: ["old"]}],
            },
            {
                id: "assistant-1",
                type: "assistant",
                roundID: "round-1",
                content: "authoritative content",
                reasoningContent: "authoritative reasoning",
                toolCalls: [{name: "block"}],
            },
            {id: "assistant-2", type: "assistant", roundID: "round-2", content: "Done"},
        ]);
        const step = display.find(entry => entry.id === "thinking-1")?.steps?.[0];
        assert.deepEqual(step, {
            roundID: "round-1",
            content: "authoritative content",
            reasoningContent: "authoritative reasoning",
            toolNames: ["block"],
        });
        assert.equal(display.find(entry => entry.id === "assistant-1")?.content, undefined);
    });

    it("synthesizes a thinking card when recovery has no UI process entries", () => {
        const display = buildAgentPresentationEntries([
            {id: "user-1", type: "user", content: "work"},
            {
                id: "assistant-1",
                type: "assistant",
                roundID: "round-1",
                content: "working",
                reasoningContent: "reasoning",
                toolCalls: [{name: "block"}],
            },
            {id: "assistant-2", type: "assistant", roundID: "round-2", content: "Done"},
        ]);
        assert.deepEqual(display.map(entry => entry.type), ["user", "thinking", "assistant", "assistant"]);
        assert.deepEqual(display[1].steps, [{
            reasoning: "processing",
            reasoningContent: "reasoning",
            roundID: "round-1",
            toolNames: ["block"],
            content: "working",
        }]);
        assert.equal(display[2].content, undefined);
        assert.equal(display[3].content, "Done");
    });

    it("falls back to legacy step matching and restores final reasoning", () => {
        const display = buildAgentPresentationEntries([
            {id: "user-1", type: "user", content: "work"},
            {
                id: "thinking-1",
                type: "thinking",
                steps: [{content: "working", reasoningContent: "legacy reasoning", toolNames: ["block"]}],
            },
            {
                id: "assistant-1",
                type: "assistant",
                roundID: "round-1",
                content: "working",
                reasoningContent: "authoritative reasoning",
                toolCalls: [{name: "block"}],
            },
            {
                id: "assistant-2",
                type: "assistant",
                roundID: "round-2",
                content: "Done",
                reasoningContent: "final reasoning",
            },
        ]);
        assert.deepEqual(display.map(entry => entry.type), ["user", "thinking", "assistant", "thinking", "assistant"]);
        assert.deepEqual(display[1].steps?.[0], {
            content: "working",
            reasoningContent: "authoritative reasoning",
            roundID: "round-1",
            toolNames: ["block"],
        });
        assert.deepEqual(display[3].steps, [{
            reasoning: "processing",
            reasoningContent: "final reasoning",
            roundID: "round-2",
            toolNames: undefined,
            content: undefined,
        }]);
        assert.equal(display[2].content, undefined);
        assert.equal(display[4].content, "Done");
    });

    it("inserts a recovered middle round before the next known thinking step", () => {
        const display = buildAgentPresentationEntries([
            {id: "user-1", type: "user", content: "work"},
            {
                id: "thinking-1",
                type: "thinking",
                steps: [
                    {roundID: "round-0", reasoningContent: "first"},
                    {roundID: "round-2", reasoningContent: "third"},
                ],
            },
            {id: "assistant-0", type: "assistant", roundID: "round-0", toolCalls: [{name: "block"}]},
            {
                id: "assistant-1",
                type: "assistant",
                roundID: "round-1",
                content: "recovered middle",
                toolCalls: [{name: "block"}],
            },
            {id: "assistant-2", type: "assistant", roundID: "round-2", toolCalls: [{name: "block"}]},
            {id: "assistant-3", type: "assistant", roundID: "round-3", content: "Done"},
        ]);
        assert.deepEqual(display.find(entry => entry.id === "thinking-1")?.steps?.map(step => step.roundID), [
            "round-0",
            "round-1",
            "round-2",
        ]);
        assert.equal(display.filter(entry => entry.type === "thinking").length, 1);
        assert.equal(display.find(entry => entry.roundID === "round-1")?.content, undefined);
    });

    it("keeps todo results after their corresponding thinking card", () => {
        const display = buildAgentPresentationEntries([
            {id: "user-1", type: "user", content: "work"},
            {
                id: "thinking-1",
                type: "thinking",
                steps: [{roundID: "round-1", toolNames: ["todo_write"], toolCallIDs: ["call-todo"]}],
            },
            {
                id: "thinking-2",
                type: "thinking",
                steps: [{roundID: "round-2", reasoningContent: "continue"}],
            },
            {
                id: "assistant-1",
                type: "assistant",
                roundID: "round-1",
                toolCalls: [{id: "call-todo", name: "todo_write", result: "todo result"}],
            },
            {id: "assistant-2", type: "assistant", roundID: "round-2", content: "Done"},
        ]);
        assert.deepEqual(display.map(entry => entry.type), [
            "user", "thinking", "todo", "thinking", "assistant", "assistant",
        ]);
        assert.equal(display[2].result, "todo result");
        assert.deepEqual(display.find(entry => entry.id === "assistant-1")?.toolCalls, []);
    });

    it("uses tool call IDs to preserve tools split by confirmations in one round", () => {
        const display = buildAgentPresentationEntries([
            {id: "user-1", type: "user", content: "work"},
            {
                id: "thinking-1",
                type: "thinking",
                steps: [{roundID: "round-1", toolNames: ["old-a"], toolCallIDs: ["call-a"]}],
            },
            {id: "confirm-1", type: "confirm"},
            {
                id: "thinking-2",
                type: "thinking",
                steps: [{roundID: "round-1", toolNames: ["old-b"], toolCallIDs: ["call-b"]}],
            },
            {id: "confirm-2", type: "confirm"},
            {
                id: "assistant-1",
                type: "assistant",
                roundID: "round-1",
                toolCalls: [{id: "call-a", name: "write-a"}, {id: "call-b", name: "write-b"}],
            },
            {id: "assistant-2", type: "assistant", roundID: "round-2", content: "Done"},
        ]);
        const thinkingEntries = display.filter(entry => entry.type === "thinking");
        assert.deepEqual(thinkingEntries.map(entry => entry.steps?.[0].toolNames), [["write-a"], ["write-b"]]);
    });

    it("preserves legacy tool subsets when confirmations split one round", () => {
        const display = buildAgentPresentationEntries([
            {id: "user-1", type: "user", content: "work"},
            {
                id: "thinking-1",
                type: "thinking",
                steps: [{roundID: "round-1", toolNames: ["write-a"]}],
            },
            {id: "confirm-1", type: "confirm"},
            {
                id: "thinking-2",
                type: "thinking",
                steps: [{roundID: "round-1", toolNames: ["write-b"]}],
            },
            {
                id: "assistant-1",
                type: "assistant",
                roundID: "round-1",
                toolCalls: [{name: "write-a"}, {name: "write-b"}],
            },
            {id: "assistant-2", type: "assistant", roundID: "round-2", content: "Done"},
        ]);
        const thinkingEntries = display.filter(entry => entry.type === "thinking");
        assert.deepEqual(thinkingEntries.map(entry => entry.steps?.[0].toolNames), [["write-a"], ["write-b"]]);
    });

    it("moves a legacy snapshot after the thinking that triggered it", () => {
        const display = buildAgentPresentationEntries([
            {id: "user-1", type: "user", content: "create a reference"},
            {id: "snapshot-1", type: "snapshot"},
            {
                id: "thinking-1",
                type: "thinking",
                steps: [
                    {roundID: "round-0", toolNames: ["block", "block"]},
                    {roundID: "round-1", toolNames: ["block"]},
                ],
            },
            {
                id: "thinking-2",
                type: "thinking",
                steps: [{roundID: "round-2", reasoningContent: "done"}],
            },
            {
                id: "assistant-0",
                type: "assistant",
                roundID: "round-0",
                toolCalls: [{name: "block"}, {name: "block"}],
            },
            {id: "assistant-1", type: "assistant", roundID: "round-1", toolCalls: [{name: "block"}]},
            {id: "assistant-2", type: "assistant", roundID: "round-2", content: "Done"},
        ]);
        assert.deepEqual(display.map(entry => entry.type), [
            "user", "thinking", "snapshot", "thinking", "assistant", "assistant", "assistant",
        ]);
        assert.deepEqual(getAgentThinkingToolGroups(display[1].steps || []), [["block", "block"], ["block"]]);
    });

    it("places a round snapshot after the last matching thinking card", () => {
        const display = buildAgentPresentationEntries([
            {id: "user-1", type: "user", content: "write"},
            {id: "thinking-1", type: "thinking", steps: [{roundID: "round-1", toolNames: ["write"]}]},
            {id: "confirm-1", type: "confirm"},
            {id: "snapshot-1", type: "snapshot", roundID: "round-1"},
            {id: "thinking-2", type: "thinking", steps: [{roundID: "round-1"}]},
            {
                id: "assistant-1",
                type: "assistant",
                roundID: "round-1",
                toolCalls: [{name: "write"}],
            },
            {id: "assistant-2", type: "assistant", roundID: "round-2", content: "Done"},
        ]);
        assert.deepEqual(display.map(entry => entry.type), [
            "user", "thinking", "confirm", "thinking", "snapshot", "assistant", "assistant",
        ]);
    });
});
