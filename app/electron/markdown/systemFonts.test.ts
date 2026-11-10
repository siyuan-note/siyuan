import {test} from "node:test";
import * as assert from "node:assert/strict";
import {createMarkdownSystemFonts} from "./systemFonts";

test("font enumeration invokes only bundled read-only CLI and coalesces simultaneous requests", async () => {
    let resolve: (json: string) => void;
    let calls = 0;
    const load = createMarkdownSystemFonts("/app/kernel/SiYuan-Kernel", async (file, args) => {
        calls++;
        assert.equal(file, "/app/kernel/SiYuan-Kernel");
        assert.deepEqual(args, ["system", "fonts", "--lang", "zh-CN"]);
        return new Promise<string>(done => {resolve = done;});
    });
    const a = load("zh-CN");
    const b = load("zh-CN");
    assert.equal(a, b);
    const fonts = [{family: "Mono", displayName: "Mono Regular", weight: 400, spacing: "monospace", aliases: ["等宽"]}];
    resolve(JSON.stringify(fonts));
    assert.deepEqual(await a, fonts);
    assert.equal(calls, 1);
    await assert.rejects(load("--workspace=/secret"));
});

test("font provider retries failures and rejects malformed or oversized results", async () => {
    let count = 0;
    const load = createMarkdownSystemFonts("/app/kernel", async () => {
        count++;
        if (count === 1) throw new Error("missing helper");
        if (count === 2) return "not json";
        if (count === 3) return " ".repeat(4 * 1024 * 1024 + 1);
        return JSON.stringify([{family: "safe", displayName: "Safe", weight: 400}, {family: "bad", weight: 0}]);
    });
    await assert.rejects(load(), /missing helper/);
    await assert.rejects(load());
    await assert.rejects(load(), /too large/);
    assert.deepEqual(await load(), [{family: "safe", displayName: "Safe", weight: 400}]);
});

test("font provider disposal aborts shared child work and rejects new requests", async () => {
    const load = createMarkdownSystemFonts("/app/kernel", async (_file, _args, signal) => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")), {once: true});
    }));
    const pending = load();
    load.dispose();
    await assert.rejects(pending, /aborted/);
    await assert.rejects(load(), /disposed/);
});
