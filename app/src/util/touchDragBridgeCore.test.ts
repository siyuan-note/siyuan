import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    completeDrag,
    createDragRefreshQueue,
    dispatchWithNativeDragEnabled,
    restoreNativeDrag,
    shouldSuppressNativeContextMenu,
    suspendNativeDrag,
} from "./touchDragBridgeCore";

const createGuard = () => {
    let draggable = "true";
    const state = {
        draggableElement: {
            setAttribute: (name: string, value: string) => {
                if (name === "draggable") {
                    draggable = value;
                }
            },
        },
        restoreDraggable: false,
    };
    return {
        state,
        getDraggable: () => draggable,
    };
};

describe("touch drag native guard", () => {
    it("suspends native dragging until the synthetic dragstart is dispatched", () => {
        const guard = createGuard();

        suspendNativeDrag(guard.state);
        assert.equal(guard.getDraggable(), "false");

        let draggableDuringDispatch = "";
        dispatchWithNativeDragEnabled(guard.state, () => {
            draggableDuringDispatch = guard.getDraggable();
        });

        assert.equal(draggableDuringDispatch, "true");
        assert.equal(guard.getDraggable(), "false");
    });

    it("keeps native dragging suspended when dragstart dispatch throws", () => {
        const guard = createGuard();
        suspendNativeDrag(guard.state);

        assert.throws(() => dispatchWithNativeDragEnabled(guard.state, () => {
            throw new Error("dragstart failed");
        }));
        assert.equal(guard.getDraggable(), "false");
    });

    it("restores native dragging during cleanup", () => {
        const guard = createGuard();
        suspendNativeDrag(guard.state);

        restoreNativeDrag(guard.state);

        assert.equal(guard.getDraggable(), "true");
    });
});

describe("touch drag completion", () => {
    const runCompletion = (isDragging: boolean, canceled: boolean) => {
        const calls: string[] = [];
        completeDrag(isDragging, canceled, {
            drop: () => calls.push("drop"),
            dragEnd: () => calls.push("dragend"),
            cleanup: () => calls.push("cleanup"),
        });
        return calls;
    };

    it("dispatches drop and dragend before cleanup after a successful drag", () => {
        assert.deepEqual(runCompletion(true, false), ["drop", "dragend", "cleanup"]);
    });

    it("dispatches dragend before cleanup when a drag is canceled", () => {
        assert.deepEqual(runCompletion(true, true), ["dragend", "cleanup"]);
    });

    it("only cleans up when the long press did not become a drag", () => {
        assert.deepEqual(runCompletion(false, false), ["cleanup"]);
    });
});

describe("touch drag refresh queue", () => {
    const createFrameHarness = () => {
        let nextHandle = 0;
        const callbacks = new Map<number, FrameRequestCallback>();
        const canceled: number[] = [];
        return {
            requestFrame: (callback: FrameRequestCallback) => {
                const handle = ++nextHandle;
                callbacks.set(handle, callback);
                return handle;
            },
            cancelFrame: (handle: number) => {
                canceled.push(handle);
            },
            runFrame: (handle: number) => callbacks.get(handle)?.(0),
            getRequestedCount: () => callbacks.size,
            getCanceled: () => canceled,
        };
    };

    it("coalesces refreshes scheduled in the same frame", () => {
        const frames = createFrameHarness();
        let refreshCount = 0;
        const queue = createDragRefreshQueue(
            () => refreshCount++,
            frames.requestFrame,
            frames.cancelFrame,
        );

        queue.schedule();
        queue.schedule();

        assert.equal(frames.getRequestedCount(), 1);
        frames.runFrame(1);
        assert.equal(refreshCount, 1);
    });

    it("does not refresh after canceling a scheduled frame", () => {
        const frames = createFrameHarness();
        let refreshCount = 0;
        const queue = createDragRefreshQueue(
            () => refreshCount++,
            frames.requestFrame,
            frames.cancelFrame,
        );

        queue.schedule();
        queue.cancel();
        frames.runFrame(1);

        assert.deepEqual(frames.getCanceled(), [1]);
        assert.equal(refreshCount, 0);
    });

    it("allows scheduling again after a refresh", () => {
        const frames = createFrameHarness();
        let refreshCount = 0;
        const queue = createDragRefreshQueue(
            () => refreshCount++,
            frames.requestFrame,
            frames.cancelFrame,
        );

        queue.schedule();
        frames.runFrame(1);
        queue.schedule();
        frames.runFrame(2);

        assert.equal(refreshCount, 2);
        assert.equal(frames.getRequestedCount(), 2);
    });
});

describe("touch drag context menu", () => {
    it("only suppresses a trusted native menu during an active gesture", () => {
        assert.equal(shouldSuppressNativeContextMenu(true, true), true);
        assert.equal(shouldSuppressNativeContextMenu(false, true), false);
        assert.equal(shouldSuppressNativeContextMenu(true, false), false);
    });
});
