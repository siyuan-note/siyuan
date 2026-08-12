import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getCommonFormatPainterSnapshot, shouldKeepFormatPainterActive} from "./formatPainterCore";

describe("getCommonFormatPainterSnapshot", () => {
    it("keeps only formats shared by every selected text segment", () => {
        assert.deepEqual(getCommonFormatPainterSnapshot([{
            types: ["strong", "em"],
            styles: {color: "red", fontSize: "16px"},
        }, {
            types: ["strong", "u"],
            styles: {color: "blue", fontSize: "16px"},
        }]), {
            types: ["strong"],
            styles: {fontSize: "16px"},
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
