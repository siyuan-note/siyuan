import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getZIndex, isAbove, isScrollAboveMenu} from "./zIndex";

const element = (zIndex = "", parentElement: HTMLElement = null, classes: string[] = []): HTMLElement => ({
    style: {zIndex},
    parentElement,
    classList: {contains: (name: string) => classes.includes(name)},
} as HTMLElement);

describe("overlay stacking and menu scrolling", () => {
    it("compares layers numerically across digit boundaries", () => {
        for (const [lower, upper] of [[9, 10], [99, 100], [999, 1000]]) {
            assert.equal(isAbove(element(String(upper)), element(String(lower))), true);
            assert.equal(isAbove(element(String(lower)), element(String(upper))), false);
        }
        assert.equal(isAbove(element("100"), element("100")), false);
        assert.equal(getZIndex(element("auto")), 0);
        assert.equal(getZIndex(element()), 0);
    });

    it("allows menu contents and higher overlays while keeping the background locked", () => {
        const menu = element("99");
        const overlay = element("100");
        assert.equal(isScrollAboveMenu(element("", element("", menu)), menu), true);
        assert.equal(isScrollAboveMenu(element("", element("", overlay)), menu), true);
        assert.equal(isScrollAboveMenu(element(), menu), false);
        assert.equal(isScrollAboveMenu(element("", element("98")), menu), false);
        assert.equal(isScrollAboveMenu(element("99"), menu), false);
        overlay.style.zIndex = "98";
        assert.equal(isScrollAboveMenu(element("", overlay), menu), false);
    });

    it("preserves stylesheet-based tooltip and mobile keyboard scrolling", () => {
        for (const name of ["tooltip", "keyboard__bar"]) {
            assert.equal(isScrollAboveMenu(element("", element("", null, [name])), element("100")), true);
        }
    });
});
