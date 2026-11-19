import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isClassDeclaration, ScriptTarget, transpileModule} from "typescript";
import type {AgentNotificationTarget} from "./agentNotificationTarget";

const source = createSourceFile("AgentChat.ts", readFileSync("src/layout/dock/agent/AgentChat.ts", "utf8"), ScriptTarget.Latest, true);
const declaration = source.statements.find(node => isClassDeclaration(node) && node.name?.text === "AgentChat");
assert.ok(declaration && isClassDeclaration(declaration));
const method = declaration.members.find(node => node.name?.getText(source) === "processNotificationNavigation");
assert.ok(method);
const compiled = transpileModule(`class Chat { ${method.getText(source)} } globalThis.Chat = Chat;`, {
    compilerOptions: {target: ScriptTarget.ES2022},
}).outputText;

const target: AgentNotificationTarget = {sessionID: "first", kind: "question", interactionID: "question"};
const fixture = () => {
    const messages: string[] = [], highlights: string[] = [], revealed: string[] = [];
    const context: any = {window: {siyuan: {languages: {agentNotificationExpired: "Expired"}}},
        showMessage: (message: string) => messages.push(message), console};
    runInNewContext(compiled, context);
    const card = {dataset: {agentInteractionId: "question", agentInteractionType: "question"},
        classList: {contains: () => false, add: () => {}}, querySelectorAll: (): [] => []};
    const run = {controller: new AbortController(), pendingInteractions: [{type: "question", questionID: "question"}]};
    const chat = Object.assign(new context.Chat(), {
        sessionId: "second", pendingNotificationTarget: target,
        composer: {isUploading: () => false},
        host: {reveal: () => revealed.push("show")},
        switchSession: async (id: string) => { chat.sessionId = id; },
        sessionRuns: {get: () => run}, runController: {waitForView: async () => {}},
        messagesContainer: {querySelectorAll: () => [card]},
        highlightNotificationCard: (element: typeof card) => highlights.push(element.dataset.agentInteractionId),
        restoreNotificationDraft: () => {},
    });
    return {chat, run, card, messages, highlights, revealed};
};

test("notification clicks select their exact session and live interaction without submitting anything", async () => {
    const f = fixture();
    await f.chat.processNotificationNavigation();
    assert.equal(f.chat.sessionId, "first");
    assert.deepEqual(f.highlights, ["question"]);
    assert.deepEqual(f.messages, []);
    assert.deepEqual(f.revealed, ["show"]);
});

test("handled, missing and mismatched notification targets report expiry", async () => {
    for (const configure of [
        (f: ReturnType<typeof fixture>) => { f.run.pendingInteractions = []; },
        (f: ReturnType<typeof fixture>) => { f.chat.messagesContainer.querySelectorAll = (): [] => []; },
        (f: ReturnType<typeof fixture>) => { f.card.dataset.agentInteractionType = "confirm"; },
        (f: ReturnType<typeof fixture>) => { f.card.classList.contains = () => true; },
        (f: ReturnType<typeof fixture>) => { f.run.controller.abort(); },
        (f: ReturnType<typeof fixture>) => { f.chat.switchSession = async () => {}; },
    ]) {
        const f = fixture(); configure(f);
        await f.chat.processNotificationNavigation();
        assert.deepEqual(f.messages, ["Expired"]);
    }
});

test("uploads defer navigation and destroyed chats ignore later completions", async () => {
    const f = fixture();
    f.chat.composer.isUploading = () => true;
    await f.chat.processNotificationNavigation();
    assert.equal(f.chat.sessionId, "second");
    assert.equal(f.chat.pendingNotificationTarget, target);
    f.chat.composer.isUploading = () => false;
    f.chat.runController.waitForView = async () => { f.chat.destroyed = true; };
    await f.chat.processNotificationNavigation();
    assert.deepEqual(f.highlights, []);
    assert.deepEqual(f.messages, []);
});

test("an expired card is made inert before the status notice is shown", async () => {
    const f = fixture();
    const controls = [{disabled: false}, {disabled: false}];
    f.run.pendingInteractions = [];
    f.chat.messagesContainer.querySelectorAll = () => [{...f.card, querySelectorAll: () => controls}];
    await f.chat.processNotificationNavigation();
    assert.ok(controls.every(control => control.disabled));
    assert.deepEqual(f.messages, ["Expired"]);
});

test("a later click is serialized after the current target finishes restoring", async () => {
    const f = fixture();
    let resume: () => void;
    const waiting = new Promise<void>(resolve => { resume = resolve; });
    f.chat.runController.waitForView = () => waiting;
    const first = f.chat.processNotificationNavigation();
    await Promise.resolve();
    f.chat.pendingNotificationTarget = {...target, sessionID: "third"};
    await f.chat.processNotificationNavigation();
    resume();
    await first;
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(f.chat.sessionId, "third");
    assert.equal(f.chat.pendingNotificationTarget, undefined);
});
