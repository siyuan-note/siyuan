import * as assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";

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
        {code: 0, data: {shorthandMd: "Body", shorthandTitle: "A *bold* [note]\ncontinued"}},
        {code: 0},
    ]);
    await inbox.insertToCurrentDoc(["entry"], "doc-id");
    assert.equal(calls[1].data.data, "# A \\*bold\\* \\[note\\] continued\n\nBody");
    assert.deepEqual(removed, [["entry"]]);
});
