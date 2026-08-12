import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    type IPluginDockPlacementState,
    updatePluginDockPlacements,
    updatePluginDockShowStates,
} from "./pluginDockState";

const dock = (show: boolean) => ({
    config: {show} as IPluginDockTab,
});

describe("updatePluginDockShowStates", () => {
    it("closes the plugin replaced by an internal dock", () => {
        const plugins = [{
            name: "plugin-a",
            docks: {dockA: dock(true)},
        }];
        const storage = {
            "plugin-a": {dockA: {show: true} as IPluginDockTab},
        };

        assert.equal(updatePluginDockShowStates([{type: "dockA", show: false}], plugins, storage), true);
        assert.equal(storage["plugin-a"].dockA.show, false);
    });

    it("updates both plugins from one partition snapshot", () => {
        const plugins = [{
            name: "plugin-a",
            docks: {dockA: dock(true)},
        }, {
            name: "plugin-b",
            docks: {dockB: dock(false)},
        }];
        const storage = {
            "plugin-a": {dockA: {show: true} as IPluginDockTab},
            "plugin-b": {dockB: {show: false} as IPluginDockTab},
        };
        const states = [
            {type: "dockA", show: false},
            {type: "dockB", show: true},
        ];

        assert.equal(updatePluginDockShowStates(states, plugins, storage), true);
        assert.equal(storage["plugin-a"].dockA.show, false);
        assert.equal(storage["plugin-b"].dockB.show, true);
        assert.equal(updatePluginDockShowStates(states, plugins, storage), false);
    });

    it("does not change plugins outside the partition snapshot", () => {
        const plugins = [{
            name: "plugin-a",
            docks: {dockA: dock(true)},
        }, {
            name: "plugin-b",
            docks: {dockB: dock(true)},
        }];
        const storage = {
            "plugin-a": {dockA: {show: true} as IPluginDockTab},
            "plugin-b": {dockB: {show: true} as IPluginDockTab},
        };

        assert.equal(updatePluginDockShowStates([{type: "dockA", show: false}], plugins, storage), true);
        assert.equal(storage["plugin-a"].dockA.show, false);
        assert.equal(storage["plugin-b"].dockB.show, true);
    });

    it("initializes missing plugin storage", () => {
        const config = {show: false} as IPluginDockTab;
        const plugins = [{
            name: "plugin-a",
            docks: {dockA: {config}},
        }];
        const storage: Record<string, Record<string, IPluginDockTab>> = {};

        assert.equal(updatePluginDockShowStates([{type: "dockA", show: true}], plugins, storage), true);
        assert.equal(storage["plugin-a"].dockA, config);
        assert.equal(storage["plugin-a"].dockA.show, true);
    });
});

describe("updatePluginDockPlacements", () => {
    it("updates a plugin shifted by an internal dock", () => {
        const plugins = [{
            name: "plugin-a",
            docks: {dockA: dock(false)},
        }];
        const storage = {
            "plugin-a": {
                dockA: {
                    position: "LeftTop",
                    index: 1,
                    size: {height: 240, width: 232},
                } as IPluginDockTab,
            },
        };
        const states: IPluginDockPlacementState[] = [{
            type: "file",
            position: "LeftTop",
            index: 1,
        }, {
            type: "dockA",
            position: "LeftTop",
            index: 0,
        }];

        assert.equal(updatePluginDockPlacements(states, plugins, storage), true);
        assert.equal(storage["plugin-a"].dockA.index, 0);
        assert.equal(updatePluginDockPlacements(states, plugins, storage), false);
    });

    it("updates every plugin in the affected dock snapshots", () => {
        const plugins = [{
            name: "plugin-a",
            docks: {dockA: dock(false)},
        }, {
            name: "plugin-b",
            docks: {dockB: dock(false)},
        }];
        const storage = {
            "plugin-a": {
                dockA: {
                    position: "LeftTop",
                    index: 0,
                    size: {height: 240, width: 232},
                } as IPluginDockTab,
            },
            "plugin-b": {
                dockB: {
                    position: "RightTop",
                    index: 2,
                    size: {height: 320, width: 300},
                } as IPluginDockTab,
            },
        };
        const states: IPluginDockPlacementState[] = [{
            type: "dockA",
            position: "LeftBottom",
            index: 1,
        }, {
            type: "dockB",
            position: "BottomRight",
            index: 0,
            size: {width: null},
        }];

        assert.equal(updatePluginDockPlacements(states, plugins, storage), true);
        assert.equal(storage["plugin-a"].dockA.position, "LeftBottom");
        assert.equal(storage["plugin-a"].dockA.index, 1);
        assert.equal(storage["plugin-b"].dockB.position, "BottomRight");
        assert.equal(storage["plugin-b"].dockB.index, 0);
        assert.equal(storage["plugin-b"].dockB.size.width, null);
        assert.equal(storage["plugin-b"].dockB.size.height, 320);
    });

    it("initializes missing plugin storage", () => {
        const config = {
            position: "RightBottom",
            index: 3,
            size: {height: 240, width: 232},
        } as IPluginDockTab;
        const plugins = [{
            name: "plugin-a",
            docks: {dockA: {config}},
        }];
        const storage: Record<string, Record<string, IPluginDockTab>> = {};

        assert.equal(updatePluginDockPlacements([{
            type: "dockA",
            position: "LeftTop",
            index: 0,
        }], plugins, storage), true);
        assert.equal(storage["plugin-a"].dockA, config);
        assert.equal(config.position, "LeftTop");
        assert.equal(config.index, 0);
    });
});
