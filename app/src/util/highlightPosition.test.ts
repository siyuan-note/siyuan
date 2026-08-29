import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getStartScrollTop} from "./highlightPosition";

const baseOptions = {
    scrollTop: 300,
    elementTop: 700,
    contentTop: 100,
    contextHeight: 76,
};

describe("highlight start position", () => {
    it("keeps the existing position for a breadcrumb in normal flow", () => {
        assert.equal(getStartScrollTop({
            ...baseOptions,
            overlay: {
                absolute: false,
                offsetParentTop: 52,
                offsetTop: 0,
                height: 48,
            },
        }), 824);
    });

    it("places the target below the untransformed portrait mobile bars", () => {
        assert.equal(getStartScrollTop({
            ...baseOptions,
            overlay: {
                absolute: true,
                offsetParentTop: 100,
                offsetTop: 48,
                height: 42,
            },
        }), 734);
    });

    it("uses only the breadcrumb height for the merged landscape top bar", () => {
        assert.equal(getStartScrollTop({
            ...baseOptions,
            overlay: {
                absolute: true,
                offsetParentTop: 100,
                offsetTop: 0,
                height: 42,
            },
        }), 782);
    });

    it("does not move the visible top above the content viewport", () => {
        assert.equal(getStartScrollTop({
            ...baseOptions,
            overlay: {
                absolute: true,
                offsetParentTop: 0,
                offsetTop: 0,
                height: 42,
            },
        }), 824);
    });
});
