import {test} from "node:test";
import * as assert from "node:assert/strict";
import {createNativeMarkdownBridge} from "./nativeBridge";
import type {MarkdownAppearance, MarkdownIndependentAppearance} from "./bridge";

test("workspace appearance capabilities preserve native sources, independent values and font grants", async () => {
    const sent: Array<{id: string; action: string; payload?: unknown}> = [];
    const native = {postMessage(message: string) {sent.push(JSON.parse(message));}, onmessage: undefined as (event: {data: string}) => void};
    const bridge = createNativeMarkdownBridge({siyuanMarkdownNative: native});
    const reply = (result: unknown) => native.onmessage({data: JSON.stringify({type: "reply", id: sent.at(-1).id, result})});
    const appearance: MarkdownAppearance = {theme: "dark", fontSize: 24, fonts: {global: [], editor: [], code: []},
        independent: {theme: "light", fontSize: 16, fonts: {global: [{family: "Saved", weight: 400}], editor: [], code: []}},
        sources: {theme: "workspace-id", fontSize: "workspace-id", fonts: "independent"},
        workspaces: [{id: "workspace-id", name: "/trusted/workspaces/main"}],
        customFonts: [{family: "SiYuanCustomFont-test", weight: 400, url: "siyuan-markdown://session/appearance-font/token"}]};
    const bootstrap = bridge.bootstrap();
    reply({preferences: {mode: "ir", theme: "system", fontSize: 16}, capabilities: {systemFonts: true, workspaceAppearance: true}, appearance});
    assert.deepEqual((await bootstrap).appearance, appearance);
    const refresh = bridge.appearance();
    assert.equal(sent.at(-1).action, "appearance");
    assert.equal(sent.at(-1).payload, null);
    reply(appearance);
    assert.deepEqual(await refresh, appearance);
    const patch = {sources: {fonts: "workspace-id"}, independent: {fontSize: 20}};
    const save = bridge.appearance(patch);
    assert.equal(sent.at(-1).action, "appearance");
    assert.deepEqual(sent.at(-1).payload, patch);
    const saved = {...appearance, sources: {...appearance.sources, fonts: "workspace-id"}};
    reply(saved);
    assert.deepEqual(await save, saved);
    const failed = bridge.appearance({sources: {fonts: "missing"}});
    const current = sent.at(-1);
    native.onmessage({data: JSON.stringify({type: "reply", id: sent.at(-2).id, result: appearance})});
    native.onmessage({data: JSON.stringify({type: "reply", id: current.id, error: "Unavailable appearance source"})});
    await assert.rejects(failed, /Unavailable appearance source/);
});

test("workspace capability requires a native snapshot and is not inferred from unadvertised data", async () => {
    const sent: Array<{id: string}> = [];
    const native = {postMessage(message: string) {sent.push(JSON.parse(message));}, onmessage: undefined as (event: {data: string}) => void};
    const bridge = createNativeMarkdownBridge({siyuanMarkdownNative: native});
    const failed = bridge.bootstrap();
    native.onmessage({data: JSON.stringify({type: "reply", id: sent.at(-1).id,
        result: {preferences: {}, capabilities: {workspaceAppearance: true}}})});
    await assert.rejects(failed, /Workspace appearance unavailable/);
    const retry = bridge.bootstrap();
    native.onmessage({data: JSON.stringify({type: "reply", id: sent.at(-1).id,
        result: {preferences: {theme: "light"}, capabilities: {systemFonts: true}, appearance: {theme: "dark"}}})});
    assert.equal((await retry).appearance.theme, "light");
    await assert.rejects(bridge.appearance({sources: {theme: "untrusted"}}), /Workspace appearance unavailable/);
});

test("native font capabilities enable independent appearance without inventing workspace access", async () => {
    const sent: Array<{id: string; action: string; payload?: unknown}> = [];
    const native = {postMessage(message: string) {sent.push(JSON.parse(message));}, onmessage: undefined as (event: {data: string}) => void};
    const bridge = createNativeMarkdownBridge({siyuanMarkdownNative: native});
    const reply = (result: unknown) => native.onmessage({data: JSON.stringify({type: "reply", id: sent.at(-1).id, result})});
    const bootstrap = bridge.bootstrap();
    reply({preferences: {mode: "ir", theme: "dark", fontSize: 24}, capabilities: {systemFonts: true}});
    const snapshot = (await bootstrap).appearance;
    assert.equal(snapshot.theme, "dark");
    assert.equal(snapshot.fontSize, 24);
    assert.deepEqual(snapshot.fonts, {global: [], editor: [], code: []});
    assert.deepEqual(snapshot.workspaces, []);
    assert.equal(snapshot.sources.fonts, "independent");
    const fonts: MarkdownIndependentAppearance["fonts"] = {global: [], editor: [{family: "Sans", weight: 700}], code: []};
    const save = bridge.appearance({sources: {fonts: "independent"}, independent: {fonts}});
    assert.equal(sent.at(-1).action, "preferences");
    assert.deepEqual(sent.at(-1).payload, {fonts});
    reply({mode: "ir", theme: "dark", fontSize: 24, fonts});
    assert.deepEqual((await save).fonts, fonts);
    await assert.rejects(bridge.appearance({sources: {fonts: "workspace"}}), /Workspace appearance unavailable/);
    const enumerate = bridge.systemFonts();
    assert.equal(sent.at(-1).action, "system-fonts");
    const result = [{family: "Sans", weight: 700, displayName: "Sans Bold"}];
    reply(result);
    assert.deepEqual(await enumerate, result);
});

test("legacy native hosts retain their existing appearance UI and reject unsupported font enumeration", async () => {
    const sent: Array<{id: string; action: string}> = [];
    const native = {postMessage(message: string) {sent.push(JSON.parse(message));}, onmessage: undefined as (event: {data: string}) => void};
    const bridge = createNativeMarkdownBridge({siyuanMarkdownNative: native});
    const bootstrap = bridge.bootstrap();
    native.onmessage({data: JSON.stringify({type: "reply", id: sent[0].id, result: {preferences: {mode: "ir"}}})});
    assert.equal((await bootstrap).appearance, undefined);
    await assert.rejects(bridge.systemFonts(), /System fonts unavailable/);
    await assert.rejects(bridge.appearance(), /Independent appearance unavailable/);
    assert.equal(sent.length, 1);
});

test("font enumeration timeout permits retry and ignores a late previous response", async context => {
    context.mock.timers.enable({apis: ["setTimeout"]});
    const sent: Array<{id: string; action: string}> = [];
    const native = {postMessage(message: string) {sent.push(JSON.parse(message));}, onmessage: undefined as (event: {data: string}) => void};
    const bridge = createNativeMarkdownBridge({siyuanMarkdownNative: native});
    const bootstrap = bridge.bootstrap();
    native.onmessage({data: JSON.stringify({type: "reply", id: sent[0].id,
        result: {preferences: {mode: "ir"}, capabilities: {systemFonts: true}}})});
    await bootstrap;
    const failed = assert.rejects(bridge.systemFonts(), /acknowledgement timed out/);
    context.mock.timers.tick(30000);
    await failed;
    const retry = bridge.systemFonts();
    native.onmessage({data: JSON.stringify({type: "reply", id: sent[1].id, result: [{family: "Stale"}]})});
    native.onmessage({data: JSON.stringify({type: "reply", id: sent[2].id, result: []})});
    assert.deepEqual(await retry, []);
});

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
