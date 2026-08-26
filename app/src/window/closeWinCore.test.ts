import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {destroyWindowPluginKernels} from "./closeWinCore";

describe("independent window plugin cleanup", () => {
    it("destroys every kernel without invoking lifecycle hooks", () => {
        let destroyed = 0;
        let lifecycleCalls = 0;
        const plugins = [1, 2].map(() => ({
            kernel: {
                destroy() {
                    destroyed++;
                },
            },
            onunload() {
                lifecycleCalls++;
            },
            uninstall() {
                lifecycleCalls++;
            },
        }));

        destroyWindowPluginKernels(plugins, () => undefined);

        assert.equal(destroyed, 2);
        assert.equal(lifecycleCalls, 0);
    });

    it("does not wait for pending destruction", async () => {
        let finished = false;
        const pending = new Promise<void>(() => undefined);

        destroyWindowPluginKernels([{kernel: {destroy: () => pending}}], () => undefined);
        finished = true;

        assert.equal(finished, true);
    });

    it("observes synchronous and asynchronous destruction errors", async () => {
        const errors: string[] = [];
        destroyWindowPluginKernels([
            {kernel: {destroy: () => {
                throw new Error("sync");
            }}},
            {kernel: {destroy: () => Promise.reject(new Error("async"))}},
        ], error => errors.push((error as Error).message));

        await Promise.resolve();

        assert.deepEqual(errors.sort(), ["async", "sync"]);
    });
});
