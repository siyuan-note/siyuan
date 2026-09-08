import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compiled = transpileModule(readFileSync("src/layout/dock/agent/AgentChat.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const createChat = () => {
    const sessions = new Map([
        ["first", {id: "first", entries: [{type: "user", id: "user-first", content: "continue"}]}],
        ["second", {id: "second", entries: [{type: "user", id: "user-second", content: "continue"}]}],
    ]);
    const elements: {className: string; innerHTML: string; remove: () => void}[] = [];
    const exports = {} as {AgentChat: {prototype: object}};
    runInNewContext(compiled, {
        exports,
        require: () => ({
            Model: class {},
            SessionStore: {load: async (id: string) => sessions.get(id)},
            buildAgentPresentationEntries: (entries: unknown[]) => entries,
            isAgentAssistantContentFinalInTurn: () => false,
            escapeHtml: (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;"),
        }),
        window: {setTimeout: (callback: () => void) => callback()},
        document: {
            createElement: () => {
                const element = {
                    className: "",
                    innerHTML: "",
                    remove: () => elements.splice(elements.indexOf(element), 1),
                };
                return element;
            },
        },
    });
    const chat = Object.create(exports.AgentChat.prototype);
    Object.assign(chat, {
        sessionId: "first",
        entries: sessions.get("first").entries,
        sessionErrors: new Map(),
        pendingRecoverySessionIDs: new Set(),
        recoveryInFlightSessionIDs: new Set(),
        recoveryCommitTurnIDs: new Map(),
        messagesContainer: {
            scrollTop: 0,
            set innerHTML(_value: string) {
                elements.length = 0;
            },
            appendChild: (element: typeof elements[number]) => elements.push(element),
            querySelectorAll: () => elements.filter(element => element.className.includes("agent-chat__msg--error")),
        },
        sessionRuns: {begin: () => ({controller: {}}), markRead: () => undefined},
        isScrolledToBottom: () => true,
    });
    for (const method of ["finishActiveThinking", "clearThinking", "scrollToBottom", "flushThinkingStep",
        "observeStickTarget", "updateMetaFromSession", "destroyEditingComposer", "appendUserMessage",
        "appendPersistedAssistant", "rebuildNavMarkers", "removeMirrorPlaceholder", "updateHostRunStatus",
        "updateSendButtonState"]) {
        chat[method] = (): void => undefined;
    }
    return {chat, sessions, elements};
};

test("interruption handling keeps the error after the recovered turn is committed", async () => {
    const {chat, sessions, elements} = createChat();
    Object.assign(sessions.get("first"), {recoveryTurnID: "interrupted-turn"});
    chat.currentTurnID = "interrupted-turn";
    chat.flushTokenUpdate = (): void => undefined;
    chat.setStreaming = (streaming: boolean) => chat.isStreaming = streaming;
    chat.updateMetaFromSession = (session: {id: string; recoveryTurnID: string}) => {
        chat.recoveryCommitTurnIDs.set(session.id, session.recoveryTurnID);
    };
    let commits = 0;
    chat.saveSession = async () => { commits++; };

    await chat.handleError(new Error("Session time limit reached"));
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(commits, 1);
    assert.equal(chat.pendingRecoverySessionIDs.size, 0);
    assert.equal(elements.length, 1);
    assert.match(elements[0].innerHTML, /Session time limit reached/);
});

test("stream errors survive repeated recovery redraws without entering conversation history", async () => {
    const {chat, sessions, elements} = createChat();
    chat.appendError("Session time limit reached <retry>");
    const entries = sessions.get("first").entries;
    entries.push({type: "assistant", id: "partial", content: "unfinished response"});

    await chat.reloadFromDisk(true);
    await chat.reloadFromDisk(true);

    assert.equal(elements.length, 1);
    assert.match(elements[0].innerHTML, /Session time limit reached &lt;retry>/);
    assert.deepEqual(chat.entries, entries);
    assert.equal(chat.entries.some((entry: {type: string}) => entry.type === "error"), false);
});

test("recovery errors remain scoped to their session when switching views", async () => {
    const {chat, elements} = createChat();
    chat.appendError("First session timed out");
    chat.sessionId = "second";
    await chat.reloadFromDisk(true);
    assert.equal(elements.length, 0);

    chat.appendError("Second session disconnected");
    chat.sessionId = "first";
    await chat.reloadFromDisk(true);
    assert.equal(elements.length, 1);
    assert.match(elements[0].innerHTML, /First session timed out/);
});

test("a new run clears the previous interruption even when regenerating the same user turn", async () => {
    const {chat, elements} = createChat();
    chat.appendError("Session timed out");
    chat.beginSessionRun();
    await chat.reloadFromDisk(true);
    assert.equal(elements.length, 0);
    assert.equal(chat.sessionErrors.size, 0);
});

test("a newer user turn loaded from disk does not inherit an earlier error", async () => {
    const {chat, sessions, elements} = createChat();
    chat.appendError("Session timed out");
    sessions.get("first").entries.push({type: "user", id: "new-user", content: "next request"});
    await chat.reloadFromDisk(true);
    assert.equal(elements.length, 0);
    assert.equal(chat.sessionErrors.size, 0);
});
