import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {DynamicLoadState} from "./dynamicLoadState";

describe("DynamicLoadState", () => {
    it("allows only one active request", () => {
        const state = new DynamicLoadState();
        const request = state.begin("root", "last", 2);

        assert.ok(request);
        assert.equal(state.begin("root", "last", 2), undefined);
        assert.equal(state.begin("root", "first", 1), undefined);
    });

    it("validates the current document and boundary", () => {
        const state = new DynamicLoadState();
        const request = state.begin("root", "last", 2);

        assert.ok(request);
        assert.equal(state.isCurrent(request, "root", "last"), true);
        assert.equal(state.isCurrent(request, "other-root", "last"), false);
        assert.equal(state.isCurrent(request, "root", "other-last"), false);
    });

    it("releases the state only for the active request", () => {
        const state = new DynamicLoadState();
        const first = state.begin("root", "last", 2);

        assert.ok(first);
        assert.equal(state.finish(first), true);
        const second = state.begin("root", "next", 2);
        assert.ok(second);
        assert.equal(state.finish(first), false);
        assert.equal(state.isCurrent(second, "root", "next"), true);
    });

    it("invalidates stale responses and allows retrying", () => {
        const state = new DynamicLoadState();
        const stale = state.begin("root", "last", 2);

        assert.ok(stale);
        assert.equal(state.invalidate(), stale);
        const retry = state.begin("root", "last", 2);
        assert.ok(retry);
        assert.equal(state.isCurrent(stale, "root", "last"), false);
        assert.equal(state.isCurrent(retry, "root", "last"), true);
    });
});
