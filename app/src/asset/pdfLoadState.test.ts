import {after, before, beforeEach, describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {PdfLoadState} from "./pdfLoadState";

describe("PDF load state", () => {
    const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    const clearedTimeouts: number[] = [];

    before(() => {
        Object.defineProperty(globalThis, "window", {
            configurable: true,
            value: {
                clearTimeout(timeout: number) {
                    clearedTimeouts.push(timeout);
                },
            },
        });
    });

    beforeEach(() => {
        clearedTimeouts.length = 0;
    });

    after(() => {
        if (windowDescriptor) {
            Object.defineProperty(globalThis, "window", windowDescriptor);
        } else {
            Reflect.deleteProperty(globalThis, "window");
        }
    });

    it("clears pending work when destroyed", () => {
        const state = new PdfLoadState();
        let disconnectCount = 0;
        state.setTimeout(7);
        state.setObserver({
            disconnect() {
                disconnectCount++;
            },
        });

        assert.equal(state.destroy(), true);
        assert.equal(state.isDestroyed, true);
        assert.deepEqual(clearedTimeouts, [7]);
        assert.equal(disconnectCount, 1);
        assert.equal(state.consumeTimeout(), false);
        assert.equal(state.consumeObserver(), false);
    });

    it("rejects work registered after destruction", () => {
        const state = new PdfLoadState();
        let disconnectCount = 0;
        state.destroy();

        assert.equal(state.setTimeout(11), false);
        assert.equal(state.setObserver({
            disconnect() {
                disconnectCount++;
            },
        }), false);
        assert.equal(disconnectCount, 1);
        assert.equal(clearedTimeouts.at(-1), 11);
    });

    it("replaces previously registered pending work", () => {
        const state = new PdfLoadState();
        let firstDisconnectCount = 0;
        state.setTimeout(17);
        state.setTimeout(19);
        state.setObserver({
            disconnect() {
                firstDisconnectCount++;
            },
        });
        state.setObserver({disconnect() {}});

        assert.equal(clearedTimeouts.at(-1), 17);
        assert.equal(firstDisconnectCount, 1);
        assert.equal(state.consumeTimeout(), true);
        assert.equal(state.consumeObserver(), true);
    });
});
