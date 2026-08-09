import * as assert from "node:assert/strict";
import {describe, it} from "node:test";
import {getSearchAVFocus} from "./searchAVFocus";

describe("database search focus", () => {
    it("prefers an earlier matching database over a later matching view", () => {
        assert.deepEqual(getSearchAVFocus([{
            matched: true,
            children: [{matched: false}],
        }, {
            matched: false,
            children: [{matched: false}, {matched: true}],
        }], "天空"), {resultIndex: 0});
    });

    it("focuses a matching view when its database name does not match", () => {
        assert.deepEqual(getSearchAVFocus([{
            matched: false,
            children: [{matched: false}, {matched: true}],
        }], "天空"), {resultIndex: 0, viewIndex: 1});
    });

    it("uses the first database for an empty search", () => {
        assert.deepEqual(getSearchAVFocus([{
            children: [{matched: true}],
        }], ""), {resultIndex: 0});
    });
});
