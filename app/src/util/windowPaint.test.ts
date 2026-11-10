import * as assert from "node:assert/strict";
import {test} from "node:test";
import {ScriptTarget} from "typescript";
import {loadModule} from "../testSupport/loadModule";

const fixture = () => {
    let id = 0;
    let disconnected = false;
    let collectStyles: () => void;
    const frames = new Map<number, () => void>();
    const timers = new Map<number, {callback: () => void, delay: number}>();
    const warnings: string[] = [];
    const styles: unknown[] = [];
    const exports = loadModule<typeof import("./windowPaint")>("src/util/windowPaint.ts", {
        document: {head: {querySelectorAll: () => styles}},
        MutationObserver: class {
            constructor(callback: () => void) { collectStyles = callback; }
            observe() {}
            disconnect() { disconnected = true; }
        },
        console: {warn: (message: string) => warnings.push(message)},
        window: {
            setTimeout: (callback: () => void, delay: number) => {
                timers.set(++id, {callback, delay});
                return id;
            }, clearTimeout: (timer: number) => timers.delete(timer),
        },
        requestAnimationFrame: (callback: () => void) => { frames.set(++id, callback); return id; },
        cancelAnimationFrame: (frame: number) => frames.delete(frame),
    }, ScriptTarget.ES2021);
    const addStyle = () => {
        const listeners = new Map<string, () => void>();
        const style = {isConnected: true, disabled: false, sheet: null as object | null, listeners,
            addEventListener: (name: string, callback: () => void) => listeners.set(name, callback),
            removeEventListener: (name: string) => listeners.delete(name),
        };
        styles.push(style);
        return style;
    };
    const nextFrame = () => {
        const callbacks = [...frames.values()];
        frames.clear();
        callbacks.forEach(callback => callback());
    };
    const timeout = (delay: number) => {
        const timer = [...timers.entries()].find(([, timer]) => timer.delay === delay);
        assert.ok(timer, `expected a ${delay} ms timeout`);
        timers.delete(timer[0]);
        timer[1].callback();
    };
    return {wait: exports.waitForWindowPaint, frames, timers, warnings, addStyle, nextFrame, timeout,
        mutate: () => collectStyles(), disconnected: () => disconnected};
};

const flush = () => new Promise(resolve => setImmediate(resolve));

for (const finishBy of ["frames", "timeout"]) {
    for (const event of ["load", "error"]) {
        test(`window paint waits for stylesheet ${event} and releases frame resources on ${finishBy}`, async () => {
            const f = fixture();
            let complete = false;
            let style: ReturnType<typeof f.addStyle>;
            const pending = f.wait(async () => { style = f.addStyle(); }).then(() => { complete = true; });
            await flush();
            assert.deepEqual([...f.timers.values()].map(timer => timer.delay), [5000]);
            assert.equal(f.frames.size, 0);
            assert.equal(complete, false);
            style.listeners.get(event)();
            await flush();
            assert.deepEqual([...f.timers.values()].map(timer => timer.delay), [250]);
            f.nextFrame();
            assert.equal(complete, false);
            if (finishBy === "frames") f.nextFrame();
            else f.timeout(250);
            await pending;
            assert.equal(f.frames.size, 0);
            assert.equal(f.timers.size, 0);
            assert.equal(style.listeners.size, 0);
            assert.equal(f.disconnected(), true);
            assert.deepEqual(f.warnings, []);
        });
    }
}

for (const finishBy of ["frames", "timeout"]) {
    test(`window paint bounds stalled stylesheets and finishes on ${finishBy}`, async () => {
        const f = fixture();
        const styles: ReturnType<typeof f.addStyle>[] = [];
        let complete = false;
        const pending = f.wait(async () => {
            styles.push(f.addStyle(), f.addStyle());
            f.mutate();
        }).then(() => { complete = true; });
        await flush();
        const timer = [...f.timers.keys()][0];
        styles.push(f.addStyle());
        f.mutate();
        assert.deepEqual([...f.timers.keys()], [timer]);
        styles[0].listeners.get("load")();
        await flush();
        assert.equal(complete, false);
        assert.equal(f.frames.size, 0);
        f.timeout(5000);
        assert.ok(styles.every(style => style.listeners.size === 0));
        assert.ok(styles.every(style => style.isConnected && !style.disabled));
        await flush();
        assert.deepEqual([...f.timers.values()].map(timer => timer.delay), [250]);
        assert.equal(complete, false);
        if (finishBy === "frames") {
            f.nextFrame();
            f.nextFrame();
        } else {
            f.timeout(250);
        }
        await pending;
        assert.equal(complete, true);
        assert.equal(f.disconnected(), true);
        assert.equal(f.frames.size, 0);
        assert.equal(f.timers.size, 0);
        assert.equal(f.warnings.length, 1);
        styles[1].sheet = {};
        styles[1].listeners.get("load")?.();
        assert.equal(f.frames.size, 0);
        assert.equal(f.timers.size, 0);
    });
}

test("window paint skips existing, loaded and disabled stylesheets", async () => {
    const f = fixture();
    const existing = f.addStyle();
    const pending = f.wait(async () => {
        f.addStyle().disabled = true;
        f.addStyle().sheet = {};
    });
    await flush();
    assert.equal(existing.listeners.size, 0);
    assert.deepEqual([...f.timers.values()].map(timer => timer.delay), [250]);
    f.nextFrame();
    f.nextFrame();
    await pending;
    assert.equal(f.timers.size, 0);
    assert.deepEqual(f.warnings, []);
});

test("window paint releases removed stylesheets before the deadline", async () => {
    const f = fixture();
    let style: ReturnType<typeof f.addStyle>;
    const pending = f.wait(async () => { style = f.addStyle(); });
    await flush();
    style.isConnected = false;
    f.mutate();
    await flush();
    assert.equal(style.listeners.size, 0);
    assert.deepEqual([...f.timers.values()].map(timer => timer.delay), [250]);
    f.timeout(250);
    await pending;
    assert.equal(f.timers.size, 0);
    assert.deepEqual(f.warnings, []);
});

test("window paint releases its observer and stylesheet listeners when rendering fails", async () => {
    const f = fixture();
    let style: ReturnType<typeof f.addStyle>;
    await assert.rejects(f.wait(async () => {
        style = f.addStyle();
        f.mutate();
        throw new Error("render failed");
    }), /render failed/);
    assert.equal(style.listeners.size, 0);
    assert.equal(f.disconnected(), true);
    assert.equal(f.frames.size, 0);
    assert.equal(f.timers.size, 0);
    assert.deepEqual(f.warnings, []);
});
