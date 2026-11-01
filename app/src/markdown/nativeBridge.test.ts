import {test} from "node:test";
import * as assert from "node:assert/strict";
import {createNativeMarkdownBridge} from "./nativeBridge";

test("Android replies match their own request despite out-of-order and duplicate delivery", async () => {
    const sent: Array<{id: string; action: string; payload?: unknown}> = [];
    const native = {postMessage(message: string) { sent.push(JSON.parse(message)); }, onmessage: undefined as (event: {data: string}) => void};
    const bridge = createNativeMarkdownBridge({siyuanMarkdownNative: native});
    const bootstrap = bridge.bootstrap();
    const preferences = bridge.preferences({theme: "dark"});
    assert.deepEqual(sent.map(request => request.action), ["bootstrap", "preferences"]);
    native.onmessage({data: JSON.stringify({type: "reply", id: sent[1].id, result: {theme: "dark"}})});
    native.onmessage({data: JSON.stringify({type: "reply", id: sent[0].id, result: {sessionId: "session"}})});
    native.onmessage({data: JSON.stringify({type: "reply", id: sent[0].id, result: {sessionId: "stale"}})});
    assert.equal((await bootstrap).sessionId, "session");
    assert.equal((await preferences).theme, "dark");
    assert.equal("invoke" in bridge, false);
    assert.equal(Object.isFrozen(bridge.host), true);
});

test("native commands arriving during initialization are delivered and can be unsubscribed", () => {
    const native = {postMessage() {}, onmessage: undefined as (event: {data: string}) => void};
    const bridge = createNativeMarkdownBridge({siyuanMarkdownNative: native});
    native.onmessage({data: JSON.stringify({type: "command", command: {id: "early", type: "close"}})});
    native.onmessage({data: "invalid JSON"});
    native.onmessage({data: JSON.stringify({type: "command", command: {id: "unknown", type: "arbitrary"}})});
    const received: string[] = [];
    const unsubscribe = bridge.onCommand(command => received.push(command.id));
    assert.deepEqual(received, ["early"]);
    unsubscribe();
    native.onmessage({data: JSON.stringify({type: "command", command: {id: "later", type: "close"}})});
    assert.deepEqual(received, ["early"]);
});

test("iOS callbacks reject native errors and preserve the desktop bridge", async () => {
    const requests: Array<{id: string; action: string}> = [];
    const environment = {webkit: {messageHandlers: {siyuanMarkdown: {postMessage(request: {id: string; action: string}) {requests.push(request);}}}},
        __siyuanMarkdownResponse: undefined as (reply: {id: string; result?: unknown; error?: unknown}) => void};
    const bridge = createNativeMarkdownBridge(environment);
    const request = bridge.openDocument();
    environment.__siyuanMarkdownResponse({id: requests[0].id, error: "Permission revoked"});
    await assert.rejects(request, /Permission revoked/);
    const draft = bridge.host.putDraft({sessionId: "test", targetGeneration: 0, operationId: "test:instance:1",
        revision: 1, content: "unsaved", format: {bom: false, newline: "\n"}});
    environment.__siyuanMarkdownResponse({id: requests[1].id, error: {code: "space", recoverable: true}});
    await assert.rejects(draft, /Markdown host request failed/);
    assert.equal(createNativeMarkdownBridge({siyuanMarkdown: bridge}), bridge);
    assert.equal(createNativeMarkdownBridge({}), undefined);
});

test("a new page uses a different request identity and ignores replies for a previous page", async () => {
    const requests: Array<{id: string}> = [];
    const native = {postMessage(message: string) { requests.push(JSON.parse(message)); }, onmessage: undefined as (event: {data: string}) => void};
    const first = createNativeMarkdownBridge({siyuanMarkdownNative: native});
    const original = first.newDocument();
    native.onmessage({data: JSON.stringify({type: "reply", id: requests[0].id})});
    await original;
    const second = createNativeMarkdownBridge({siyuanMarkdownNative: native});
    const current = second.bootstrap();
    assert.notEqual(requests[0].id, requests[1].id);
    native.onmessage({data: JSON.stringify({type: "reply", id: requests[0].id, result: {sessionId: "old"}})});
    native.onmessage({data: JSON.stringify({type: "reply", id: requests[1].id, result: {sessionId: "current"}})});
    assert.equal((await current).sessionId, "current");
});

test("tree operations retain opaque locations and ticket payloads across the native bridge", async () => {
    const sent: Array<{id: string; action: string; payload?: unknown}> = [];
    const native = {postMessage(message: string) {sent.push(JSON.parse(message));}, onmessage: undefined as (event: {data: string}) => void};
    const bridge = createNativeMarkdownBridge({siyuanMarkdownNative: native});
    const location = {rootId: "root", generation: 4, nodeId: "node"};
    const tasks = [bridge.tree.state(), bridge.tree.list(location), bridge.tree.chooseRoot(),
        bridge.tree.saveView({rootId: "root", generation: 4, expanded: ["root"]}), bridge.tree.prepareOpen(location),
        bridge.tree.commitOpen("ticket"), bridge.tree.cancelOpen("unused")];
    assert.deepEqual(sent.map(value => value.action), ["tree-state", "tree-list", "tree-choose-root", "tree-save-view", "tree-prepare-open", "tree-commit-open", "tree-cancel-open"]);
    assert.deepEqual(sent[1].payload, location);
    assert.deepEqual(sent[4].payload, location);
    assert.equal(sent[5].payload, "ticket");
    assert.equal(sent[6].payload, "unused");
    for (const request of sent) native.onmessage({data: JSON.stringify({type: "reply", id: request.id, result: {}})});
    await Promise.all(tasks);
    assert.equal(Object.isFrozen(bridge.tree), true);
    const commands: string[] = [];
    bridge.onCommand(value => commands.push(value.type));
    native.onmessage({data: JSON.stringify({type: "command", command: {type: "tree-change", id: "refresh"}})});
    assert.deepEqual(commands, ["tree-change"]);
});

test("a missing native commit reply times out for safe retry while write requests keep waiting", async context => {
    context.mock.timers.enable({apis: ["setTimeout"]});
    const sent: Array<{id: string; action: string}> = [];
    const native = {postMessage(message: string) {sent.push(JSON.parse(message));}, onmessage: undefined as (event: {data: string}) => void};
    const bridge = createNativeMarkdownBridge({siyuanMarkdownNative: native});
    const commit = bridge.tree.commitOpen("same-ticket");
    const rejected = assert.rejects(commit, /acknowledgement timed out/);
    let writeSettled = false;
    const draft = bridge.host.clearDraft({sessionId: "current", targetGeneration: 0, revision: 0}).then(() => {writeSettled = true;});
    context.mock.timers.tick(5000);
    await rejected;
    const retry = bridge.tree.commitOpen("same-ticket");
    native.onmessage({data: JSON.stringify({type: "reply", id: sent[0].id, result: {sessionId: "late"}})});
    native.onmessage({data: JSON.stringify({type: "reply", id: sent[2].id, result: {sessionId: "confirmed"}})});
    assert.equal((await retry).sessionId, "confirmed");
    context.mock.timers.tick(30000);
    assert.equal(writeSettled, false);
    native.onmessage({data: JSON.stringify({type: "reply", id: sent[1].id})});
    await draft;
    const bootstrap = bridge.bootstrap();
    const bootstrapRejected = assert.rejects(bootstrap, /acknowledgement timed out/);
    context.mock.timers.tick(30000);
    await bootstrapRejected;
});
