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
    hasAgentThinkingStepDetails,
    isAgentAssistantContentFinalInTurn,
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

    it("shows regenerate only on the final assistant content in each user turn", () => {
        const turnEntries = [
            {type: "user", content: "First question"},
            {type: "assistant", content: "Intermediate result"},
            {type: "thinking"},
            {type: "assistant", content: "Final result"},
            {type: "assistant", toolCalls: [{}]},
            {type: "user", content: "Second question"},
            {type: "assistant", content: "Second result"},
        ];
        assert.equal(isAgentAssistantContentFinalInTurn(turnEntries, 1), false);
        assert.equal(isAgentAssistantContentFinalInTurn(turnEntries, 3), true);
        assert.equal(isAgentAssistantContentFinalInTurn(turnEntries, 4), false);
        assert.equal(isAgentAssistantContentFinalInTurn(turnEntries, 6), true);
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

    it("recognizes only thinking steps with visible details", () => {
        assert.equal(hasAgentThinkingStepDetails({reasoning: "processing", roundID: "round-1"}), false);
        assert.equal(hasAgentThinkingStepDetails({reasoningContent: "reasoning"}), true);
        assert.equal(hasAgentThinkingStepDetails({toolNames: ["document"]}), true);
        assert.equal(hasAgentThinkingStepDetails({content: "legacy content"}), true);
        assert.equal(hasAgentThinkingStepDetails({reasoningContent: " ", toolNames: [""]}), false);
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

    it("keeps tool-call content outside thinking", () => {
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
        assert.deepEqual(visibleAnswers.map(entry => entry.content), [
            "Both blocks are documents",
            "parentID is required",
            "Done",
        ]);
        assert.equal(display.filter(entry => entry.type === "thinking").length, 2);
        assert.deepEqual(display.find(entry => entry.id === "thinking-2")?.steps?.map(step => step.content), [
            undefined,
            undefined,
        ]);
    });

    it("renders question content before its question card instead of inside thinking", () => {
        const display = buildAgentPresentationEntries([
            {id: "user-1", type: "user", content: "choose"},
            {
                id: "thinking-1",
                type: "thinking",
                steps: [{
                    roundID: "round-1",
                    reasoningContent: "partial reasoning",
                    toolNames: ["question"],
                    toolCallIDs: ["call-question"],
                    content: "Choose a color",
                }],
            },
            {id: "question-1", type: "question", roundID: "round-1"},
            {
                id: "assistant-1",
                type: "assistant",
                roundID: "round-1",
                content: "Choose a color",
                reasoningContent: "authoritative reasoning",
                toolCalls: [{id: "call-question", name: "question"}],
            },
            {id: "assistant-2", type: "assistant", roundID: "round-2", content: "Done"},
        ]);

        assert.deepEqual(display.map(entry => entry.id), [
            "user-1", "thinking-1", "assistant-1", "question-1", "assistant-2",
        ]);
        assert.equal(display.find(entry => entry.id === "thinking-1")?.steps?.[0].content, undefined);
        assert.equal(display.find(entry => entry.id === "thinking-1")?.steps?.[0].reasoningContent,
            "authoritative reasoning");
        assert.deepEqual(display.filter(entry => entry.type === "assistant" && entry.content?.trim())
            .map(entry => entry.content), ["Choose a color", "Done"]);
    });

    it("restores legacy question content without question round IDs", () => {
        const display = buildAgentPresentationEntries([
            {id: "user-1", type: "user", content: "choose"},
            {
                id: "thinking-1",
                type: "thinking",
                steps: [{
                    reasoningContent: "reasoning",
                    toolNames: ["question"],
                    content: "Choose a color",
                }],
            },
            {id: "question-1", type: "question"},
            {
                id: "assistant-1",
                type: "assistant",
                content: "Choose a color",
                toolCalls: [{name: "question"}],
            },
        ]);

        assert.deepEqual(display.map(entry => entry.id), [
            "user-1", "thinking-1", "assistant-1", "question-1",
        ]);
        assert.equal(display.find(entry => entry.id === "thinking-1")?.steps?.[0].content, undefined);
    });

    it("matches legacy question content after a contentless question", () => {
        const display = buildAgentPresentationEntries([
            {id: "user-1", type: "user", content: "choose"},
            {
                id: "thinking-1",
                type: "thinking",
                steps: [{reasoningContent: "first", toolNames: ["question"]}],
            },
            {id: "question-1", type: "question"},
            {
                id: "thinking-2",
                type: "thinking",
                steps: [{reasoningContent: "second", toolNames: ["question"], content: "Choose again"}],
            },
            {id: "question-2", type: "question"},
            {id: "assistant-1", type: "assistant", toolCalls: [{name: "question"}]},
            {
                id: "assistant-2",
                type: "assistant",
                content: "Choose again",
                toolCalls: [{name: "question"}],
            },
        ]);

        const secondContentIndex = display.findIndex(entry => entry.id === "assistant-2");
        assert.ok(secondContentIndex > display.findIndex(entry => entry.id === "thinking-2"));
        assert.ok(secondContentIndex < display.findIndex(entry => entry.id === "question-2"));
        assert.ok(secondContentIndex > display.findIndex(entry => entry.id === "question-1"));
        assert.equal(display.find(entry => entry.id === "thinking-2")?.steps?.[0].content, undefined);
    });

    it("places recovered thinking and question content before the question card", () => {
        const display = buildAgentPresentationEntries([
            {id: "user-1", type: "user", content: "choose"},
            {id: "question-1", type: "question", roundID: "round-1"},
            {
                id: "assistant-1",
                type: "assistant",
                roundID: "round-1",
                content: "Choose a color",
                reasoningContent: "reasoning",
                toolCalls: [{id: "call-question", name: "question"}],
            },
            {id: "assistant-2", type: "assistant", roundID: "round-2", content: "Done"},
        ]);

        assert.deepEqual(display.map(entry => entry.id || entry.type), [
            "user-1", "thinking", "assistant-1", "question-1", "assistant-2",
        ]);
        assert.equal(display[1].steps?.[0].content, undefined);
        assert.equal(display[1].steps?.[0].roundID, "round-1");
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
            reasoningContent: "authoritative reasoning",
            toolNames: ["block"],
        });
        assert.equal(display.find(entry => entry.id === "assistant-1")?.content, "authoritative content");
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
        }]);
        assert.equal(display[2].content, "working");
        assert.equal(display[3].content, "Done");
    });

    it("keeps content from multiple recovered tool rounds visible", () => {
        const display = buildAgentPresentationEntries([
            {id: "user-1", type: "user", content: "work"},
            {
                id: "assistant-1",
                type: "assistant",
                roundID: "round-1",
                content: "Checking settings",
                reasoningContent: "reasoning one",
                toolCalls: [{name: "file"}],
            },
            {
                id: "assistant-2",
                type: "assistant",
                roundID: "round-2",
                reasoningContent: "reasoning two",
                toolCalls: [{name: "file"}],
            },
            {
                id: "assistant-3",
                type: "assistant",
                roundID: "round-3",
                content: "Checking plugin configuration",
                reasoningContent: "reasoning three",
                toolCalls: [{name: "file"}],
            },
        ]);

        assert.deepEqual(display.map(entry => entry.id || entry.type), [
            "user-1", "thinking", "assistant-1", "thinking", "assistant-2", "assistant-3",
        ]);
        assert.deepEqual(display.filter(entry => entry.type === "thinking")
            .map(entry => entry.steps?.map(step => step.roundID)), [["round-1"], ["round-2", "round-3"]]);
        assert.deepEqual(display.filter(entry => entry.type === "assistant" && entry.content?.trim())
            .map(entry => entry.content), ["Checking settings", "Checking plugin configuration"]);
    });

    it("keeps recovered thinking paired after an earlier question continuation", () => {
        const display = buildAgentPresentationEntries([
            {id: "user-1", type: "user", content: "search"},
            {
                id: "thinking-old",
                type: "thinking",
                steps: [{roundID: "old-round", reasoningContent: "old reasoning"}],
            },
            {id: "question-1", type: "question", roundID: "old-round"},
            {
                id: "assistant-0",
                type: "assistant",
                roundID: "new-round-0",
                reasoningContent: "first reasoning",
                toolCalls: [{name: "search"}],
            },
            {
                id: "assistant-1",
                type: "assistant",
                roundID: "new-round-1",
                content: "First update",
                reasoningContent: "second reasoning",
                toolCalls: [{name: "search"}],
            },
            {
                id: "assistant-2",
                type: "assistant",
                roundID: "new-round-2",
                reasoningContent: "third reasoning",
                toolCalls: [{name: "document"}],
            },
            {
                id: "assistant-3",
                type: "assistant",
                roundID: "new-round-3",
                content: "Second update",
                reasoningContent: "fourth reasoning",
                toolCalls: [{name: "document"}],
            },
        ]);

        assert.deepEqual(display.map(entry => entry.id || entry.type), [
            "user-1", "thinking-old", "question-1", "thinking", "assistant-0", "assistant-1",
            "thinking", "assistant-2", "assistant-3",
        ]);
        assert.deepEqual(display.filter(entry => entry.type === "thinking")
            .map(entry => entry.steps?.map(step => step.roundID)), [
            ["old-round"], ["new-round-0", "new-round-1"], ["new-round-2", "new-round-3"],
        ]);
    });

    it("removes empty thinking steps split by confirmations and snapshots", () => {
        const display = buildAgentPresentationEntries([
            {id: "user-1", type: "user", content: "write"},
            {
                id: "thinking-visible-1",
                type: "thinking",
                steps: [{roundID: "round-1", reasoningContent: "create note", toolNames: ["dailynote"]}],
            },
            {id: "confirm-1", type: "confirm"},
            {id: "snapshot-1", type: "snapshot", roundID: "round-1"},
            {
                id: "thinking-empty-1",
                type: "thinking",
                steps: [{roundID: "round-1", reasoning: "processing"}],
            },
            {
                id: "thinking-visible-2",
                type: "thinking",
                steps: [
                    {roundID: "round-2", reasoning: "processing", toolNames: ["dailynote"]},
                    {roundID: "round-2", reasoning: "processing"},
                ],
            },
            {id: "confirm-2", type: "confirm"},
            {
                id: "thinking-empty-2",
                type: "thinking",
                steps: [
                    {roundID: "round-2", reasoning: "processing"},
                    {roundID: "round-3", reasoning: "processing"},
                ],
            },
            {
                id: "assistant-1",
                type: "assistant",
                roundID: "round-1",
                reasoningContent: "create note",
                toolCalls: [{name: "dailynote"}],
            },
            {
                id: "assistant-2",
                type: "assistant",
                roundID: "round-2",
                toolCalls: [{name: "dailynote"}],
            },
            {id: "assistant-3", type: "assistant", roundID: "round-3", content: "Done"},
        ]);

        assert.equal(display.some(entry => entry.id === "thinking-empty-1"), false);
        assert.equal(display.some(entry => entry.id === "thinking-empty-2"), false);
        assert.equal(display.find(entry => entry.id === "thinking-visible-2")?.steps?.length, 1);
        assert.equal(display.filter(entry => entry.type === "thinking")
            .flatMap(entry => entry.steps || []).every(hasAgentThinkingStepDetails), true);
        assert.equal(display.find(entry => entry.id === "assistant-3")?.content, "Done");
    });

    it("places tool-round content before the next thinking card", () => {
        const display = buildAgentPresentationEntries([
            {id: "user-1", type: "user", content: "work"},
            {
                id: "thinking-1",
                type: "thinking",
                steps: [{roundID: "round-1", reasoningContent: "reasoning one", toolNames: ["file"]}],
            },
            {
                id: "thinking-2",
                type: "thinking",
                steps: [{roundID: "round-2", reasoningContent: "reasoning two", toolNames: ["file"]}],
            },
            {
                id: "assistant-1",
                type: "assistant",
                roundID: "round-1",
                content: "First progress update",
                toolCalls: [{name: "file"}],
            },
            {
                id: "assistant-2",
                type: "assistant",
                roundID: "round-2",
                content: "Second progress update",
                toolCalls: [{name: "file"}],
            },
        ]);

        assert.deepEqual(display.map(entry => entry.id), [
            "user-1", "thinking-1", "assistant-1", "thinking-2", "assistant-2",
        ]);
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
            reasoningContent: "authoritative reasoning",
            roundID: "round-1",
            toolNames: ["block"],
        });
        assert.deepEqual(display[3].steps, [{
            reasoning: "processing",
            reasoningContent: "final reasoning",
            roundID: "round-2",
            toolNames: undefined,
        }]);
        assert.equal(display[2].content, "working");
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
        assert.equal(display.find(entry => entry.roundID === "round-1")?.content, "recovered middle");
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
            {
                id: "thinking-2",
                type: "thinking",
                steps: [{roundID: "round-1", reasoningContent: "continue"}],
            },
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
