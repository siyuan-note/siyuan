import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    getCommonFormatPainterSnapshot,
    shouldKeepFormatPainterActive,
    shouldShowFormatPainterMessage,
} from "./formatPainterCore";

describe("getCommonFormatPainterSnapshot", () => {
    it("keeps only formats shared by every selected text segment", () => {
        assert.deepEqual(getCommonFormatPainterSnapshot([{
            types: ["strong", "em"],
            styles: {color: "red", fontFamily: "Arial", fontSize: "16px"},
        }, {
            types: ["strong", "u"],
            styles: {color: "blue", fontFamily: "Arial", fontSize: "16px"},
        }]), {
            types: ["strong"],
            styles: {fontFamily: "Arial", fontSize: "16px"},
        });
    });

    it("omits mixed or partially missing font families so painting can clear the target family", () => {
        assert.deepEqual(getCommonFormatPainterSnapshot([{
            types: [],
            styles: {fontFamily: "Arial"},
        }, {
            types: [],
            styles: {fontFamily: "Georgia"},
        }]), {
            types: [],
            styles: {},
        });
        assert.deepEqual(getCommonFormatPainterSnapshot([{
            types: [],
            styles: {fontFamily: "Arial"},
        }, {
            types: [],
            styles: {},
        }]), {
            types: [],
            styles: {},
        });
    });

    it("does not let protected inline segments clear a shared font family", () => {
        assert.deepEqual(getCommonFormatPainterSnapshot([{
            types: [],
            styles: {fontFamily: "Arial"},
        }, {
            fontFamilyExcluded: true,
            types: ["code"],
            styles: {},
        }]), {
            types: [],
            styles: {fontFamily: "Arial"},
        });
    });

    it("returns an empty format for unformatted text so it can clear the target", () => {
        assert.deepEqual(getCommonFormatPainterSnapshot([{
            types: [],
            styles: {},
        }]), {
            types: [],
            styles: {},
        });
    });

    it("ignores formats that are not supported by the painter", () => {
        assert.deepEqual(getCommonFormatPainterSnapshot([{
            types: ["a", "block-ref", "strong"],
            styles: {shadow: true},
        }]), {
            types: ["strong"],
            styles: {shadow: true},
        });
    });

    it("requires at least one selected text segment", () => {
        assert.equal(getCommonFormatPainterSnapshot([]), undefined);
    });
});

describe("shouldKeepFormatPainterActive", () => {
    it("keeps only continuous format painting active after applying a format", () => {
        assert.equal(shouldKeepFormatPainterActive("once"), false);
        assert.equal(shouldKeepFormatPainterActive("continuous"), true);
    });
});

describe("shouldShowFormatPainterMessage", () => {
    it("defaults to enabled and respects an explicit disabled setting", () => {
        assert.equal(shouldShowFormatPainterMessage(undefined), true);
        assert.equal(shouldShowFormatPainterMessage(true), true);
        assert.equal(shouldShowFormatPainterMessage(false), false);
    });
});
