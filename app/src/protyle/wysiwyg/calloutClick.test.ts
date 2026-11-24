import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {isBelowCalloutContent, isDirectCalloutStructureClick} from "./calloutClick";

describe("isDirectCalloutStructureClick", () => {
    it("accepts a direct click on the callout structure", () => {
        const structure = {} as Element;

        assert.equal(isDirectCalloutStructureClick(structure, structure, structure), true);
    });

    it("rejects a click synthesized after selecting across callout children", () => {
        const structure = {} as Element;
        const firstChild = {} as Element;
        const secondChild = {} as Element;

        assert.equal(isDirectCalloutStructureClick(firstChild, structure, secondChild), false);
    });

    it("rejects a drag that starts or ends outside the callout structure", () => {
        const structure = {} as Element;
        const child = {} as Element;

        assert.equal(isDirectCalloutStructureClick(structure, structure, child), false);
        assert.equal(isDirectCalloutStructureClick(child, structure, structure), false);
    });
});

describe("isBelowCalloutContent", () => {
    const callout = (rects: {bottom: number, height: number}[]) => ({
        querySelectorAll: (selector: string) => {
            assert.equal(selector, ":scope > .callout-content > [data-node-id]");
            return rects.map(rect => ({getBoundingClientRect: () => rect}));
        },
    }) as unknown as Element;

    it("detects the blank area below a short column ending in a nested list", () => {
        const element = callout([{bottom: 60, height: 20}, {bottom: 154, height: 84}]);
        assert.equal(isBelowCalloutContent(element, 153), false);
        assert.equal(isBelowCalloutContent(element, 190), true);
    });

    it("uses the last visible child and leaves clicks on empty callouts alone", () => {
        assert.equal(isBelowCalloutContent(callout([{bottom: 60, height: 20}, {bottom: 0, height: 0}]), 50), false);
        assert.equal(isBelowCalloutContent(callout([{bottom: 60, height: 20}, {bottom: 0, height: 0}]), 75), true);
        assert.equal(isBelowCalloutContent(callout([]), 75), false);
    });
});
