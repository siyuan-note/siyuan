import {AgentRunController} from "./AgentRunController";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {AgentSessionRuns} from "./AgentSessionRuns";
import type {AgentSession} from "./SessionStore";

const compiled = transpileModule(readFileSync("src/layout/dock/agent/AgentChat.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const createChat = (load: (id: string) => Promise<AgentSession>) => {
    const exports = {} as {AgentChat: {prototype: object}};
    runInNewContext(compiled, {
        exports,
        require: () => ({AgentRunController, Model: class {}, SessionStore: {load}}),
        window: {
            siyuan: {languages: {}},
            setTimeout: (callback: () => void) => { queueMicrotask(callback); return 1; },
            clearTimeout: (): void => undefined,
        },
        document: {hasFocus: () => true},
        console,
    });
    const chat = Object.create(exports.AgentChat.prototype);
    const classList = {add: (): void => undefined, remove: (): void => undefined, toggle: (): void => undefined};
    const attributes = new Set<string>();
    Object.assign(chat, {
        sessionId: "second",
        sessionRuns: new AgentSessionRuns(),
        isStreaming: true,
        mirrorLocked: false,
        pendingRecoverySessionIDs: new Set(),
        recoveryInFlightSessionIDs: new Set(),
        recoveryCommitTurnIDs: new Map(),
        pendingSessionTitles: new Map(),
        scrollBottomBySession: new Map(),
        host: {},
        messagesContainer: {
            classList,
            scrollTop: 0,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
            querySelectorAll: () => [],
        },
        titleElement: {},
        sendBtn: {
            classList,
            setAttribute: (name: string) => attributes.add(name),
            removeAttribute: (name: string) => attributes.delete(name),
        },
        stopBtn: {classList},
        composerHost: {classList},
        modelOptions: [{id: "model"}],
        entries: [],
        defaultTitle: "Agent",
        buildEntriesFromSession: (session: AgentSession) => session.entries || [],
        hasComposerInput: () => true,
        isScrolledToBottom: () => true,
    });
    for (const method of ["destroyEditingComposer", "flushTokenUpdate", "cancelTokenUpdate",
        "updateHostRunStatus", "prepareRunViewForDetach", "captureRunView", "captureRunViewState", "renderLoadedSession",
        "rebuildNavMarkers", "scrollToBottom", "removeMirrorPlaceholder", "showMirrorPlaceholder",
        "applyPermissionMode", "applySessionModelIfValid", "updateTokenDisplay", "finishActiveThinking",
        "clearThinking", "observeStickTarget", "flushThinkingStep"]) {
        chat[method] = (): void => undefined;
    }
    return {chat, attributes};
};

const session = (overrides: Partial<AgentSession> = {}): AgentSession => ({
    id: "first",
    title: "First",
    entries: [{id: "snapshot", type: "snapshot", snapshotID: "snapshot-id"}],
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
});

test("a background turn ending during a session switch releases the stale mirror lock after recovery", async () => {
    let loads = 0;
    let commits = 0;
    const {chat, attributes} = createChat(async () => {
        loads++;
        if (loads === 1) {
            await chat.runController.finish(firstRun);
            return session({agentRunning: true});
        }
        return session({recoveryTurnID: "first-turn", recoveryState: "finished"});
    });
    const firstRun = chat.sessionRuns.begin("first");
    firstRun.turnID = "first-turn";
    chat.sessionRuns.detach("first");
    const secondRun = chat.sessionRuns.begin("second");
    chat.abortController = secondRun.controller;
    chat.saveSession = async (): Promise<null> => { commits++; return null; };
    let recovery: Promise<void>;
    const recover = chat.recoverInterruptedTurn.bind(chat);
    chat.recoverInterruptedTurn = (...args: unknown[]) => {
        recovery = recover(...args);
        return recovery;
    };

    await chat.performSwitchSession("first");
    await recovery;

    assert.equal(commits, 1);
    assert.equal(chat.pendingRecoverySessionIDs.has("first"), false);
    assert.equal(chat.mirrorLocked, false);
    assert.equal(chat.isCurrentSessionRunning(), false);
    assert.equal(attributes.has("disabled"), false);
    assert.equal(await chat.prepareForNewTurn(), true);
    assert.equal(chat.sessionRuns.get("second"), secondRun);
    assert.equal(secondRun.controller.signal.aborted, false);
});

test("recovery unlocks a completed session whose turn was already committed", async () => {
    const {chat, attributes} = createChat(async () => session());
    chat.sessionId = "first";
    chat.isStreaming = false;
    chat.mirrorLocked = true;
    chat.currentTurnID = "first-turn";
    chat.updateSendButtonState();
    assert.equal(attributes.has("disabled"), true);

    await chat.recoverInterruptedTurn("first", "first-turn");

    assert.equal(chat.mirrorLocked, false);
    assert.equal(chat.currentTurnID, "");
    assert.equal(attributes.has("disabled"), false);
});

test("authoritative reload keeps another instance's active session locked", async () => {
    const {chat, attributes} = createChat(async () => session({agentRunning: true}));
    chat.sessionId = "first";
    chat.isStreaming = false;
    chat.mirrorLocked = true;
    chat.updateSendButtonState();

    await chat.reloadFromDisk(true);

    assert.equal(chat.mirrorLocked, true);
    assert.equal(chat.isCurrentSessionRunning(), true);
    assert.equal(attributes.has("disabled"), true);
});

test("a completed background turn does not change the foreground stream or its controller", async () => {
    const {chat} = createChat(async () => session());
    const firstRun = chat.sessionRuns.begin("first");
    chat.sessionRuns.detach("first");
    const secondRun = chat.sessionRuns.begin("second");
    chat.abortController = secondRun.controller;
    chat.currentThinkingReasoningContent = "second session reasoning";

    await chat.runController.handleEvent(firstRun, {type: "snapshot", snapshotID: "snapshot-id"});
    await chat.runController.handleEvent(firstRun, {type: "done", turnID: "first-turn"});

    await chat.runController.finish(firstRun);

    assert.equal(chat.isStreaming, true);
    assert.equal(chat.abortController, secondRun.controller);
    assert.equal(secondRun.controller.signal.aborted, false);
    assert.equal(chat.sessionRuns.resolveStatus("second"), "running");
    assert.equal(chat.currentThinkingReasoningContent, "second session reasoning");
    assert.deepEqual(firstRun.pendingEvents.map((event: {type: string}) => event.type), ["snapshot", "done"]);
});

test("a local stream uses its own run instead of acquiring a mirror lock", () => {
    const {chat} = createChat(async () => session());
    chat.sessionId = "first";
    const run = chat.sessionRuns.begin("first");
    chat.abortController = run.controller;

    chat.updateMetaFromSession(session({agentRunning: true}));

    assert.equal(chat.mirrorLocked, false);
    assert.equal(chat.isStreaming, true);
    assert.equal(chat.abortController, run.controller);
});

test("a late recovery read cannot unlock or commit a different foreground session", async () => {
    const {chat} = createChat(async () => {
        chat.sessionId = "second";
        chat.mirrorLocked = true;
        return session({recoveryTurnID: "first-turn", recoveryState: "finished"});
    });
    chat.sessionId = "first";
    chat.isStreaming = false;
    chat.saveSession = async () => assert.fail("the recovery must not save another session");

    await chat.recoverInterruptedTurn("first", "first-turn");

    assert.equal(chat.mirrorLocked, true);
    assert.equal(chat.pendingRecoverySessionIDs.has("first"), true);
});
