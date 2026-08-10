import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {updatePluginDockShowStates} from "./pluginDockState";

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
