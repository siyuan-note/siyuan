import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import ts from "typescript";

const load = (fetch: (route: string, request: unknown) => Promise<unknown>, messages: string[] = []) => {
    const source = ts.transpileModule(readFileSync(new URL("./dataSource.ts", import.meta.url), "utf8"), {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021},
    }).outputText;
    const exports: {docTreeDataSource?: {range: (request: unknown) => Promise<unknown>, locate: (request: unknown, options?: {ignoreUnavailable?: boolean}) => Promise<unknown>}} = {};
    new Function("require", "exports", source)((name: string) => {
        if (name === "../../../dialog/message") {
            return {showMessage: (message: string) => messages.push(message)};
        }
        assert.equal(name, "../../../util/fetch");
        return {fetchSyncPost: (route: string, request: unknown, headers: unknown, process: boolean) => {
            assert.equal(headers, undefined);
            assert.equal(process, false, "the fetch layer must not display a transient error before retrying");
            return fetch(route, request);
        }};
    }, exports);
    return exports.docTreeDataSource;
};

for (const method of ["range", "locate"] as const) {
    test(`document tree ${method} retries concurrent source changes and preserves the request`, async () => {
        let calls = 0;
        const request = {notebook: "box", id: "doc", offset: 32, limit: 32, revision: "one"};
        const data = {revision: "two"};
        const messages: string[] = [];
        const source = load(async (route, value) => {
            assert.equal(route, method === "range" ? "/api/filetree/listDocTreeRange" : "/api/filetree/locateDocTreeItem");
            assert.equal(value, request);
            return ++calls < 3 ? {code: -1, msg: "document tree changed, please retry"} : {code: 0, data};
        }, messages);
        assert.equal(await source[method](request), data);
        assert.equal(calls, 3);
        assert.deepEqual(messages, [], "successful retries never display the internal conflict message");
    });

    test(`document tree ${method} bounds retries while the source remains busy`, async () => {
        let calls = 0;
        const messages: string[] = [];
        const source = load(async () => {
            calls++;
            return {code: -1, msg: "document tree changed, please retry"};
        }, messages);
        await assert.rejects(source[method]({}), /document tree changed/);
        assert.equal(calls, 3);
        assert.deepEqual(messages, [], "persistent conflicts use the panel retry state without global popups");
    });

    test(`document tree ${method} preserves access, source and network failures without retrying`, async () => {
        for (const failure of ["notebook locked", "corrupt source", "network offline"]) {
            let calls = 0;
            const messages: string[] = [];
            const source = load(async () => {
                calls++;
                if (failure === "network offline") { throw new Error(failure); }
                return {code: -1, msg: failure};
            }, messages);
            await assert.rejects(source[method]({}), {message: failure});
            assert.equal(calls, 1);
            assert.deepEqual(messages, failure === "network offline" ? [] : [failure], "business failures retain their existing popup");
        }
    });
}

test("background location suppresses only unavailable targets while retaining the rejection", async () => {
    for (const [code, msg, silent] of [
        [-1, "document tree item is unavailable", true],
        [-1, "notebook locked", false],
        [-1, "corrupt source", false],
        [-2, "document tree item is unavailable", false],
    ] as const) {
        const messages: string[] = [];
        let calls = 0;
        const source = load(async () => { calls++; return {code, msg}; }, messages);
        await assert.rejects(source.locate({}, {ignoreUnavailable: true}), {message: msg});
        assert.equal(calls, 1);
        assert.deepEqual(messages, silent ? [] : [msg]);
    }
});

test("explicit location and range reads report unavailable targets", async () => {
    const messages: string[] = [];
    const msg = "document tree item is unavailable";
    const source = load(async () => ({code: -1, msg}), messages);
    await assert.rejects(source.locate({}), {message: msg});
    await assert.rejects(source.locate({}, {ignoreUnavailable: false}), {message: msg});
    await assert.rejects(source.range({}), {message: msg});
    assert.deepEqual(messages, [msg, msg, msg]);
});
