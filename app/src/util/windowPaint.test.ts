import * as assert from "node:assert/strict";
import {test} from "node:test";
import {ScriptTarget} from "typescript";
import {loadModule} from "../testSupport/loadModule";

const fixture = () => {
    let id = 0;
    let disconnected = false;
    const frames = new Map<number, () => void>();
    const timers = new Map<number, () => void>();
    const listeners = new Map<string, () => void>();
    const styles: unknown[] = [];
    const exports = loadModule<typeof import("./windowPaint")>("src/util/windowPaint.ts", {
        document: {head: {querySelectorAll: () => styles}},
        MutationObserver: class {observe() {} disconnect() { disconnected = true; }},
        window: {
            setTimeout: (callback: () => void, delay: number) => {
                assert.equal(delay, 250);
                timers.set(++id, callback);
                return id;
            }, clearTimeout: (timer: number) => timers.delete(timer),
        },
        requestAnimationFrame: (callback: () => void) => { frames.set(++id, callback); return id; },
        cancelAnimationFrame: (frame: number) => frames.delete(frame),
    }, ScriptTarget.ES2021);
    const addStyle = () => styles.push({isConnected: true, disabled: false, sheet: null,
        addEventListener: (name: string, callback: () => void) => listeners.set(name, callback),
        removeEventListener: (name: string) => listeners.delete(name),
    });
    const nextFrame = () => {
        const callbacks = [...frames.values()];
        frames.clear();
        callbacks.forEach(callback => callback());
    };
    return {wait: exports.waitForWindowPaint, frames, timers, listeners, addStyle, nextFrame,
        disconnected: () => disconnected};
};

for (const finishBy of ["frames", "timeout"]) {
    test(`settings paint waits for styles and releases frame resources on ${finishBy}`, async () => {
        const f = fixture();
        let complete = false;
        const pending = f.wait(async () => { f.addStyle(); }).then(() => { complete = true; });
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(f.timers.size, 0);
        assert.equal(f.frames.size, 0);
        assert.equal(complete, false);
        f.listeners.get("load")();
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(f.timers.size, 1);
        f.nextFrame();
        assert.equal(complete, false);
        if (finishBy === "frames") f.nextFrame();
        else [...f.timers.values()][0]();
        await pending;
        assert.equal(f.frames.size, 0);
        assert.equal(f.timers.size, 0);
        assert.equal(f.listeners.size, 0);
        assert.equal(f.disconnected(), true);
    });
}

test("settings paint releases its observer when rendering fails", async () => {
    const f = fixture();
    await assert.rejects(f.wait(async () => { throw new Error("render failed"); }), /render failed/);
    assert.equal(f.disconnected(), true);
    assert.equal(f.frames.size, 0);
    assert.equal(f.timers.size, 0);
});
