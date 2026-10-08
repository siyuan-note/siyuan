import {test} from "node:test";
import * as assert from "node:assert/strict";
import {startMountedPolling} from "./mountedPolling";

test("polling stops on removal and replacing a mount disposes the previous timer", (t) => {
    const callbacks: (() => void)[] = [];
    const cleared: number[] = [];
    const disconnected: number[] = [];
    let rendered = 0;
    let nextTimer = 0;
    const values = {
        window: {setInterval: () => ++nextTimer, clearInterval: (id: number) => cleared.push(id)},
        document: {body: {}},
        MutationObserver: class {
            private id: number;
            constructor(callback: () => void) {
                this.id = callbacks.push(callback);
            }
            observe() {}
            disconnect() { disconnected.push(this.id); }
        },
    };
    for (const [name, value] of Object.entries(values)) {
        const original = Object.getOwnPropertyDescriptor(globalThis, name);
        Object.defineProperty(globalThis, name, {value, configurable: true});
        t.after(() => {
            if (original) Object.defineProperty(globalThis, name, original);
            else Reflect.deleteProperty(globalThis, name);
        });
    }
    const block = {isConnected: true} as Element;
    startMountedPolling(block, () => rendered++);
    callbacks[0]();
    assert.deepEqual(cleared, []);
    startMountedPolling(block, () => rendered++);
    assert.equal(rendered, 2);
    assert.deepEqual(cleared, [1]);
    assert.deepEqual(disconnected, [1]);
    Object.assign(block, {isConnected: false});
    callbacks[1]();
    assert.deepEqual(cleared, [1, 2]);
    assert.deepEqual(disconnected, [1, 2]);
});
