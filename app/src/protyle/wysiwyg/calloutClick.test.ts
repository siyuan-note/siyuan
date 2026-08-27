import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {isDirectCalloutStructureClick} from "./calloutClick";

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
