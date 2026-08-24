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
    type IMobileSidePanelPluginDock,
} from "./mobileSidePanelConfig";

const pluginDocks: IMobileSidePanelPluginDock[] = [
    {id: "pluginLeft", side: "left", index: 20},
    {id: "pluginRight", side: "right", index: 10},
];
const builtInDockIds = new Set<string>(MOBILE_SIDE_PANEL_DOCK_IDS);

const assertCompleteConfig = (config: ReturnType<typeof normalizeMobileSidePanelConfig>) => {
    const dockIds = [...config.left, ...config.right];
    assert.equal(config.version, MOBILE_SIDE_PANEL_CONFIG_VERSION);
    assert.equal(config.left.length > 0, true);
    assert.equal(config.right.length > 0, true);
    assert.equal(new Set(dockIds).size, dockIds.length);
    MOBILE_SIDE_PANEL_DOCK_IDS.forEach(id => assert.equal(dockIds.includes(id), true));
    assert.equal(dockIds.length, MOBILE_SIDE_PANEL_DOCK_IDS.length + config.pluginDockIds.length);
    assert.deepEqual(new Set(config.pluginDockIds),
        new Set(dockIds.filter(id => !builtInDockIds.has(id))));
};

describe("mobile side panel config", () => {
    it("falls back to a fresh default for malformed storage values", () => {
        [
            null,
            false,
            "not json",
            [],
            {version: 4, left: ["file"], right: ["outline"], pluginDockIds: []},
            {version: MOBILE_SIDE_PANEL_CONFIG_VERSION, left: "file", right: ["outline"], pluginDockIds: []},
            {version: MOBILE_SIDE_PANEL_CONFIG_VERSION, left: ["file"], right: null, pluginDockIds: []},
            {version: MOBILE_SIDE_PANEL_CONFIG_VERSION, left: ["file"], right: ["outline"]},
        ].forEach((storedValue) => {
            const config = normalizeMobileSidePanelConfig(storedValue, pluginDocks);
            assert.deepEqual(config, createDefaultMobileSidePanelConfig(pluginDocks));
            assert.notEqual(config.left, DEFAULT_MOBILE_SIDE_PANEL_LEFT);
            assert.notEqual(config.right, DEFAULT_MOBILE_SIDE_PANEL_RIGHT);
        });
    });

    it("accepts a serialized config and preserves the configured order", () => {
        const config = normalizeMobileSidePanelConfig(JSON.stringify({
            version: MOBILE_SIDE_PANEL_CONFIG_VERSION,
            left: ["file", "pluginRight", "tag"],
            right: ["backlink", "outline", "bookmark", "inbox", "pluginLeft"],
            pluginDockIds: ["pluginLeft", "pluginRight"],
        }), pluginDocks);

        assert.deepEqual(config.left, ["file", "pluginRight", "tag"]);
        assert.deepEqual(config.right, ["backlink", "outline", "bookmark", "inbox", "pluginLeft", "agent"]);
        assert.deepEqual(config.pluginDockIds, ["pluginRight", "pluginLeft"]);
        assertCompleteConfig(config);
    });

    it("migrates version 1 and 2 layouts and adds active plugins at their registered side", () => {
        [1, 2].forEach((version) => {
            const config = normalizeMobileSidePanelConfig({
                version,
                left: ["file", "bookmark", "tag", "inbox", "plugin"],
                right: ["backlink", "outline"],
            }, pluginDocks);

            assert.deepEqual(config.left, ["file", "bookmark", "tag", "inbox", "pluginLeft"]);
            assert.deepEqual(config.right, ["backlink", "outline", "agent", "pluginRight"]);
            assert.deepEqual(config.pluginDockIds, ["pluginLeft", "pluginRight"]);
            assertCompleteConfig(config);
        });
    });

    it("orders new plugins by their registered index after built-in docks", () => {
        const config = createDefaultMobileSidePanelConfig([
            {id: "leftLast", side: "left", index: 30},
            {id: "leftFirst", side: "left", index: 10},
            {id: "right", side: "right", index: 20},
        ]);

        assert.deepEqual(config.left, [...DEFAULT_MOBILE_SIDE_PANEL_LEFT, "leftFirst", "leftLast"]);
        assert.deepEqual(config.right, [...DEFAULT_MOBILE_SIDE_PANEL_RIGHT, "right"]);
        assert.deepEqual(config.pluginDockIds, ["leftFirst", "leftLast", "right"]);
        assertCompleteConfig(config);
    });

    it("inserts a newly registered plugin relative to existing plugin positions", () => {
        const config = normalizeMobileSidePanelConfig({
            version: MOBILE_SIDE_PANEL_CONFIG_VERSION,
            left: ["file", "pluginLater", "bookmark", "tag", "inbox"],
            right: ["outline", "backlink", "agent"],
            pluginDockIds: ["pluginLater"],
        }, [
            {id: "pluginEarlier", side: "left", index: 10},
            {id: "pluginLater", side: "left", index: 20},
        ]);

        assert.deepEqual(config.left, ["file", "pluginEarlier", "pluginLater", "bookmark", "tag", "inbox"]);
        assert.deepEqual(config.pluginDockIds, ["pluginEarlier", "pluginLater"]);
        assertCompleteConfig(config);
    });

    it("preserves missing plugin positions and restores them when the plugin returns", () => {
        const stored = {
            version: MOBILE_SIDE_PANEL_CONFIG_VERSION,
            left: ["file", "missingPlugin", "bookmark", "tag", "inbox"],
            right: ["outline", "backlink", "agent"],
            pluginDockIds: ["missingPlugin"],
        };
        const missing = normalizeMobileSidePanelConfig(stored);
        const restored = normalizeMobileSidePanelConfig(stored, [
            {id: "missingPlugin", side: "right"},
        ]);

        assert.deepEqual(missing.left, stored.left);
        assert.deepEqual(missing.pluginDockIds, ["missingPlugin"]);
        assert.deepEqual(restored.left, stored.left);
        assert.deepEqual(restored.pluginDockIds, ["missingPlugin"]);
        assertCompleteConfig(missing);
        assertCompleteConfig(restored);
    });

    it("drops unknown and duplicate IDs but retains registered plugin IDs", () => {
        const config = normalizeMobileSidePanelConfig({
            version: MOBILE_SIDE_PANEL_CONFIG_VERSION,
            left: ["tag", "unknown", "tag", "outline", "pluginLeft"],
            right: ["outline", "file", "unknown", "pluginLeft"],
            pluginDockIds: ["pluginLeft", "pluginLeft", ""],
        }, pluginDocks);

        assert.deepEqual(config.left, ["tag", "outline", "pluginLeft", "bookmark", "inbox"]);
        assert.deepEqual(config.right, ["file", "backlink", "agent", "pluginRight"]);
        assert.deepEqual(config.pluginDockIds, ["pluginLeft", "pluginRight"]);
        assertCompleteConfig(config);
    });

    it("repairs an empty side with its default anchor", () => {
        const emptyLeft = normalizeMobileSidePanelConfig({
            version: MOBILE_SIDE_PANEL_CONFIG_VERSION,
            left: [],
            right: [...MOBILE_SIDE_PANEL_DOCK_IDS],
            pluginDockIds: [],
        });
        const emptyRight = normalizeMobileSidePanelConfig({
            version: MOBILE_SIDE_PANEL_CONFIG_VERSION,
            left: [...MOBILE_SIDE_PANEL_DOCK_IDS],
            right: [],
            pluginDockIds: [],
        });

        assert.deepEqual(emptyLeft.left, ["file"]);
        assert.deepEqual(emptyRight.right, ["outline"]);
        assertCompleteConfig(emptyLeft);
        assertCompleteConfig(emptyRight);
    });

    it("moves a plugin between sides at a requested visible position", () => {
        const config = reduceMobileSidePanelConfig(createDefaultMobileSidePanelConfig(pluginDocks), {
            type: "move",
            id: "pluginLeft",
            side: "right",
            index: 1,
        }, pluginDocks);

        assert.deepEqual(config.left, DEFAULT_MOBILE_SIDE_PANEL_LEFT);
        assert.deepEqual(config.right, ["outline", "pluginLeft", "backlink", "agent", "pluginRight"]);
        assertCompleteConfig(config);
    });

    it("does not move the last visible dock away from a side", () => {
        const state = normalizeMobileSidePanelConfig({
            version: MOBILE_SIDE_PANEL_CONFIG_VERSION,
            left: ["file", "missingPlugin"],
            right: ["outline", "bookmark", "tag", "backlink", "inbox", "agent"],
            pluginDockIds: ["missingPlugin"],
        });
        const config = reduceMobileSidePanelConfig(state, {
            type: "move",
            id: "file",
            side: "right",
        });

        assert.deepEqual(config, state);
        assertCompleteConfig(config);
    });

    it("reorders visible docks across a missing plugin slot", () => {
        const state = normalizeMobileSidePanelConfig({
            version: MOBILE_SIDE_PANEL_CONFIG_VERSION,
            left: ["file", "missingPlugin", "bookmark", "tag", "inbox"],
            right: ["outline", "backlink", "agent"],
            pluginDockIds: ["missingPlugin"],
        });
        const config = reduceMobileSidePanelConfig(state, {
            type: "reorder",
            side: "left",
            fromIndex: 1,
            toIndex: 0,
        });

        assert.deepEqual(config.left, ["bookmark", "missingPlugin", "file", "tag", "inbox"]);
        assertCompleteConfig(config);
    });

    it("ignores invalid reorder indices", () => {
        const state = createDefaultMobileSidePanelConfig(pluginDocks);
        const config = reduceMobileSidePanelConfig(state, {
            type: "reorder",
            side: "left",
            fromIndex: -1,
            toIndex: 2,
        }, pluginDocks);

        assert.deepEqual(config, state);
        assert.notEqual(config, state);
    });

    it("resets active plugins to registered positions and removes missing plugins", () => {
        const customized = normalizeMobileSidePanelConfig({
            version: MOBILE_SIDE_PANEL_CONFIG_VERSION,
            left: ["file", "outline", "missingPlugin", "pluginRight"],
            right: ["backlink", "bookmark", "tag", "inbox", "agent", "pluginLeft"],
            pluginDockIds: ["missingPlugin", "pluginLeft", "pluginRight"],
        }, pluginDocks);
        const config = reduceMobileSidePanelConfig(customized, {type: "reset"}, pluginDocks);

        assert.deepEqual(config, createDefaultMobileSidePanelConfig(pluginDocks));
        assert.equal(config.pluginDockIds.includes("missingPlugin"), false);
        assertCompleteConfig(config);
    });
});
