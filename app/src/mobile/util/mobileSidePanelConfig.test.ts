import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    createDefaultMobileSidePanelConfig,
    DEFAULT_MOBILE_SIDE_PANEL_LEFT,
    DEFAULT_MOBILE_SIDE_PANEL_RIGHT,
    MOBILE_SIDE_PANEL_CONFIG_VERSION,
    MOBILE_SIDE_PANEL_DOCK_IDS,
    normalizeMobileSidePanelConfig,
    reduceMobileSidePanelConfig,
} from "./mobileSidePanelConfig";

const assertCompleteConfig = (config: ReturnType<typeof normalizeMobileSidePanelConfig>) => {
    const dockIds = [...config.left, ...config.right];
    assert.equal(config.version, MOBILE_SIDE_PANEL_CONFIG_VERSION);
    assert.equal(config.left.length > 0, true);
    assert.equal(config.right.length > 0, true);
    assert.equal(dockIds.length, MOBILE_SIDE_PANEL_DOCK_IDS.length);
    assert.equal(new Set(dockIds).size, MOBILE_SIDE_PANEL_DOCK_IDS.length);
    assert.deepEqual(new Set(dockIds), new Set(MOBILE_SIDE_PANEL_DOCK_IDS));
};

describe("mobile side panel config", () => {
    it("falls back to a fresh default for malformed storage values", () => {
        [
            null,
            false,
            "not json",
            [],
            {version: 2, left: ["file"], right: ["outline"]},
            {version: MOBILE_SIDE_PANEL_CONFIG_VERSION, left: "file", right: ["outline"]},
            {version: MOBILE_SIDE_PANEL_CONFIG_VERSION, left: ["file"], right: null},
        ].forEach((storedValue) => {
            const config = normalizeMobileSidePanelConfig(storedValue);
            assert.deepEqual(config, createDefaultMobileSidePanelConfig());
            assert.notEqual(config.left, DEFAULT_MOBILE_SIDE_PANEL_LEFT);
            assert.notEqual(config.right, DEFAULT_MOBILE_SIDE_PANEL_RIGHT);
        });
    });

    it("accepts a serialized config and preserves the configured order", () => {
        const config = normalizeMobileSidePanelConfig(JSON.stringify({
            version: MOBILE_SIDE_PANEL_CONFIG_VERSION,
            left: ["plugin", "file", "tag"],
            right: ["backlink", "outline", "bookmark", "inbox"],
        }));

        assert.deepEqual(config.left, ["plugin", "file", "tag"]);
        assert.deepEqual(config.right, ["backlink", "outline", "bookmark", "inbox"]);
        assertCompleteConfig(config);
    });

    it("drops unknown and duplicate IDs and fills missing IDs on their default side", () => {
        const config = normalizeMobileSidePanelConfig({
            version: MOBILE_SIDE_PANEL_CONFIG_VERSION,
            left: ["tag", "unknown", "tag", "outline"],
            right: ["outline", "file", "unknown"],
        });

        assert.deepEqual(config.left, ["tag", "outline", "bookmark", "inbox", "plugin"]);
        assert.deepEqual(config.right, ["file", "backlink"]);
        assertCompleteConfig(config);
    });

    it("repairs an empty left side with its default anchor", () => {
        const config = normalizeMobileSidePanelConfig({
            version: MOBILE_SIDE_PANEL_CONFIG_VERSION,
            left: [],
            right: [...MOBILE_SIDE_PANEL_DOCK_IDS],
        });

        assert.deepEqual(config.left, ["file"]);
        assert.deepEqual(config.right, ["outline", "bookmark", "tag", "backlink", "inbox", "plugin"]);
        assertCompleteConfig(config);
    });

    it("repairs an empty right side with its default anchor", () => {
        const config = normalizeMobileSidePanelConfig({
            version: MOBILE_SIDE_PANEL_CONFIG_VERSION,
            left: [...MOBILE_SIDE_PANEL_DOCK_IDS],
            right: [],
        });

        assert.deepEqual(config.left, ["file", "bookmark", "tag", "backlink", "inbox", "plugin"]);
        assert.deepEqual(config.right, ["outline"]);
        assertCompleteConfig(config);
    });

    it("moves a dock between sides at a requested position", () => {
        const config = reduceMobileSidePanelConfig(createDefaultMobileSidePanelConfig(), {
            type: "move",
            id: "bookmark",
            side: "right",
            index: 1,
        });

        assert.deepEqual(config.left, ["file", "tag", "inbox", "plugin"]);
        assert.deepEqual(config.right, ["outline", "bookmark", "backlink"]);
        assertCompleteConfig(config);
    });

    it("does not move the last dock away from a side", () => {
        const state = normalizeMobileSidePanelConfig({
            version: MOBILE_SIDE_PANEL_CONFIG_VERSION,
            left: ["file"],
            right: ["outline", "bookmark", "tag", "backlink", "inbox", "plugin"],
        });
        const config = reduceMobileSidePanelConfig(state, {
            type: "move",
            id: "file",
            side: "right",
        });

        assert.deepEqual(config, state);
        assertCompleteConfig(config);
    });

    it("reorders docks within a side", () => {
        const config = reduceMobileSidePanelConfig(createDefaultMobileSidePanelConfig(), {
            type: "reorder",
            side: "left",
            fromIndex: 4,
            toIndex: 1,
        });

        assert.deepEqual(config.left, ["file", "plugin", "bookmark", "tag", "inbox"]);
        assert.deepEqual(config.right, DEFAULT_MOBILE_SIDE_PANEL_RIGHT);
        assertCompleteConfig(config);
    });

    it("ignores invalid reorder indices", () => {
        const state = createDefaultMobileSidePanelConfig();
        const config = reduceMobileSidePanelConfig(state, {
            type: "reorder",
            side: "left",
            fromIndex: -1,
            toIndex: 2,
        });

        assert.deepEqual(config, state);
        assert.notEqual(config, state);
    });

    it("resets customized panels to a fresh default config", () => {
        const customized = normalizeMobileSidePanelConfig({
            version: MOBILE_SIDE_PANEL_CONFIG_VERSION,
            left: ["plugin", "file", "outline"],
            right: ["backlink", "bookmark", "tag", "inbox"],
        });
        const config = reduceMobileSidePanelConfig(customized, {type: "reset"});

        assert.deepEqual(config.left, DEFAULT_MOBILE_SIDE_PANEL_LEFT);
        assert.deepEqual(config.right, DEFAULT_MOBILE_SIDE_PANEL_RIGHT);
        assert.notEqual(config.left, DEFAULT_MOBILE_SIDE_PANEL_LEFT);
        assert.notEqual(config.right, DEFAULT_MOBILE_SIDE_PANEL_RIGHT);
    });
});
