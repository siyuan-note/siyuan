import * as assert from "node:assert/strict";
import {test} from "node:test";
import {fetchStartupRead, finishStartupReads} from "./startupRead";

test("startup reads retry transport failures, preserve responses and never replay writes", async () => {
    let calls = 0;
    const response = new Response("{}", {status: 503});
    const request: typeof fetch = async () => {
        if (++calls === 1) throw new TypeError("Failed to fetch");
        return response;
    };
    assert.equal(await fetchStartupRead("/api/petal/loadPetals", {method: "POST"}, request), response);
    assert.equal(calls, 2);
    calls = 1;
    assert.equal(await fetchStartupRead("/api/system/getConf", {method: "POST"}, request), response);
    assert.equal(calls, 2, "HTTP errors are returned without retries");
    for (const url of ["/api/transactions", "/api/petal/setPetalEnabled", "/api/storage/setLocalStorageVal"]) {
        calls = 0;
        await assert.rejects(fetchStartupRead(url, {method: "POST"}, request), TypeError);
        assert.equal(calls, 1);
    }
    calls = 0;
    await assert.rejects(fetchStartupRead("/api/petal/loadPetals", {method: "POST"}, async () => {
        calls++;
        throw new TypeError("offline");
    }), /url=\/api\/petal\/loadPetals\nattempts=3/);
    assert.equal(calls, 3);
    const signals: AbortSignal[] = [];
    await assert.rejects(fetchStartupRead("/api/system/getConf", {method: "POST"}, async (_input, init) => {
        signals.push(init.signal);
        return new Promise<Response>(() => {});
    }), /url=\/api\/system\/getConf\nattempts=3/);
    assert.equal(signals.length, 3);
    assert.ok(signals.every(signal => signal.aborted), "each timed-out request is cancelled");
    calls = 0;
    await assert.rejects(fetchStartupRead("/appearance/langs/en.json?v=test", {}, async () => {
        calls++;
        throw new SyntaxError("JSON");
    }), SyntaxError);
    assert.equal(calls, 1, "non-transport failures are not retried");
    calls = 0;
    finishStartupReads();
    await assert.rejects(fetchStartupRead("/api/petal/loadPetals", {method: "POST"}, request), TypeError);
    assert.equal(calls, 1, "normal runtime requests retain their original behavior");
});
