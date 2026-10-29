import * as assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";
import {escapeMarkdownPlainText} from "../../util/escape";
import {documentCreateRequest} from "../../util/documentCreate";

const loadInbox = (responses: {code: number; data?: Record<string, string>}[]) => {
    const calls: {url: string; data: Record<string, string>}[] = [];
    const removed: string[][] = [];
    const messages: string[] = [];
    const exports: {Inbox?: {prototype: object}} = {};
    const source = ts.transpileModule(readFileSync(join(__dirname, "Inbox.ts"), "utf8"), {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
    }).outputText;
    runInNewContext(source, {
        exports,
        window: {siyuan: {languages: {emptyContent: "Empty"}}},
        require: (name: string) => {
            if (name.endsWith("/Model")) { return {Model: class {}}; }
            if (name.endsWith("/fetch")) {
                return {fetchSyncPost: async (url: string, data: Record<string, string>) => {
                    calls.push({url, data});
                    return responses.shift();
                }};
            }
            if (name.endsWith("/message")) { return {showMessage: (message: string) => messages.push(message)}; }
            if (name.endsWith("/escape")) { return {escapeMarkdownPlainText}; }
            return {};
        },
    });
    const inbox = Object.create(exports.Inbox.prototype) as {
        insertToCurrentDoc(ids: string[], rootID: string): Promise<void>;
        remove(ids: string[]): void;
    };
    inbox.remove = (ids: string[]) => removed.push(Array.from(ids));
    return {inbox, calls, removed, messages};
};

test("inbox insertion removes only entries successfully appended to the current document", async () => {
    const {inbox, calls, removed} = loadInbox([
        {code: 0, data: {shorthandMd: "First", shorthandTitle: "First title"}},
        {code: 0},
        {code: 0, data: {shorthandMd: "Second", shorthandTitle: "Second title"}},
        {code: -1},
    ]);
    await inbox.insertToCurrentDoc(["first", "second"], "doc-id");
    assert.deepEqual(calls.map(call => call.url), [
        "/api/inbox/getShorthand", "/api/block/appendBlock",
        "/api/inbox/getShorthand", "/api/block/appendBlock",
    ]);
    assert.equal(calls[1].data.parentID, "doc-id");
    assert.equal(calls[1].data.data, "# First title\n\nFirst");
    assert.equal(calls[3].data.data, "# Second title\n\nSecond");
    assert.deepEqual(removed, [["first"]]);
});

test("inbox insertion retains an entry when its content cannot be loaded", async () => {
    const {inbox, calls, removed} = loadInbox([{code: -1}]);
    await inbox.insertToCurrentDoc(["first"], "doc-id");
    assert.equal(calls.length, 1);
    assert.deepEqual(removed, []);
});

test("inbox insertion preserves link-only entries as Markdown links", async () => {
    const {inbox, calls, removed} = loadInbox([
        {code: 0, data: {shorthandMd: "", shorthandContent: "", shorthandTitle: "Source", shorthandURL: "https://example.com"}},
        {code: 0},
    ]);
    await inbox.insertToCurrentDoc(["link"], "doc-id");
    assert.equal(calls[1].data.data, "# Source\n\n[Source](https://example.com)");
    assert.deepEqual(removed, [["link"]]);
});

test("inbox insertion keeps Markdown punctuation in the title as plain text", async () => {
    const {inbox, calls, removed} = loadInbox([
        {code: 0, data: {shorthandMd: "Body", shorthandTitle: "A *bold* [note] $x$ ==mark== &amp; #tag# 1+2 50%?\ncontinued"}},
        {code: 0},
    ]);
    await inbox.insertToCurrentDoc(["entry"], "doc-id");
    assert.equal(calls[1].data.data, "# A \\*bold\\* \\[note\\] \\$x\\$ \\=\\=mark\\=\\= \\&amp; \\#tag\\# 1+2 50%? continued\n\nBody");
    assert.deepEqual(removed, [["entry"]]);
});

const loadMoveInbox = (fetchEntry: (id: string) => Promise<void> = async () => {}) => {
    const removed: string[][] = [];
    const created: string[] = [];
    let picker: {cb: (paths: string[], notebooks: string[]) => Promise<void>};
    const exports: {Inbox?: {prototype: object}} = {};
    runInNewContext(ts.transpileModule(readFileSync(join(__dirname, "Inbox.ts"), "utf8"), {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
    }).outputText, {
        exports, Lute: {NewNodeID: () => `20261023030000-${String(created.length).padStart(7, "0")}`},
        window: {siyuan: {languages: {documentCreationLimit: "Limit", documentCreationRecovery: "Review"}}},
        require: (name: string) => ({
            "../Model": {Model: class {}},
            "../../util/pathName": {movePathTo: (options: typeof picker) => { picker = options; }},
            "../../util/documentCreate": {documentCreateRequest},
            "../../util/fetch": {fetchSyncPost: async (_url: string, data: {id: string}) => {
                await fetchEntry(data.id);
                return {code: 0, data: {oId: data.id, shorthandTitle: data.id, shorthandMd: "Body"}};
            }},
            "../../util/configuredDocument": {createConfiguredDocument: async (input: {id: string}, options: {onCreated: () => void}) => {
                created.push(input.id);
                options.onCreated();
            }},
            "../../editor/rename": {normalizeDocumentTitle: (value: string) => value},
            "../../util/escape": {escapeHtml: (value: string) => value},
            "../../dialog/message": {showMessage() {}},
        })[name] || {},
    });
    const inbox = Object.assign(Object.create(exports.Inbox.prototype), {
        data: {}, moving: false, moveTargets: new Map(), remove: (ids: string[]) => removed.push(Array.from(ids)),
    }) as {move(ids: string[]): void};
    return {inbox, removed, created, select: () => picker.cb(["/"], ["box"])};
};

test("inbox document batches consume only confirmed entries after a later network failure", async () => {
    const f = loadMoveInbox(async id => { if (id === "second") { throw new Error("offline"); } });
    f.inbox.move(["first", "second"]);
    await f.select();
    assert.equal(f.created.length, 1);
    assert.deepEqual(f.removed, [["first"]]);
});

test("confirmed inbox batches can exceed the unresolved-plan bound and removal retries do not recreate documents", async () => {
    const f = loadMoveInbox();
    const ids = Array.from({length: 64}, (_, i) => `entry-${i}`);
    f.inbox.move(ids);
    await f.select();
    assert.equal(f.created.length, 64);
    assert.deepEqual(f.removed, [ids]);
    f.inbox.move(ids);
    await f.select();
    assert.equal(f.created.length, 64);
    assert.deepEqual(f.removed, [ids, ids]);
});

test("concurrent inbox move callbacks cannot allocate different identities for one source", async () => {
    let resolve: () => void;
    const wait = new Promise<void>(done => { resolve = done; });
    const f = loadMoveInbox(async () => wait);
    f.inbox.move(["first"]);
    const first = f.select();
    await f.select();
    resolve();
    await first;
    assert.equal(f.created.length, 1);
    assert.deepEqual(f.removed, [["first"]]);
});
