import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isClassDeclaration, ScriptTarget, transpileModule} from "typescript";
import type {AgentComposerData} from "./AgentComposer";

const source = createSourceFile("AgentChat.ts", readFileSync("src/layout/dock/agent/AgentChat.ts", "utf8"),
    ScriptTarget.Latest, true);
const declaration = source.statements.find(item => isClassDeclaration(item) && item.name?.text === "AgentChat");
assert.ok(declaration && isClassDeclaration(declaration));
const method = declaration.members.find(item => item.name?.getText(source) === "sendMessage");
assert.ok(method);
const compiled = transpileModule(`class Chat { ${method.getText(source)} } globalThis.Chat = Chat;`, {
    compilerOptions: {target: ScriptTarget.ES2021},
}).outputText;

const createChat = () => {
    const events: string[] = [];
    const sent: string[] = [];
    const context: any = {
        window: {siyuan: {config: {appearance: {lang: "en_US"}}}},
        listCapabilityManifests: (): [] => [],
        SessionStore: {newSessionId: () => "entry", getRevision: () => 1},
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
