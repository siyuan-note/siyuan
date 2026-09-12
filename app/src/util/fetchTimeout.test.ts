import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {withFetchTimeout} from "./fetchTimeout";

describe("fetch timeout", () => {
    it("settles a stalled request and aborts its network operation", async () => {
        let signal: AbortSignal;
        await assert.rejects(withFetchTimeout((value) => {
            signal = value;
            return new Promise(() => {});
        }, undefined, 10), {name: "TimeoutError"});
        assert.equal(signal.aborted, true);
    });

    it("covers a stalled response body", async () => {
        await assert.rejects(withFetchTimeout(async () => {
            const response = new Response(new ReadableStream());
            return response.json();
        }, undefined, 10), {name: "TimeoutError"});
    });

    it("preserves successful results and network errors", async () => {
        assert.equal(await withFetchTimeout(async () => "ok", undefined, 1000), "ok");
        const error = new TypeError("Failed to fetch");
        await assert.rejects(withFetchTimeout(async () => {
            throw error;
        }, undefined, 1000), (value) => value === error);
    });

    it("forwards caller cancellation without turning it into a timeout", async () => {
        const controller = new AbortController();
        const pending = withFetchTimeout((signal) => new Promise((resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), {once: true});
            controller.abort();
        }), controller.signal, 1000);
        await assert.rejects(pending, {name: "AbortError"});
    });

    it("preserves an already aborted signal and supports opting out", async () => {
        const controller = new AbortController();
        controller.abort();
        await withFetchTimeout(async (signal) => {
            assert.equal(signal.aborted, true);
            assert.equal(signal.reason, controller.signal.reason);
        }, controller.signal, 1000);
        await withFetchTimeout(async (signal) => {
            assert.equal(signal, controller.signal);
        }, controller.signal);
    });
});
