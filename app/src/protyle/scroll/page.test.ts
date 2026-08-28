import {strict as assert} from "node:assert";
import {describe, it} from "node:test";
import {getPageScrollTop} from "./page";

describe("getPageScrollTop", () => {
    it("keeps a 60-pixel overlap between pages", () => {
        assert.equal(getPageScrollTop(1_000, 5_000, 800, "up"), 260);
        assert.equal(getPageScrollTop(1_000, 5_000, 800, "down"), 1_740);
    });

    it("limits scrolling to the content boundaries", () => {
        assert.equal(getPageScrollTop(100, 5_000, 800, "up"), 0);
        assert.equal(getPageScrollTop(4_000, 5_000, 800, "down"), 4_200);
    });

    it("does not reverse direction when the viewport is shorter than the overlap", () => {
        assert.equal(getPageScrollTop(100, 500, 40, "up"), 100);
        assert.equal(getPageScrollTop(100, 500, 40, "down"), 100);
    });
});
