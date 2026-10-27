import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {runInNewContext} from "node:vm";
import {ScriptTarget, transpileModule} from "typescript";
import {isUndoViewportPreserved, preserveUndoViewport} from "./viewport";

const compiled = transpileModule(readFileSync("src/protyle/undo/globalUndo.ts", "utf8")
    .replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, "") +
    ";globalThis.api = {markMirror, getMirror, getUndoStateSnapshot, subscribeUndoState, syncMirrorFromBroadcast, initMirror, requestUndo, requestRedo, focusRootIDs};",
{compilerOptions: {target: ScriptTarget.ES2021}}).outputText;

const load = (extra: Record<string, unknown> = {}) => {
    const context: any = {console, Constants: {SIYUAN_APPID: "test"}, isUndoViewportPreserved,
        getMobileToolbarProtyle: (): undefined => undefined, getCurrentEditor: (): undefined => undefined,
        getSelection: () => ({rangeCount: 0}), waitForPendingTransactions: async () => {}, ...extra};
    runInNewContext(compiled, context);
    return context.api as typeof import("./globalUndo") & {focusRootIDs: (ids: string[], focus?: string) => void};
};
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

test("canvas history does not scroll to an offscreen historical block, while ordinary history still locates it", () => {
    let scrolls = 0;
    const target = {getBoundingClientRect: () => ({top: -300, bottom: -200}), scrollIntoView: () => scrolls++};
    const root = {querySelectorAll: () => [target]} as unknown as Element;
    const owner = {block: {rootID: "doc"}, wysiwyg: {element: root}};
    const api = load({getCurrentEditor: () => ({protyle: owner}), window: {innerHeight: 800},
        getUndoFocusTarget: (targets: unknown[]) => targets[0]});
    const release = preserveUndoViewport(root);
    api.focusRootIDs(["doc"], "offscreen");
    assert.equal(scrolls, 0);
    release();
    api.focusRootIDs(["doc"], "offscreen");
    assert.equal(scrolls, 1);
});

test("history subscriptions follow their document, include broadcasts and dispose independently", () => {
    const api = load();
    const first: unknown[] = [];
    const second: unknown[] = [];
    const stopFirst = api.subscribeUndoState("first", state => first.push(plain(state)));
    const stopSecond = api.subscribeUndoState("second", state => second.push(plain(state)));
    api.markMirror("first", {canUndo: true});
    assert.deepEqual(first.at(-1), {canUndo: true, canRedo: false, pending: false});
    assert.equal(second.length, 1);
    api.syncMirrorFromBroadcast({second: {canUndo: false, canRedo: true}});
    assert.deepEqual(second.at(-1), {canUndo: false, canRedo: true, pending: false});
    stopFirst();
    const replacement: unknown[] = [];
    const stopReplacement = api.subscribeUndoState("first", state => replacement.push(plain(state)));
    stopFirst();
    api.markMirror("first", {canRedo: true});
    assert.equal(first.length, 2);
    assert.deepEqual(replacement.at(-1), {canUndo: true, canRedo: true, pending: false});
    stopSecond(); stopReplacement();
    api.markMirror("first", {canUndo: false});
    assert.equal(replacement.length, 2);
});

test("initial history loads are shared and do not overwrite newer local or broadcast state", async () => {
    let reply: (response: unknown) => void;
    let finish: () => void;
    let requests = 0;
    const api = load({fetchPost: async (_url: string, _data: unknown, callback: (value: unknown) => void) => {
        requests++; reply = callback; await new Promise<void>(resolve => finish = resolve);
    }});
    const states: unknown[] = [];
    api.subscribeUndoState("doc", state => states.push(plain(state)));
    const first = api.initMirror("doc");
    const second = api.initMirror("doc");
    assert.equal(first, second);
    api.markMirror("doc", {canUndo: true, canRedo: false});
    reply({data: {canUndo: false, canRedo: true}}); finish();
    assert.equal(await first, true);
    assert.equal(requests, 1);
    assert.deepEqual(states.at(-1), {canUndo: true, canRedo: false, pending: false});
});

test("undo and redo publish pending state across documents and release it after completion or errors", async () => {
    for (const redo of [false, true]) {
        for (const fail of [false, true]) {
            let release: () => void;
            let requests = 0;
            const api = load({waitForPendingTransactions: () => new Promise<void>(resolve => release = resolve),
                fetchPost: async (url: string, _data: unknown, reply: (response: unknown) => void) => {
                    requests++;
                    if (fail) { throw new Error("request failed"); }
                    reply({data: url.endsWith("undoState") ? {canUndo: true, canRedo: true, peekMutatedRootIDs: []} :
                        {canUndo: redo, canRedo: !redo, undoOperations: [], doOperations: []}});
                }});
            const states: unknown[] = [];
            api.subscribeUndoState("other", state => states.push(plain(state)));
            const owner = {block: {rootID: "doc"}} as IProtyle;
            const pending = (redo ? api.requestRedo : api.requestUndo)(owner, "doc");
            assert.equal(api.getUndoStateSnapshot("doc").pending, true);
            assert.deepEqual(states.at(-1), {canUndo: false, canRedo: false, pending: true});
            await api.requestUndo(owner, "other");
            assert.equal(requests, 0, "a second history command cannot start while the first is waiting");
            release();
            if (fail) { await assert.rejects(pending, /request failed/); } else { await pending; }
            assert.equal(api.getUndoStateSnapshot("doc").pending, false);
            assert.deepEqual(states.at(-1), {canUndo: false, canRedo: false, pending: false});
        }
    }
});
