import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    createMobileBarsState,
    getMobileBarsVisibility,
    reduceMobileBarsState,
    type IMobileBarsScrollOptions,
    type IMobileBarsState,
    type MobileBarsAction,
} from "./mobileBarsState";

const scrollOptions: IMobileBarsScrollOptions = {
    hideThreshold: 30,
    showThreshold: 12,
    topThreshold: 4,
};

const update = (state: IMobileBarsState, action: MobileBarsAction) => {
    return reduceMobileBarsState(state, action, scrollOptions);
};

describe("mobile bars state", () => {
    it("uses asymmetric default thresholds to avoid flicker", () => {
        let state = createMobileBarsState();
        state = reduceMobileBarsState(state, {type: "scroll", scrollTop: 63});
        assert.equal(state.readingBarsVisible, true);
        state = reduceMobileBarsState(state, {type: "scroll", scrollTop: 64});
        assert.equal(state.readingBarsVisible, false);
        state = reduceMobileBarsState(state, {type: "scroll", scrollTop: 33});
        assert.equal(state.readingBarsVisible, false);
        state = reduceMobileBarsState(state, {type: "scroll", scrollTop: 32});
        assert.equal(state.readingBarsVisible, true);
    });

    it("shows reading bars initially and supports explicit visibility changes", () => {
        let state = createMobileBarsState();
        assert.deepEqual(getMobileBarsVisibility(state), {
            readingBarsVisible: true,
            editingBarVisible: false,
            scrollPaused: false,
        });

        state = update(state, {type: "set-reading-bars", visible: false});
        assert.equal(state.readingBarsVisible, false);
        state = update(state, {type: "set-reading-bars", visible: true});
        assert.equal(state.readingBarsVisible, true);
    });

    it("hides reading bars after cumulative downward movement", () => {
        let state = createMobileBarsState();
        state = update(state, {type: "scroll", scrollTop: 10});
        state = update(state, {type: "scroll", scrollTop: 24});
        assert.equal(state.readingBarsVisible, true);
        assert.equal(state.scrollDistance, 24);

        state = update(state, {type: "scroll", scrollTop: 31});
        assert.equal(state.readingBarsVisible, false);
        assert.equal(state.scrollDistance, 0);
    });

    it("restarts accumulation when the scroll direction changes", () => {
        let state = createMobileBarsState();
        state = update(state, {type: "scroll", scrollTop: 20});
        state = update(state, {type: "scroll", scrollTop: 18});
        state = update(state, {type: "scroll", scrollTop: 35});

        assert.equal(state.readingBarsVisible, true);
        assert.equal(state.scrollDirection, "down");
        assert.equal(state.scrollDistance, 17);
    });

    it("shows hidden reading bars after cumulative upward movement", () => {
        let state = createMobileBarsState(80);
        state = update(state, {type: "set-reading-bars", visible: false});
        state = update(state, {type: "scroll", scrollTop: 72});
        assert.equal(state.readingBarsVisible, false);

        state = update(state, {type: "scroll", scrollTop: 66});
        assert.equal(state.readingBarsVisible, true);
        assert.equal(state.scrollDistance, 0);
    });

    it("forces reading bars to show near the top", () => {
        let state = createMobileBarsState(80);
        state = update(state, {type: "set-reading-bars", visible: false});
        state = update(state, {type: "scroll", scrollTop: 4});

        assert.equal(state.readingBarsVisible, true);
        assert.equal(state.scrollDirection, undefined);
        assert.equal(state.scrollDistance, 0);
    });

    it("gives the editing bar priority and restores reading bars after editing", () => {
        let state = createMobileBarsState(100);
        state = update(state, {type: "set-editing", active: true});
        assert.deepEqual(getMobileBarsVisibility(state), {
            readingBarsVisible: false,
            editingBarVisible: true,
            scrollPaused: true,
        });

        state = update(state, {type: "set-reading-bars", visible: true});
        state = update(state, {type: "scroll", scrollTop: 180});
        assert.equal(state.readingBarsVisible, false);
        assert.equal(state.scrollTop, 180);

        state = update(state, {type: "set-editing", active: false, scrollTop: 180});
        assert.deepEqual(getMobileBarsVisibility(state), {
            readingBarsVisible: true,
            editingBarVisible: false,
            scrollPaused: false,
        });
    });

    it("preserves hidden reading bars when the keyboard is already closed", () => {
        let state = createMobileBarsState(100);
        state = update(state, {type: "set-reading-bars", visible: false});
        state = update(state, {type: "set-editing", active: false, scrollTop: 100});

        assert.deepEqual(getMobileBarsVisibility(state), {
            readingBarsVisible: false,
            editingBarVisible: false,
            scrollPaused: false,
        });
    });

    it("gives selection priority and restores reading bars after selection", () => {
        let state = createMobileBarsState(100);
        state = update(state, {type: "set-selecting", active: true});
        assert.deepEqual(getMobileBarsVisibility(state), {
            readingBarsVisible: false,
            editingBarVisible: false,
            scrollPaused: true,
        });

        state = update(state, {type: "scroll", scrollTop: 180});
        assert.equal(state.scrollDistance, 0);
        state = update(state, {type: "set-selecting", active: false, scrollTop: 180});
        assert.deepEqual(getMobileBarsVisibility(state), {
            readingBarsVisible: true,
            editingBarVisible: false,
            scrollPaused: false,
        });
    });

    it("preserves visible reading bars while a panel opens and closes", () => {
        let state = createMobileBarsState(100);
        state = update(state, {type: "set-panel-open", open: true});
        assert.equal(getMobileBarsVisibility(state).readingBarsVisible, true);
        assert.equal(getMobileBarsVisibility(state).scrollPaused, true);
        state = update(state, {type: "scroll", scrollTop: 200});
        assert.equal(state.readingBarsVisible, true);
        assert.equal(state.scrollDistance, 0);

        state = update(state, {type: "set-panel-open", open: false, scrollTop: 200});
        assert.equal(getMobileBarsVisibility(state).readingBarsVisible, true);
        state = update(state, {type: "scroll", scrollTop: 220});
        assert.equal(state.readingBarsVisible, true);
        state = update(state, {type: "scroll", scrollTop: 231});
        assert.equal(state.readingBarsVisible, false);
    });

    it("preserves hidden reading bars while a panel opens and closes", () => {
        let state = createMobileBarsState(100);
        state = update(state, {type: "set-reading-bars", visible: false});
        state = update(state, {type: "set-panel-open", open: true, scrollTop: 0});
        assert.equal(getMobileBarsVisibility(state).readingBarsVisible, false);
        assert.equal(getMobileBarsVisibility(state).scrollPaused, true);

        state = update(state, {type: "set-panel-open", open: false, scrollTop: 0});
        assert.equal(getMobileBarsVisibility(state).readingBarsVisible, false);
        assert.equal(getMobileBarsVisibility(state).scrollPaused, false);
    });

    it("pauses programmatic scrolling and applies the top rule after resuming", () => {
        let state = createMobileBarsState(100);
        state = update(state, {type: "set-programmatic-scrolling", active: true});
        state = update(state, {type: "scroll", scrollTop: 260});
        state = update(state, {type: "set-programmatic-scrolling", active: false, scrollTop: 260});
        state = update(state, {type: "scroll", scrollTop: 278});
        assert.equal(state.readingBarsVisible, true);
        state = update(state, {type: "scroll", scrollTop: 291});
        assert.equal(state.readingBarsVisible, false);

        state = update(state, {type: "set-programmatic-scrolling", active: true});
        state = update(state, {type: "scroll", scrollTop: 0});
        assert.equal(state.readingBarsVisible, false);
        state = update(state, {type: "set-programmatic-scrolling", active: false, scrollTop: 0});
        assert.equal(state.readingBarsVisible, true);
    });

    it("rebases layout-driven scrolling while the bars transition", () => {
        let state = createMobileBarsState(100);
        state = update(state, {type: "set-bars-transitioning", active: true, scrollTop: 100});
        state = update(state, {type: "scroll", scrollTop: 180});
        assert.equal(state.readingBarsVisible, true);
        assert.equal(state.scrollTop, 180);

        state = update(state, {type: "set-bars-transitioning", active: false, scrollTop: 180});
        state = update(state, {type: "set-reading-bars", visible: false});
        state = update(state, {type: "set-bars-transitioning", active: true, scrollTop: 100});
        state = update(state, {type: "scroll", scrollTop: 40});

        assert.equal(state.readingBarsVisible, false);
        assert.equal(state.scrollTop, 40);
        assert.equal(state.scrollDirection, undefined);
        assert.equal(state.scrollDistance, 0);
        assert.equal(getMobileBarsVisibility(state).scrollPaused, true);

        state = update(state, {type: "set-bars-transitioning", active: false, scrollTop: 40});
        assert.equal(state.readingBarsVisible, false);
        assert.equal(getMobileBarsVisibility(state).scrollPaused, false);
        state = update(state, {type: "scroll", scrollTop: 34});
        assert.equal(state.readingBarsVisible, false);
        state = update(state, {type: "scroll", scrollTop: 28});
        assert.equal(state.readingBarsVisible, true);
    });

    it("resets transient state when the document changes", () => {
        let state = createMobileBarsState(100);
        state = update(state, {type: "set-editing", active: true});
        state = update(state, {type: "set-panel-open", open: true});
        state = update(state, {type: "set-programmatic-scrolling", active: true});
        state = update(state, {type: "set-bars-transitioning", active: true});
        state = update(state, {type: "document-changed", scrollTop: 12});

        assert.deepEqual(state, createMobileBarsState(12));
    });
});
