import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {waitForSheetViewport} from "./sheetOpen";

const setup = (initialHeight: number) => {
    let height = initialHeight;
    let time = 0;
    let sequence = 0;
    let opened = 0;
    const frames = new Map<number, () => void>();
    const cancel = waitForSheetViewport({
        height: () => height,
        fullHeight: 808,
        now: () => time,
        requestFrame: callback => {
            frames.set(++sequence, callback);
            return sequence;
        },
        cancelFrame: id => { frames.delete(id); },
        open: () => { opened++; },
    });
    return {
        cancel,
        opened: () => opened,
        tick: (nextTime: number, nextHeight = height) => {
            time = nextTime;
            height = nextHeight;
            const callbacks = Array.from(frames.values());
            frames.clear();
            callbacks.forEach(callback => callback());
        },
    };
};

describe("mobile sheet opening", () => {
    it("opens on the next frame without a keyboard", () => {
        const state = setup(808);
        state.tick(16);
        assert.equal(state.opened(), 1);
    });

    it("stays offscreen throughout a slow keyboard dismissal", () => {
        const state = setup(476);
        state.tick(16);
        state.tick(100, 550);
        state.tick(200, 700);
        state.tick(300, 808);
        state.tick(316);
        assert.equal(state.opened(), 0);
        state.tick(332);
        assert.equal(state.opened(), 1);
    });

    it("waits again when the viewport shrinks during restoration", () => {
        const state = setup(476);
        state.tick(50, 808);
        state.tick(66, 780);
        state.tick(100, 808);
        assert.equal(state.opened(), 0);
        state.tick(132);
        assert.equal(state.opened(), 1);
    });

    it("does not reopen a dismissed or replaced menu", () => {
        const state = setup(476);
        state.tick(100, 600);
        state.cancel();
        state.tick(1200, 808);
        assert.equal(state.opened(), 0);
    });

    it("eventually opens if the recorded full height is no longer reachable", () => {
        const state = setup(476);
        state.tick(999, 700);
        assert.equal(state.opened(), 0);
        state.tick(1000);
        assert.equal(state.opened(), 1);
        state.tick(1200);
        assert.equal(state.opened(), 1);
    });
});
