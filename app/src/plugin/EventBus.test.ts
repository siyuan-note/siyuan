import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {EventBus} from "./EventBusCore";

describe("plugin EventBus", () => {
    it("preserves on, once, and off behavior", () => {
        const eventBus = new EventBus<{ value: number }>("", new EventTarget());
        let persistentCount = 0;
        let onceCount = 0;
        const persistentListener = (event: CustomEvent<{ value: number }>) => {
            persistentCount += event.detail.value;
        };
        eventBus.on("before-upload-assets", persistentListener);
        eventBus.once("before-upload-assets", () => {
            onceCount++;
        });

        eventBus.emit("before-upload-assets", {value: 1});
        eventBus.emit("before-upload-assets", {value: 1});
        eventBus.off("before-upload-assets", persistentListener);
        eventBus.emit("before-upload-assets", {value: 1});

        assert.equal(persistentCount, 2);
        assert.equal(onceCount, 1);
    });

    it("captures synchronous listener errors during safe dispatch", () => {
        const eventBus = new EventBus("", new EventTarget());
        let laterListenerCalled = false;
        eventBus.on("before-upload-assets", () => {
            throw new Error("listener failed");
        });
        eventBus.on("before-upload-assets", () => {
            laterListenerCalled = true;
        });

        const result = eventBus.emitWithErrors("before-upload-assets");

        assert.equal((result.error as Error).message, "listener failed");
        assert.equal(laterListenerCalled, false);
    });

    it("reports prevention and asynchronous listeners during safe dispatch", async () => {
        const eventBus = new EventBus("", new EventTarget());
        eventBus.on("before-upload-assets", async event => {
            event.preventDefault();
            await Promise.resolve();
        });

        const result = eventBus.emitWithErrors("before-upload-assets");
        await Promise.resolve();

        assert.equal(result.defaultPrevented, true);
        assert.equal(result.hasAsyncListener, true);
    });
});
