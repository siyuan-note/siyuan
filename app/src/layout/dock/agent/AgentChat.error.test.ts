import {AgentRunController} from "./AgentRunController";
import type {AgentComposerData} from "./AgentComposer";
import {findAgentUserEntryIndex} from "./AgentHistory";
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
    class Element {
        className = "";
        innerHTML = "";
        textContent = "";
        children: Element[] = [];
        handlers = new Map<string, () => void>();
        remove = () => elements.splice(elements.indexOf(this), 1);
        append = (...children: Element[]) => this.children.push(...children);
        appendChild = (element: Element) => this.append(element);
        replaceChildren = (...children: Element[]) => { this.children = children; };
        addEventListener = (type: string, handler: () => void) => this.handlers.set(type, handler);
    }
    const elements: Element[] = [];
    const notices: string[] = [];
    const exports = {} as {AgentChat: {prototype: object}};
    runInNewContext(compiled, {
        exports,
        require: () => ({
            AgentRunController,
            findAgentUserEntryIndex,
            Model: class {},
            SessionStore: {load: async (id: string) => sessions.get(id)},
            buildAgentPresentationEntries: (entries: unknown[]) => entries,
            isAgentAssistantContentFinalInTurn: () => false,
            escapeHtml: (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;"),
            showMessage: (message: string) => notices.push(message),
        }),
        window: {setTimeout: (callback: () => void) => callback(), siyuan: {languages: {
            agentSnapshotWriteBlocked: "This workspace write was not performed",
            agentRestoreDraft: "Restore draft",
            agentRestoreDraftInUse: "Clear the current draft before restoring",
            agentNotificationExpired: "Confirmation expired",
        }}},
        document: {createElement: () => new Element()},
        CSS: {escape: (id: string) => id},
    });
    const chat = Object.create(exports.AgentChat.prototype);
    Object.assign(chat, {
        sessionId: "first",
        entries: sessions.get("first").entries,
        sessionErrors: new Map(),
        mirrorLocked: false,
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
        sessionRuns: {begin: () => ({controller: {}}), markRead: (): undefined => undefined, get: (): undefined => undefined},
        isScrolledToBottom: () => true,
    });
    for (const method of ["finishActiveThinking", "clearThinking", "scrollToBottom", "flushThinkingStep",
        "observeStickTarget", "updateMetaFromSession", "destroyEditingComposer", "appendUserMessage",
        "appendPersistedAssistant", "rebuildNavMarkers", "removeMirrorPlaceholder", "updateHostRunStatus",
        "updateSendButtonState"]) {
        chat[method] = (): void => undefined;
    }
    return {chat, sessions, elements, notices, Element};
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
    chat.runController.begin();
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

test("snapshot failure expires only pending confirmations and restores the original rich draft without sending", async () => {
    const {chat, sessions, elements, notices, Element} = createChat();
    const user = sessions.get("first").entries[0];
    const richDraft = {
        text: user.content,
        blockHTML: '<span data-type="block-ref" data-id="20261122000000-abcdefg">Reference</span><img src="assets/draft.png">',
        references: [{id: "20261122000000-abcdefg", title: "Reference"}],
    };
    Object.assign(user, {blockHTML: richDraft.blockHTML, references: richDraft.references});
    const historical = {id: "old", type: "confirm", status: "pending"};
    const approved = {id: "approved", type: "confirm", status: "approved"};
    const pending = {id: "pending", type: "confirm", status: "pending"};
    chat.entries = [historical, user, approved];
    chat.pendingConfirms = [pending];
    const actions = new Element();
    actions.append(new Element());
    chat.messagesContainer.querySelector = (selector: string) => {
        assert.equal(selector, '[data-message-id="pending"]');
        return {querySelector: () => actions};
    };
    chat.queuedMessages = {pause: (id: string) => assert.equal(id, "first")};
    chat.flushTokenUpdate = (): void => undefined;
    chat.finishResponse = async (normal: boolean) => {
        assert.equal(normal, false);
        assert.equal(pending.status, "expired");
    };
    chat.currentTurnID = "snapshot-failure";
    let draft: AgentComposerData = {text: "unsent edit", blockHTML: "", references: []};
    let runs = 0;
    chat.startResponse = () => { runs++; };
    chat.composer = {
        getSendData: () => draft,
        isUploading: () => false,
        setData: (data: typeof draft) => { draft = data; },
        focus: (end: boolean) => assert.ok(end),
    };
    await chat.handleSSEEvent({type: "error", message: "unable to snapshot", snapshotFailed: true});
    assert.equal(historical.status, "pending");
    assert.equal(approved.status, "approved");
    assert.equal(actions.children[0].textContent, "Confirmation expired");
    assert.equal(elements[0].children[0].children[0].textContent, "This workspace write was not performed");
    const restore = elements[0].children[0].children[1].handlers.get("click");
    restore();
    assert.equal(draft.text, "unsent edit");
    assert.deepEqual(notices, ["Clear the current draft before restoring"]);
    draft = {text: "", blockHTML: "", references: []};
    restore();
    assert.equal(draft.text, richDraft.text);
    assert.equal(draft.blockHTML, richDraft.blockHTML);
    assert.equal(draft.references, richDraft.references);
    assert.equal(runs, 0);
});
