import {it} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";
import {withFetchTimeout} from "./fetchTimeout";

const loadFetchPost = () => {
    const sends: unknown[][] = [];
    const timeouts: number[] = [];
    const exports: {fetchPost?: (...args: any[]) => Promise<void>} = {};
    const source = ts.transpileModule(readFileSync(join(__dirname, "fetch.ts"), "utf8"), {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
    }).outputText;
    runInNewContext(source, {
        exports,
        require: (name: string) => {
            switch (name) {
                case "../constants": return {Constants: {SIYUAN_QUIT: "quit"}};
                case "electron": return {ipcRenderer: {send: (...args: unknown[]) => sends.push(args)}};
                case "./processMessage": return {processMessage: () => true};
                case "./kernelFault": return {kernelError: () => assert.fail("unexpected kernel error")};
                case "./fetchTimeout": return {
                    withFetchTimeout: (request: (signal?: AbortSignal) => Promise<unknown>, signal: AbortSignal, timeout: number) => {
                        timeouts.push(timeout);
                        return withFetchTimeout(request, signal, timeout > 0 ? 10 : 0);
                    },
                };
                default: throw new Error(name);
            }
        },
        fetch: () => new Promise(() => {}),
        FormData,
        location: {port: "6806"},
        console: {warn: () => {}},
    });
    return {fetchPost: exports.fetchPost, sends, timeouts};
};

it("invokes the failure callback once when a request stalls", async () => {
    const {fetchPost, sends} = loadFetchPost();
    let failures = 0;
    await fetchPost("/api/bazaar/getInstalledPlugin", {}, () => assert.fail("unexpected success"),
        undefined, (response: {code: number}) => {
            failures++;
            assert.equal(response.code, 400);
        }, undefined, 30000);
    assert.equal(failures, 1);
    assert.equal(sends.length, 0);
});

it("falls back to desktop quit when exit or closing layout requests stall", async () => {
    for (const url of ["/api/system/exit", "/api/system/setUILayout", "/api/system/setWorkspaceDir"]) {
        const {fetchPost, sends, timeouts} = loadFetchPost();
        await fetchPost(url, {errorExit: true}, () => assert.fail("unexpected success"));
        assert.deepEqual(timeouts, [30000]);
        assert.deepEqual(sends, [["quit", "6806"]]);
    }
});
