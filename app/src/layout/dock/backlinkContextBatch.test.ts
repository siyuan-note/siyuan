import * as assert from "node:assert/strict";
import {test} from "node:test";
import {BacklinkContextBatch} from "./backlinkContextBatch";

const settle = () => new Promise<void>(resolve => setImmediate(resolve));

const setup = () => {
    const frames = new Map<number, FrameRequestCallback>();
    let next = 0;
    const previous = globalThis.window;
    globalThis.window = {
        requestAnimationFrame: (callback: FrameRequestCallback) => {
            frames.set(++next, callback);
            return next;
        },
        cancelAnimationFrame: (id: number) => frames.delete(id),
    } as unknown as Window & typeof globalThis;
    return {
        batch: new BacklinkContextBatch(), frames,
        frame: () => {
            const callbacks = [...frames.values()];
            frames.clear();
            callbacks.forEach(callback => callback(0));
        },
        dispose: () => { globalThis.window = previous; },
    };
};

test("context responses capture each viewport once before rendering and restore once after all renders", async () => {
    const {batch, frames, frame, dispose} = setup();
    try {
        const events: string[] = [];
        let finish: () => void;
        const slow = new Promise<void>(resolve => { finish = resolve; });
        const promises = Array.from({length: 16}, (_, index) => batch.enqueue({
            key: index % 2,
            isCurrent: () => true,
            capture: () => {
                events.push(`capture:${index % 2}`);
                return () => events.push(`restore:${index % 2}`);
            },
            render: () => {
                events.push(`render:${index}`);
                return index === 0 ? slow : Promise.resolve();
            },
        }));
        assert.equal(frames.size, 1);
        assert.deepEqual(events, []);
        frame();
        assert.deepEqual(events.slice(0, 2), ["capture:0", "capture:1"]);
        assert.equal(events.filter(event => event.startsWith("render:")).length, 16);
        await Promise.all(promises.filter((_, index) => index % 2 === 1));
        await settle();
        frame();
        assert.deepEqual(events.filter(event => event.startsWith("restore:")), ["restore:1"]);
        finish();
        await Promise.all(promises);
        await settle();
        frame();
        assert.deepEqual(events.filter(event => event.startsWith("restore:")), ["restore:1", "restore:0"]);
    } finally {
        dispose();
    }
});

test("stale, cancelled and superseded context renders cannot restore an old reading position", async () => {
    const {batch, frame, dispose} = setup();
    try {
        let current = true;
        let captures = 0;
        let restores = 0;
        let renders = 0;
        const enqueue = () => batch.enqueue({
            key: 0,
            isCurrent: () => current,
            capture: () => { captures++; return () => { restores++; }; },
            render: async () => { renders++; },
        });
        current = false;
        const stale = enqueue();
        frame();
        await stale;
        assert.equal(captures, 0);
        current = true;
        const cancelled = enqueue();
        batch.clear();
        frame();
        await cancelled;
        assert.equal(renders, 0);
        const first = enqueue();
        frame();
        await first;
        await settle();
        batch.clear();
        frame();
        assert.equal(restores, 0);
        const second = enqueue();
        frame();
        await second;
        await settle();
        current = false;
        frame();
        assert.equal(restores, 0);
        current = true;
        let finish: () => void;
        const older = batch.enqueue({key: 0, isCurrent: () => true,
            capture: () => () => { restores += 100; },
            render: () => new Promise<void>(resolve => { finish = resolve; })});
        frame();
        const newer = enqueue();
        frame();
        await newer;
        await settle();
        frame();
        assert.equal(restores, 1);
        finish();
        await older;
        await settle();
        frame();
        assert.equal(restores, 1);
    } finally {
        dispose();
    }
});

test("one failed context does not prevent the other contexts or anchor restoration", async () => {
    const {batch, frame, dispose} = setup();
    try {
        let restores = 0;
        const update = {key: 0, isCurrent: () => true,
            capture: () => () => { restores++; }, render: async () => {}};
        const failed = assert.rejects(batch.enqueue({...update, render: () => { throw new Error("failed"); }}), /failed/);
        const good = batch.enqueue(update);
        frame();
        await Promise.all([failed, good]);
        await settle();
        frame();
        assert.equal(restores, 1);
    } finally {
        dispose();
    }
});
