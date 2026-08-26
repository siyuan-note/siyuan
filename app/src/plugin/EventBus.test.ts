import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    destroyEventBus,
    emitToPlugins,
    emitWithErrors,
    EventBus,
    eventBusHas,
    hasPluginSubscriber,
} from "./EventBusCore";

describe("plugin EventBus", () => {
    it("exposes only the plugin event methods", () => {
        assert.deepEqual(Object.getOwnPropertyNames(EventBus.prototype).sort(), [
            "constructor",
            "emit",
            "off",
            "on",
            "once",
        ]);
    });

    it("preserves on, once, and off behavior", () => {
        const eventBus = new EventBus<{ value: number }>(new EventTarget());
        let persistentCount = 0;
        let onceCount = 0;
        const persistentListener = (event: CustomEvent<{ value: number }>) => {
            persistentCount += event.detail.value;
        };
        eventBus.on("before-upload-assets", persistentListener);
        eventBus.once("before-upload-assets", () => {
            onceCount++;
        });
        assert.equal(hasPluginSubscriber("before-upload-assets"), true);

        eventBus.emit("before-upload-assets", {value: 1});
        eventBus.emit("before-upload-assets", {value: 1});
        eventBus.off("before-upload-assets", persistentListener);
        eventBus.emit("before-upload-assets", {value: 1});

        assert.equal(persistentCount, 2);
        assert.equal(onceCount, 1);
        assert.equal(hasPluginSubscriber("before-upload-assets"), false);
    });

    it("tracks listeners and preserves duplicate registration behavior", () => {
        const eventBus = new EventBus(new EventTarget());
        let callCount = 0;
        const listener = () => {
            callCount++;
        };

        eventBus.on("before-upload-assets", listener);
        eventBus.on("before-upload-assets", listener);
        assert.equal(eventBusHas(eventBus, "before-upload-assets"), true);

        eventBus.emit("before-upload-assets");
        assert.equal(callCount, 1);

        eventBus.off("before-upload-assets", listener);
        assert.equal(eventBusHas(eventBus, "before-upload-assets"), false);
    });

    it("allows off to cancel a pending once listener", () => {
        const eventBus = new EventBus(new EventTarget());
        let called = false;
        const listener = () => {
            called = true;
        };

        eventBus.once("before-upload-assets", listener);
        eventBus.off("before-upload-assets", listener);
        eventBus.emit("before-upload-assets");

        assert.equal(called, false);
        assert.equal(eventBusHas(eventBus, "before-upload-assets"), false);
    });

    it("runs distinct once listeners independently", () => {
        const eventBus = new EventBus(new EventTarget());
        const calls: number[] = [];
        eventBus.once("before-upload-assets", () => calls.push(1));
        eventBus.once("before-upload-assets", () => calls.push(2));

        eventBus.emit("before-upload-assets");
        eventBus.emit("before-upload-assets");

        assert.deepEqual(calls, [1, 2]);
        assert.equal(eventBusHas(eventBus, "before-upload-assets"), false);
    });

    it("keeps CustomEvent behavior", () => {
        const eventTarget = new EventTarget();
        const eventBus = new EventBus<{ value: number }>(eventTarget);
        eventBus.on("before-upload-assets", event => {
            assert.equal(event instanceof CustomEvent, true);
            assert.equal(event.target, eventTarget);
            assert.equal(event.currentTarget, eventTarget);
            assert.equal(event.detail.value, 1);
            event.preventDefault();
        });

        assert.equal(eventBus.emit("before-upload-assets", {value: 1}), false);
        destroyEventBus(eventBus);
    });

    it("destroys listeners permanently", () => {
        const eventBus = new EventBus(new EventTarget());
        let callCount = 0;
        const listener = () => {
            callCount++;
        };
        eventBus.on("before-upload-assets", listener);

        destroyEventBus(eventBus);
        destroyEventBus(eventBus);
        eventBus.on("before-upload-assets", listener);

        assert.equal(eventBusHas(eventBus, "before-upload-assets"), false);
        assert.equal(eventBus.emit("before-upload-assets"), true);
        assert.deepEqual(emitWithErrors(eventBus, "before-upload-assets"), {
            defaultPrevented: false,
            hasAsyncListener: false,
        });
        assert.equal(callCount, 0);
    });

    it("emits only to subscribers in plugin order", () => {
        const first = new EventBus(new EventTarget());
        const second = new EventBus(new EventTarget());
        const third = new EventBus(new EventTarget());
        const calls: number[] = [];
        const firstListener = () => calls.push(1);
        third.on("before-upload-assets", () => calls.push(3));
        first.on("before-upload-assets", firstListener);

        assert.equal(hasPluginSubscriber("before-upload-assets"), true);
        emitToPlugins("before-upload-assets");
        assert.deepEqual(calls, [1, 3]);

        calls.length = 0;
        first.off("before-upload-assets", firstListener);
        first.on("before-upload-assets", firstListener);
        emitToPlugins("before-upload-assets");

        assert.deepEqual(calls, [1, 3]);
        destroyEventBus(first);
        destroyEventBus(second);
        destroyEventBus(third);
        assert.equal(hasPluginSubscriber("before-upload-assets"), false);
    });

    it("uses a subscriber snapshot during broadcast", () => {
        const first = new EventBus(new EventTarget());
        const second = new EventBus(new EventTarget());
        const third = new EventBus(new EventTarget());
        const calls: number[] = [];
        const thirdListener = () => calls.push(3);
        first.on("before-upload-assets", () => {
            calls.push(1);
            third.on("before-upload-assets", thirdListener);
        });
        second.on("before-upload-assets", () => calls.push(2));

        emitToPlugins("before-upload-assets");
        assert.deepEqual(calls, [1, 2]);

        emitToPlugins("before-upload-assets");
        assert.deepEqual(calls, [1, 2, 1, 2, 3]);

        destroyEventBus(first);
        destroyEventBus(second);
        destroyEventBus(third);
    });

    it("requires a replacement bus to subscribe after reload", () => {
        const previous = new EventBus(new EventTarget());
        const replacement = new EventBus(new EventTarget());
        const calls: string[] = [];
        previous.on("before-upload-assets", () => calls.push("previous"));

        destroyEventBus(previous);
        emitToPlugins("before-upload-assets");
        replacement.on("before-upload-assets", () => calls.push("replacement"));
        emitToPlugins("before-upload-assets");

        assert.deepEqual(calls, ["replacement"]);
        destroyEventBus(replacement);
    });

    it("captures synchronous listener errors during safe dispatch", () => {
        const eventBus = new EventBus(new EventTarget());
        let laterListenerCalled = false;
        eventBus.on("before-upload-assets", () => {
            throw new Error("listener failed");
        });
        eventBus.on("before-upload-assets", () => {
            laterListenerCalled = true;
        });

        const result = emitWithErrors(eventBus, "before-upload-assets");

        assert.equal((result.error as Error).message, "listener failed");
        assert.equal(laterListenerCalled, false);
        destroyEventBus(eventBus);
    });

    it("reports prevention and asynchronous listeners during safe dispatch", async () => {
        const eventBus = new EventBus(new EventTarget());
        eventBus.on("before-upload-assets", async event => {
            event.preventDefault();
            await Promise.resolve();
        });

        const result = emitWithErrors(eventBus, "before-upload-assets");
        await Promise.resolve();

        assert.equal(result.defaultPrevented, true);
        assert.equal(result.hasAsyncListener, true);
        destroyEventBus(eventBus);
    });
});
