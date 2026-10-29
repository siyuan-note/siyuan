import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import ts from "typescript";

const load = (fetch: (route: string, request: unknown) => Promise<unknown>) => {
    const source = ts.transpileModule(readFileSync(new URL("./dataSource.ts", import.meta.url), "utf8"), {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021},
    }).outputText;
    const exports: {docTreeDataSource?: {range: (request: unknown) => Promise<unknown>, locate: (request: unknown) => Promise<unknown>}} = {};
    new Function("require", "exports", source)(() => ({fetchSyncPost: fetch}), exports);
    return exports.docTreeDataSource;
};

for (const method of ["range", "locate"] as const) {
    test(`document tree ${method} retries concurrent source changes and preserves the request`, async () => {
        let calls = 0;
        const request = {notebook: "box", id: "doc", offset: 32, limit: 32, revision: "one"};
        const data = {revision: "two"};
        const source = load(async (route, value) => {
            assert.equal(route, method === "range" ? "/api/filetree/listDocTreeRange" : "/api/filetree/locateDocTreeItem");
            assert.equal(value, request);
            return ++calls < 3 ? {code: -1, msg: "document tree changed, please retry"} : {code: 0, data};
        });
        assert.equal(await source[method](request), data);
        assert.equal(calls, 3);
    });

    test(`document tree ${method} bounds retries while the source remains busy`, async () => {
        let calls = 0;
        const source = load(async () => {
            calls++;
            return {code: -1, msg: "document tree changed, please retry"};
        });
        await assert.rejects(source[method]({}), /document tree changed/);
        assert.equal(calls, 3);
    });

    test(`document tree ${method} preserves access, source and network failures without retrying`, async () => {
        for (const failure of ["notebook locked", "corrupt source", "network offline"]) {
            let calls = 0;
            const source = load(async () => {
                calls++;
                if (failure === "network offline") { throw new Error(failure); }
                return {code: -1, msg: failure};
            });
            await assert.rejects(source[method]({}), {message: failure});
            assert.equal(calls, 1);
        }
    });
}
