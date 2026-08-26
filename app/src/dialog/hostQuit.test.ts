import * as assert from "node:assert/strict";
import {describe, it} from "node:test";
import {createHostQuitGuard} from "./hostQuit";

describe("host quit guard", () => {
    it("runs the host quit action only once", () => {
        const guard = createHostQuitGuard();
        let calls = 0;

        assert.equal(guard.run(() => calls++), true);
        assert.equal(guard.run(() => calls++), false);
        assert.equal(calls, 1);
        assert.equal(guard.isStarted(), true);
    });

    it("allows retrying when the host quit action throws", () => {
        const guard = createHostQuitGuard();

        assert.throws(() => guard.run(() => {
            throw new Error("quit failed");
        }), /quit failed/);
        assert.equal(guard.isStarted(), false);
        assert.equal(guard.run(() => undefined), true);
    });
});
