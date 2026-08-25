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
    maxOffset: 30,
};

const update = (state: IMobileBarsState, action: MobileBarsAction) => {
    return reduceMobileBarsState(state, action, scrollOptions);
};

const getVisibility = (state: IMobileBarsState) => {
    return getMobileBarsVisibility(state, scrollOptions);
};

describe("mobile bars state", () => {
    it("moves the reading bars by the scroll distance and clamps the offset", () => {
        let state = createMobileBarsState();
        state = update(state, {type: "scroll", scrollTop: 12});
        assert.equal(state.readingBarsOffset, 12);

        state = update(state, {type: "scroll", scrollTop: 35});
        assert.equal(state.readingBarsOffset, 30);

        state = update(state, {type: "scroll", scrollTop: 60});
        assert.equal(state.readingBarsOffset, 30);

        state = update(state, {type: "scroll", scrollTop: 51});
        assert.equal(state.readingBarsOffset, 21);

        state = update(state, {type: "scroll", scrollTop: 20});
        assert.equal(state.readingBarsOffset, 0);
    });

    it("reacts immediately when the scroll direction changes", () => {
        let state = createMobileBarsState();
        state = update(state, {type: "scroll", scrollTop: 18});
        state = update(state, {type: "scroll", scrollTop: 15});
        assert.equal(state.readingBarsOffset, 15);

        state = update(state, {type: "scroll", scrollTop: 19});
        assert.equal(state.readingBarsOffset, 19);
    });

    it("never hides the reading bars beyond the available top scroll distance", () => {
        let state = createMobileBarsState(8);
        state = update(state, {type: "set-reading-bars", visible: false});
        state = update(state, {type: "scroll", scrollTop: 8});
        assert.equal(state.readingBarsOffset, 8);

        state = update(state, {type: "scroll", scrollTop: 0});
        assert.equal(state.readingBarsOffset, 0);
    });

    it("shows reading bars initially and supports explicit visibility changes", () => {
        let state = createMobileBarsState();
        assert.deepEqual(getVisibility(state), {
            topbarVisible: true,
            bottomBarVisible: true,
            editingBarVisible: false,
            scrollPaused: false,
        });

        state = update(state, {type: "set-reading-bars", visible: false});
        assert.equal(state.readingBarsOffset, 30);
        assert.equal(getVisibility(state).topbarVisible, false);

        state = update(state, {type: "set-reading-bars", visible: true});
        assert.equal(state.readingBarsOffset, 0);
        assert.equal(getVisibility(state).topbarVisible, true);
    });

    it("keeps the visible reading state while editing", () => {
        let state = createMobileBarsState(100);
        state = update(state, {type: "set-editing", active: true});
        assert.deepEqual(getVisibility(state), {
            topbarVisible: true,
            bottomBarVisible: false,
            editingBarVisible: true,
            scrollPaused: true,
        });

        state = update(state, {type: "scroll", scrollTop: 180});
        assert.equal(state.readingBarsOffset, 0);
        assert.equal(state.scrollTop, 180);

        state = update(state, {type: "set-editing", active: false, scrollTop: 180});
        assert.equal(getVisibility(state).bottomBarVisible, true);
    });

    it("keeps the hidden reading state while editing", () => {
        let state = createMobileBarsState(100);
        state = update(state, {type: "set-reading-bars", visible: false});
        state = update(state, {type: "set-editing", active: true, scrollTop: 100});
        state = update(state, {type: "scroll", scrollTop: 180});
        assert.equal(state.readingBarsOffset, 30);

        state = update(state, {type: "set-editing", active: false, scrollTop: 180});
        assert.deepEqual(getVisibility(state), {
            topbarVisible: false,
            bottomBarVisible: false,
            editingBarVisible: false,
            scrollPaused: false,
        });
    });

    it("preserves the reading state while selecting", () => {
        let state = createMobileBarsState(100);
        state = update(state, {type: "scroll", scrollTop: 115});
        state = update(state, {type: "set-selecting", active: true});
        state = update(state, {type: "scroll", scrollTop: 180});
        assert.equal(state.readingBarsOffset, 15);
        assert.equal(getVisibility(state).bottomBarVisible, false);

        state = update(state, {type: "set-selecting", active: false, scrollTop: 180});
        state = update(state, {type: "scroll", scrollTop: 185});
        assert.equal(state.readingBarsOffset, 20);
    });

    it("preserves the reading state while a panel opens and closes", () => {
        let state = createMobileBarsState(100);
        state = update(state, {type: "scroll", scrollTop: 120});
        state = update(state, {type: "set-panel-open", open: true});
        state = update(state, {type: "scroll", scrollTop: 200});
        assert.equal(state.readingBarsOffset, 20);

        state = update(state, {type: "set-panel-open", open: false, scrollTop: 200});
        state = update(state, {type: "scroll", scrollTop: 205});
        assert.equal(state.readingBarsOffset, 25);
    });

    it("rebases programmatic scrolling and shows the bars when it finishes at the top", () => {
        let state = createMobileBarsState(100);
        state = update(state, {type: "set-reading-bars", visible: false});
        state = update(state, {type: "set-programmatic-scrolling", active: true});
        state = update(state, {type: "scroll", scrollTop: 260});
        state = update(state, {type: "set-programmatic-scrolling", active: false, scrollTop: 260});
        assert.equal(state.readingBarsOffset, 30);

        state = update(state, {type: "set-programmatic-scrolling", active: true});
        state = update(state, {type: "scroll", scrollTop: 0});
        state = update(state, {type: "set-programmatic-scrolling", active: false, scrollTop: 0});
        assert.equal(state.readingBarsOffset, 0);
    });

    it("resets transient state and the reading offset when the document changes", () => {
        let state = createMobileBarsState(100);
        state = update(state, {type: "set-reading-bars", visible: false});
        state = update(state, {type: "set-editing", active: true});
        state = update(state, {type: "set-panel-open", open: true});
        state = update(state, {type: "set-programmatic-scrolling", active: true});
        state = update(state, {type: "document-changed", scrollTop: 12});

        assert.deepEqual(state, createMobileBarsState(12));
    });
});
