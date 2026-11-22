import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isClassDeclaration, ScriptTarget, transpileModule} from "typescript";
import type {AgentComposerData} from "./AgentComposer";
import {AgentMessageQueue} from "./AgentMessageQueue";

const source = createSourceFile("AgentChat.ts", readFileSync("src/layout/dock/agent/AgentChat.ts", "utf8"),
    ScriptTarget.Latest, true);
const declaration = source.statements.find(item => isClassDeclaration(item) && item.name?.text === "AgentChat");
assert.ok(declaration && isClassDeclaration(declaration));
const methods = ["sendMessage", "sendQueuedMessage"].map(name => {
    const method = declaration.members.find(item => item.name?.getText(source) === name);
    assert.ok(method);
    return method.getText(source);
});
const compiled = transpileModule(`class Chat { ${methods.join("\n")} } globalThis.Chat = Chat;`, {
    compilerOptions: {target: ScriptTarget.ES2021},
}).outputText;

class SessionRevisionConflict extends Error {}

const createChat = () => {
    const events: string[] = [];
    const sent: string[] = [];
    const context: any = {
        window: {siyuan: {config: {appearance: {lang: "en_US"}}}},
        listCapabilityManifests: (): [] => [],
        SessionStore: {newSessionId: () => "entry", getRevision: () => 1},
        SessionRevisionConflict,
        fetchAgentSSE: async (text: string) => { events.push("send"); sent.push(text); },
    };
    runInNewContext(compiled, context);
    const chat = Object.assign(new context.Chat(), {
        composer: {
            isUploading: () => false,
            getSendData: (): AgentComposerData => ({text: "Message", blockHTML: "<p>Message</p>", references: []}),
            clear: () => events.push("clear"),
            pushHistory: () => {},
        },
        composerResize: {reset: () => events.push("reset")},
        captureEditorContext: (): undefined => undefined,
        isCurrentSessionRunning: () => false,
        sessionId: "session",
        queuedMessages: new AgentMessageQueue(),
        sessionRuns: {get: (): undefined => undefined},
        updateSendButtonState: () => {},
        modelOptions: [{id: "model"}],
        prepareForNewTurn: async () => true,
        setStreaming: () => {},
        clearThinking: () => {},
        getSelectedModel: () => "model",
        entries: [],
        messagesContainer: {innerHTML: ""},
        appendUserMessage: () => {},
        rebuildNavMarkers: () => {},
        tryGenerateTitle: () => {},
        saveSession: async () => {},
        runController: {
            begin: () => ({sessionID: "session", controller: new AbortController()}),
            finish: async () => events.push("finish"),
        },
    });
    return {chat, events, sent};
};

test("sending a new message resets composer height after clearing and before starting the response", async () => {
    const {chat, events, sent} = createChat();
    await chat.sendMessage();
    assert.deepEqual(events, ["clear", "reset", "send", "finish"]);
    assert.deepEqual(sent, ["Message"]);
    assert.equal(chat.entries[0].content, "Message");
});

test("rejected sends preserve the current draft and its manually selected height", async () => {
    const cases = [
        (chat: any) => { chat.composer.isUploading = () => true; },
        (chat: any) => { chat.composer.getSendData = (): AgentComposerData => ({text: "", blockHTML: "", references: []}); },
        (chat: any) => { chat.isCurrentSessionRunning = () => true; },
        (chat: any) => { chat.modelOptions = []; },
        (chat: any) => { chat.prepareForNewTurn = async () => false; },
    ];
    for (const configure of cases) {
        const {chat, events, sent} = createChat();
        configure(chat);
        await chat.sendMessage();
        assert.deepEqual(events, []);
        assert.deepEqual(sent, []);
        assert.equal(chat.entries.length, 0);
    }
});

test("a send rejected by a revision conflict preserves both the failed message and any newer draft", async () => {
    for (const newerDraft of [false, true]) {
        const {chat, sent} = createChat();
        let draft = chat.composer.getSendData();
        const original = draft;
        const conflict = new SessionRevisionConflict("agent session revision conflict");
        chat.composer.getSendData = () => draft;
        chat.composer.clear = () => { draft = {text: "", blockHTML: "", references: []}; };
        chat.composer.setData = (value: AgentComposerData) => { draft = value; };
        chat.runController.discard = () => {};
        chat.rollbackUserEntry = () => { chat.entries = []; };
        chat.saveSession = async () => {
            if (newerDraft) draft = {text: "Newer draft", blockHTML: "", references: []};
            throw conflict;
        };
        let recovered: unknown;
        chat.reloadFromDisk = async (_force: boolean, error: unknown) => { recovered = error; };
        await chat.sendMessage();
        assert.equal(recovered, conflict);
        assert.deepEqual(sent, []);
        assert.equal(chat.entries.length, 0);
        if (newerDraft) {
            assert.equal(draft.text, "Newer draft");
            assert.equal(chat.queuedMessages.get("session")[0].data, original);
            assert.equal(chat.queuedMessages.isPaused("session"), true);
        } else {
            assert.equal(draft, original);
        }
    }
});

test("local desktop and mobile runs queue messages without starting another request", async () => {
    for (const mobile of [false, true]) {
        const {chat, events, sent} = createChat();
        chat.host = {mobile};
        chat.isCurrentSessionRunning = () => true;
        chat.sessionRuns.get = () => ({sessionID: "session"});
        const editorContext = {documentID: "document", selectedBlockIDs: ["block"]};
        chat.captureEditorContext = () => editorContext;
        await chat.sendMessage();
        assert.deepEqual(events, ["clear", "reset"]);
        assert.deepEqual(sent, []);
        assert.equal(chat.entries.length, 0);
        const queued = chat.queuedMessages.get("session");
        assert.equal(queued.length, 1);
        assert.equal(queued[0].data.text, "Message");
        assert.equal(queued[0].data.blockHTML, "<p>Message</p>");
        assert.equal(queued[0].editorContext, editorContext);
    }
});

test("sending a queued snapshot preserves a new composer draft", async () => {
    const {chat, events, sent} = createChat();
    chat.queuedMessages.add("session", {
        id: "queued", sessionID: "session",
        data: {text: "Queued message", blockHTML: "<p>Queued</p>", references: [{id: "block", title: "Block"}]},
    });
    await chat.sendQueuedMessage();
    assert.deepEqual(events, ["send", "finish"]);
    assert.deepEqual(sent, ["Queued message"]);
    assert.equal(chat.queuedMessages.get("session").length, 0);
    assert.equal(chat.composer.getSendData().text, "Message");
    assert.equal(chat.entries[0].references[0].id, "block");
});

test("queued sends wait for the local stream and never send into another session", async () => {
    const {chat, sent} = createChat();
    const message: {id: string; sessionID: string; data: AgentComposerData} = {
        id: "queued", sessionID: "session", data: {text: "Queued", blockHTML: "", references: []},
    };
    chat.queuedMessages.add("session", message);
    chat.isCurrentSessionRunning = () => true;
    await chat.sendQueuedMessage();
    assert.deepEqual(sent, []);
    chat.isCurrentSessionRunning = () => false;
    chat.prepareForNewTurn = async () => { chat.sessionId = "other"; return true; };
    await chat.sendQueuedMessage();
    assert.deepEqual(sent, []);
    assert.equal(chat.queuedMessages.get("session")[0], message);
});

test("canceling a queued message during preparation prevents its request", async () => {
    const {chat, sent} = createChat();
    chat.queuedMessages.add("session", {id: "queued", sessionID: "session",
        data: {text: "Queued", blockHTML: "", references: []}});
    chat.prepareForNewTurn = async () => { chat.queuedMessages.remove("session", "queued"); return true; };
    await chat.sendQueuedMessage();
    assert.deepEqual(sent, []);
    assert.equal(chat.entries.length, 0);
});

test("a failed queued-message save preserves its position for manual retry", async () => {
    const {chat, sent} = createChat();
    const first: {id: string; sessionID: string; data: AgentComposerData} = {
        id: "first", sessionID: "session", data: {text: "First", blockHTML: "", references: []},
    };
    chat.queuedMessages.add("session", first);
    chat.queuedMessages.add("session", {id: "second", sessionID: "session", data: {text: "Second", blockHTML: "", references: []}});
    chat.saveSession = async () => { throw new Error("save failed"); };
    chat.runController.discard = () => {};
    chat.rollbackUserEntry = () => {};
    chat.reloadFromDisk = async () => {};
    await chat.sendQueuedMessage();
    assert.deepEqual(sent, []);
    assert.deepEqual(chat.queuedMessages.get("session").map((message: {id: string}) => message.id), ["first", "second"]);
});

test("overlapping send attempts cannot duplicate a message during preparation", async () => {
    const {chat, sent} = createChat();
    let resolve: (prepared: boolean) => void;
    chat.prepareForNewTurn = () => new Promise<boolean>(done => { resolve = done; });
    const first = chat.sendMessage();
    await chat.sendMessage();
    resolve(true);
    await first;
    assert.deepEqual(sent, ["Message"]);
});

test("paused queues require explicit resumption and do not run another session's messages", async () => {
    const {chat, sent} = createChat();
    chat.queuedMessages.add("session", {id: "queued", sessionID: "session",
        data: {text: "Queued", blockHTML: "", references: []}});
    chat.queuedMessages.pause("session");
    await chat.sendQueuedMessage();
    assert.deepEqual(sent, []);
    chat.sessionId = "other";
    await chat.sendQueuedMessage(true);
    assert.deepEqual(sent, []);
    chat.sessionId = "session";
    await chat.sendQueuedMessage(true);
    assert.deepEqual(sent, ["Queued"]);
});

test("draft edits made while preparing a turn remain in the composer", async () => {
    const {chat, events, sent} = createChat();
    chat.prepareForNewTurn = async () => {
        chat.composer.getSendData = (): AgentComposerData => ({text: "Next draft", blockHTML: "<p>Next</p>", references: []});
        return true;
    };
    await chat.sendMessage();
    assert.deepEqual(sent, ["Message"]);
    assert.deepEqual(events, ["send", "finish"]);
    assert.equal(chat.composer.getSendData().text, "Next draft");
});

test("a view change or a queue pause during preparation cancels dispatch", async () => {
    for (const changeView of [false, true]) {
        const {chat, sent} = createChat();
        chat.queuedMessages.add("session", {id: "queued", sessionID: "session",
            data: {text: "Queued", blockHTML: "", references: []}});
        chat.prepareForNewTurn = async () => {
            if (changeView) chat.sessionViewChange = Promise.resolve();
            else chat.queuedMessages.pause("session");
            return true;
        };
        await chat.sendQueuedMessage();
        assert.deepEqual(sent, []);
        assert.equal(chat.queuedMessages.get("session").length, 1);
    }
});

test("destroying the chat prevents queued work from starting after the active response", async () => {
    const {chat, sent} = createChat();
    chat.queuedMessages.add("session", {id: "queued", sessionID: "session",
        data: {text: "Queued", blockHTML: "", references: []}});
    chat.destroyed = true;
    await chat.sendQueuedMessage(true);
    await chat.sendMessage();
    assert.deepEqual(sent, []);
});

test("an initial save failure pauses messages queued while that save was pending", async () => {
    const {chat, sent} = createChat();
    let running = false;
    let failSave: () => void;
    let markStarted: () => void;
    const started = new Promise<void>(resolve => { markStarted = resolve; });
    chat.setStreaming = (value: boolean) => { running = value; };
    chat.isCurrentSessionRunning = () => running;
    chat.sessionRuns.get = () => running ? {sessionID: "session"} : undefined;
    chat.saveSession = () => {
        markStarted();
        return new Promise<void>((_resolve, reject) => {
            failSave = () => reject(new Error("save failed"));
        });
    };
    chat.runController.discard = () => { running = false; };
    chat.rollbackUserEntry = () => {};
    chat.reloadFromDisk = async () => {};
    const sending = chat.sendMessage();
    await started;
    await chat.sendMessage();
    failSave();
    await sending;
    assert.deepEqual(sent, []);
    assert.equal(chat.queuedMessages.get("session").length, 1);
    assert.equal(chat.queuedMessages.isPaused("session"), true);
});
