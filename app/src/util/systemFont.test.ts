import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getUniqueFontFamilies} from "./systemFontCore";

describe("getUniqueFontFamilies", () => {
    it("keeps one regular entry per family and merges searchable aliases", () => {
        assert.deepEqual(getUniqueFontFamilies([{
            family: "Example Sans",
            weight: 700,
            displayName: "Example Sans Bold",
            aliases: ["示例粗体"],
        }, {
            family: "Example Sans",
            weight: 400,
            displayName: "Example Sans",
            aliases: ["示例"],
        }, {
            family: "Another Font",
            weight: 400,
            displayName: "Another Font",
        }]), [{
            family: "Another Font",
            weight: 400,
            displayName: "Another Font",
        }, {
            family: "Example Sans",
            weight: 400,
            displayName: "Example Sans",
            aliases: ["示例粗体", "示例"],
        }]);
    });
});
