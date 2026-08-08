import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {stripSearchMark} from "./escape";

describe("strip search mark", () => {
    it("removes search highlights without decoding escaped block names", () => {
        assert.equal(stripSearchMark("<mark>xw</mark>"), "xw");
        assert.equal(stripSearchMark("&lt;mark&gt;<mark>xw</mark>&lt;/mark&gt;"), "&lt;mark&gt;xw&lt;/mark&gt;");
    });
});
