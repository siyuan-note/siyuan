import {after, before, describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {BottomBacklinkScroll} from "./bottomBacklinkScroll";

const originalGetComputedStyle = Object.getOwnPropertyDescriptor(globalThis, "getComputedStyle");
before(() => {
    Object.defineProperty(globalThis, "getComputedStyle", {
        configurable: true,
        value: (element: HTMLElement) => ({marginBottom: element.style.marginBottom}),
    });
});
after(() => {
    if (originalGetComputedStyle) {
        Object.defineProperty(globalThis, "getComputedStyle", originalGetComputedStyle);
    } else {
        Reflect.deleteProperty(globalThis, "getComputedStyle");
    }
});

const setup = (top = 200, marginBottom = "300px") => {
    const panel = {
        style: {minHeight: "", marginBottom},
        getBoundingClientRect: () => ({top}),
    } as unknown as HTMLElement;
    const viewport = {
        style: {overflowAnchor: "auto"},
        clientHeight: 600,
        clientTop: 2,
        getBoundingClientRect: () => ({top: 20}),
    } as unknown as HTMLElement;
    return {panel, viewport, guard: new BottomBacklinkScroll(panel, viewport)};
};

describe("bottom backlink toggle scroll", () => {
    it("reserves only the visible footprint after accounting for the typewriter margin", () => {
        const {panel, viewport, guard} = setup();
        const finish = guard.begin();
        assert.equal(panel.style.minHeight, "122px");
        assert.equal(viewport.style.overflowAnchor, "none");
        finish();
        assert.equal(viewport.style.overflowAnchor, "auto");
        assert.equal(panel.style.minHeight, "122px");
    });

    it("preserves the scroll range without a typewriter margin", () => {
        const {panel, guard} = setup(200, "0px");
        guard.begin();
        assert.equal(panel.style.minHeight, "422px");
    });

    it("does not shrink below the panel minimum when the margin fills the viewport", () => {
        const {panel, guard} = setup(500);
        guard.begin();
        assert.equal(panel.style.minHeight, "32px");
    });

    it("keeps anchoring disabled until both sections finish animating", () => {
        const {viewport, guard} = setup();
        const finishBacklinks = guard.begin();
        const finishMentions = guard.begin();
        finishBacklinks();
        finishBacklinks();
        assert.equal(viewport.style.overflowAnchor, "none");
        finishMentions();
        assert.equal(viewport.style.overflowAnchor, "auto");
    });

    it("releases styles on cancellation and ignores stale animation callbacks", () => {
        const {panel, viewport, guard} = setup();
        const oldFinish = guard.begin();
        guard.reset();
        assert.equal(panel.style.minHeight, "");
        assert.equal(viewport.style.overflowAnchor, "auto");
        const finish = guard.begin();
        oldFinish();
        assert.equal(viewport.style.overflowAnchor, "none");
        finish();
        assert.equal(viewport.style.overflowAnchor, "auto");
    });
});
