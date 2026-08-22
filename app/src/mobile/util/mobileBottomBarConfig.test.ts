import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    createDefaultMobileBottomBarConfig,
    DEFAULT_MOBILE_BOTTOM_BAR_ACTIONS,
    MOBILE_BOTTOM_BAR_ACTIONS,
    MOBILE_BOTTOM_BAR_CONFIG_VERSION,
    normalizeMobileBottomBarConfig,
    reduceMobileBottomBarConfig,
    resolveMobileBottomBarAvailability,
} from "./mobileBottomBarConfig";

describe("mobile bottom bar config", () => {
    it("falls back to the default for malformed storage values", () => {
        [
            null,
            false,
            "not json",
            [],
            {version: 2, actions: ["recent", "outline", "bookmark", "tag"]},
            {version: MOBILE_BOTTOM_BAR_CONFIG_VERSION, actions: "documents"},
        ].forEach((storedValue) => {
            assert.deepEqual(normalizeMobileBottomBarConfig(storedValue), createDefaultMobileBottomBarConfig());
        });
    });

    it("accepts serialized config and fills invalid or duplicate slots in order", () => {
        const config = normalizeMobileBottomBarConfig(JSON.stringify({
            version: MOBILE_BOTTOM_BAR_CONFIG_VERSION,
            actions: ["recent", "recent", "unknown", "tag"],
        }));

        assert.deepEqual(config.actions, ["recent", "documents", "search", "tag"]);
        assert.equal(config.actions.length, 4);
        assert.equal(new Set(config.actions).size, 4);
        assert.equal(config.actions.every((action) => MOBILE_BOTTOM_BAR_ACTIONS.includes(action)), true);
    });

    it("swaps slots when selecting an action already in the bottom bar", () => {
        const config = reduceMobileBottomBarConfig(createDefaultMobileBottomBarConfig(), {
            type: "select-action",
            slot: 0,
            action: "tabs",
        });

        assert.deepEqual(config.actions, ["tabs", "search", "newDoc", "documents"]);
    });

    it("supports inbox, backlinks, the agent, and spaced repetition as configurable actions", () => {
        const config = normalizeMobileBottomBarConfig({
            version: MOBILE_BOTTOM_BAR_CONFIG_VERSION,
            actions: ["inbox", "backlink", "agent", "spacedRepetition"],
        });

        assert.deepEqual(config.actions, ["inbox", "backlink", "agent", "spacedRepetition"]);
    });

    it("replaces a slot when selecting an unused action", () => {
        const config = reduceMobileBottomBarConfig(createDefaultMobileBottomBarConfig(), {
            type: "select-action",
            slot: 1,
            action: "outline",
        });

        assert.deepEqual(config.actions, ["documents", "outline", "newDoc", "tabs"]);
    });

    it("resets customized actions to a fresh default config", () => {
        const customized = normalizeMobileBottomBarConfig({
            version: MOBILE_BOTTOM_BAR_CONFIG_VERSION,
            actions: ["recent", "outline", "bookmark", "command"],
        });
        const config = reduceMobileBottomBarConfig(customized, {type: "reset"});

        assert.equal(config.version, 1);
        assert.deepEqual(config.actions, DEFAULT_MOBILE_BOTTOM_BAR_ACTIONS);
        assert.notEqual(config.actions, DEFAULT_MOBILE_BOTTOM_BAR_ACTIONS);
    });

    it("replaces actions that are unavailable in the current mode", () => {
        const config = resolveMobileBottomBarAvailability(createDefaultMobileBottomBarConfig(), ["newDoc"]);

        assert.deepEqual(config.actions, ["documents", "search", "recent", "tabs"]);
        assert.equal(config.actions.includes("newDoc"), false);
    });

    it("replaces the agent when AI is unavailable", () => {
        const config = resolveMobileBottomBarAvailability({
            version: MOBILE_BOTTOM_BAR_CONFIG_VERSION,
            actions: ["documents", "agent", "newDoc", "tabs"],
        }, ["agent"]);

        assert.deepEqual(config.actions, ["documents", "search", "newDoc", "tabs"]);
    });

    it("replaces spaced repetition in read-only mode", () => {
        const config = resolveMobileBottomBarAvailability({
            version: MOBILE_BOTTOM_BAR_CONFIG_VERSION,
            actions: ["documents", "spacedRepetition", "search", "tabs"],
        }, ["spacedRepetition"]);

        assert.deepEqual(config.actions, ["documents", "newDoc", "search", "tabs"]);
    });
});
