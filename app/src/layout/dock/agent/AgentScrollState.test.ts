import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {resolveAgentScrollState} from "./AgentScrollState";

describe("AgentScrollState", () => {
    it("clears stale state when the content cannot scroll", () => {
        assert.deepEqual(resolveAgentScrollState({
            scrollTop: 0,
            scrollHeight: 600,
            clientHeight: 600,
        }, true, "reconcile"), {
            userScrolledUp: false,
            buttonVisible: false,
        });
    });

    it("enters and leaves the user-scrolled state with hysteresis", () => {
        const scrolledUp = resolveAgentScrollState({
            scrollTop: 340,
            scrollHeight: 1000,
            clientHeight: 600,
        }, false, "user");
        assert.deepEqual(scrolledUp, {
            userScrolledUp: true,
            buttonVisible: true,
        });

        const withinHysteresis = resolveAgentScrollState({
            scrollTop: 370,
            scrollHeight: 1000,
            clientHeight: 600,
        }, true, "user");
        assert.deepEqual(withinHysteresis, {
            userScrolledUp: true,
            buttonVisible: true,
        });

        const returnedToBottom = resolveAgentScrollState({
            scrollTop: 390,
            scrollHeight: 1000,
            clientHeight: 600,
        }, true, "user");
        assert.deepEqual(returnedToBottom, {
            userScrolledUp: false,
            buttonVisible: false,
        });
    });

    it("does not interpret content growth as a user scroll", () => {
        assert.deepEqual(resolveAgentScrollState({
            scrollTop: 400,
            scrollHeight: 1200,
            clientHeight: 600,
        }, false, "reconcile"), {
            userScrolledUp: false,
            buttonVisible: false,
        });
    });

    it("derives the state from a restored session position", () => {
        assert.deepEqual(resolveAgentScrollState({
            scrollTop: 200,
            scrollHeight: 1000,
            clientHeight: 600,
        }, false, "restore"), {
            userScrolledUp: true,
            buttonVisible: true,
        });
        assert.deepEqual(resolveAgentScrollState({
            scrollTop: 350,
            scrollHeight: 1000,
            clientHeight: 600,
        }, true, "restore"), {
            userScrolledUp: false,
            buttonVisible: false,
        });
    });
});
