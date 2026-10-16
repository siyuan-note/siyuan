import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {withFetchTimeout} from "./fetchTimeout";

const source = transpileModule(readFileSync("src/util/kernelConnection.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const fixture = (request: typeof fetch) => {
    const calls: {url: RequestInfo | URL, options: RequestInit}[] = [];
    const deadlines: number[] = [];
    const delays: number[] = [];
    const api = {} as typeof import("./kernelConnection");
    runInNewContext(source, {
        exports: api,
        setTimeout: (callback: () => void, delay: number) => {
            delays.push(delay);
            return setTimeout(callback, 0);
        },
        require: (name: string) => name === "./fetchWithAppId" ? {
            fetchWithAppId: (url: RequestInfo | URL, options: RequestInit) => {
                calls.push({url, options});
                return request(url, options);
            },
        } : {withFetchTimeout: (run: (signal?: AbortSignal) => Promise<boolean>, signal: AbortSignal, timeout: number) => {
            deadlines.push(timeout);
            return withFetchTimeout(run, signal, 10);
        }},
    });
    return {api, calls, deadlines, delays};
};
const healthy = () => new Response(JSON.stringify({code: 0, msg: "", data: "test-version"}));

test("kernel diagnosis retries only uncached reads and tolerates a transient or truncated response", async () => {
    for (const failure of ["network", "json", "status"]) {
        let attempts = 0;
        const {api, calls, delays, deadlines} = fixture(async () => {
            if (attempts++ === 0) {
                if (failure === "network") throw new TypeError("Failed to fetch");
                if (failure === "json") return new Response("{");
                return new Response(null, {status: 503});
            }
            return healthy();
        });
        assert.equal(await api.checkKernelConnection(), true, failure);
        assert.equal(calls.length, 2);
        calls.forEach(({url, options}) => {
            assert.equal(url, "/api/system/version");
            assert.equal(options.cache, "no-store");
            assert.equal(options.method, undefined);
            assert.equal(options.body, undefined);
        });
        assert.deepEqual(deadlines, [1500, 1500]);
        assert.deepEqual(delays, [300]);
    }
});

test("simultaneous failures share one diagnosis and later failures can run a new check", async () => {
    let finish: (response: Response) => void;
    const {api, calls} = fixture(() => new Promise(resolve => finish = resolve));
    const first = api.checkKernelConnection();
    const second = api.checkKernelConnection();
    assert.equal(first, second);
    await Promise.resolve();
    assert.equal(calls.length, 1);
    finish(healthy());
    assert.equal(await first, true);
    const later = api.checkKernelConnection();
    assert.notEqual(later, first);
    await Promise.resolve();
    finish(healthy());
    assert.equal(await later, true);
    assert.equal(calls.length, 2);
});

test("unreachable or stalled kernels fail after bounded probes and cancel outstanding reads", async () => {
    for (const stalled of [false, true]) {
        const {api, calls, delays} = fixture(() => stalled ? new Promise(() => {}) : Promise.reject(new Error("offline")));
        assert.equal(await api.checkKernelConnection(), false);
        assert.equal(calls.length, 3);
        assert.deepEqual(delays, [300, 300]);
        if (stalled) {
            assert.ok(calls.every(call => call.options.signal.aborted));
        }
    }
});

test("a recovered main socket supersedes an in-flight diagnosis without hiding a later outage", async () => {
    let reject: (reason: Error) => void;
    const {api, calls} = fixture(() => new Promise((_resolve, fail) => reject = fail));
    const check = api.checkKernelConnection();
    await Promise.resolve();
    api.markKernelConnectionAlive();
    reject(new Error("stale connection"));
    assert.equal(await check, true);
    assert.equal(calls.length, 1);
    assert.equal(await api.checkKernelConnection(), false);
    assert.equal(calls.length, 4);
});
