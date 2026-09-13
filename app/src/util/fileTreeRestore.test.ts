import * as assert from "node:assert/strict";
import test from "node:test";
import {restoreFileTreePaths} from "./fileTreeRestore";

test("loads independent branches concurrently after their shared ancestors finish", async () => {
    const calls: string[] = [];
    const pending = new Map<string, () => void>();
    const restore = restoreFileTreePaths([
        {notebookId: "one", openPaths: ["/a/b/leaf.sy", "/a/c/leaf.sy", "/a/b/other.sy"]},
        {notebookId: "two", openPaths: ["/x/leaf.sy"]},
        {notebookId: "one", openPaths: ["//a/b/leaf.sy"]},
    ], async (notebookId, path) => {
        const key = `${notebookId}:${path}`;
        calls.push(key);
        await new Promise<void>(resolve => pending.set(key, resolve));
    });
    const flush = () => new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, ["one:/", "two:/"]);
    pending.get("one:/")();
    await flush();
    assert.equal(calls.length, 2);
    pending.get("two:/")();
    await flush();
    assert.deepEqual(calls.slice(2), ["one:/a.sy", "two:/x.sy"]);
    pending.get("one:/a.sy")();
    pending.get("two:/x.sy")();
    await flush();
    assert.deepEqual(calls.slice(4), ["one:/a/b.sy", "one:/a/c.sy"]);
    pending.get("one:/a/c.sy")();
    pending.get("one:/a/b.sy")();
    await restore;
    assert.equal(calls.length, 6);
});

test("restores only ancestors and leaves root-only and empty saved paths collapsed", async () => {
    const calls: string[] = [];
    await restoreFileTreePaths([
        {notebookId: "one", openPaths: ["/", ""]},
        {notebookId: "two", openPaths: []},
        {notebookId: "three", openPaths: ["/leaf.sy"]},
    ], async (notebookId, path) => {
        calls.push(`${notebookId}:${path}`);
    });
    assert.deepEqual(calls, ["three:/"]);
});

test("a rejected branch does not interrupt restoration of other branches", async () => {
    const calls: string[] = [];
    const errors: unknown[] = [];
    const originalError = console.error;
    const failure = new Error("request failed");
    console.error = error => errors.push(error);
    try {
        await restoreFileTreePaths([
            {notebookId: "one", openPaths: ["/leaf.sy"]},
            {notebookId: "two", openPaths: ["/a/leaf.sy"]},
        ], async (notebookId, path) => {
            if (notebookId === "one") {
                throw failure;
            }
            calls.push(path);
        });
        assert.deepEqual(calls, ["/", "/a.sy"]);
        assert.deepEqual(errors, [failure]);
    } finally {
        console.error = originalError;
    }
});
