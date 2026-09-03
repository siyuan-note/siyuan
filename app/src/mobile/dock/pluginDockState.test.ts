import * as assert from "node:assert/strict";
import {describe, it} from "node:test";
import {
    getMobilePluginDock,
    getMobilePluginDockEntries,
    getMobilePluginDockLayouts,
    getMobilePluginDockSide,
    openMobilePluginDock,
    removeMobilePluginDock,
} from "./pluginDockState";

describe("mobile plugin dock state", () => {
    it("maps desktop dock positions to the corresponding mobile side", () => {
        assert.equal(getMobilePluginDockSide("LeftTop"), "left");
        assert.equal(getMobilePluginDockSide("LeftBottom"), "left");
        assert.equal(getMobilePluginDockSide("BottomLeft"), "left");
        assert.equal(getMobilePluginDockSide("RightTop"), "right");
        assert.equal(getMobilePluginDockSide("RightBottom"), "right");
        assert.equal(getMobilePluginDockSide("BottomRight"), "right");
    });

    it("builds a stable plugin dock catalog in registered index order", () => {
        const mobileModel = () => ({}) as never;
        const app = {
            plugins: [{
                name: "sample-plugin",
                displayName: "Sample plugin",
                docks: {
                    pluginSecond: {
                        id: "second",
                        config: {position: "BottomRight", index: 20, title: "Second", icon: "iconSecond"},
                        mobileModel,
                    },
                    pluginFirst: {
                        id: "first",
                        config: {position: "LeftBottom", index: 10, title: "First", icon: "iconFirst"},
                        mobileModel,
                    },
                },
            }],
        };
        const entries = getMobilePluginDockEntries(app as never);

        assert.deepEqual(entries.map(entry => entry.type), ["pluginFirst", "pluginSecond"]);
        assert.deepEqual(entries.map(entry => ({
            key: entry.key,
            dockID: entry.dockID,
            pluginName: entry.pluginName,
            pluginDisplayName: entry.pluginDisplayName,
        })), [{
            key: "plugin:sample-plugin:first",
            dockID: "first",
            pluginName: "sample-plugin",
            pluginDisplayName: "Sample plugin",
        }, {
            key: "plugin:sample-plugin:second",
            dockID: "second",
            pluginName: "sample-plugin",
            pluginDisplayName: "Sample plugin",
        }]);
        assert.deepEqual(getMobilePluginDockLayouts(entries), [
            {id: "pluginFirst", side: "left", index: 10},
            {id: "pluginSecond", side: "right", index: 20},
        ]);
    });

    it("keeps plugin docks independent and removes only the requested model", () => {
        const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
        const docks: Record<string, unknown> = {};
        Object.defineProperty(globalThis, "window", {
            configurable: true,
            value: {siyuan: {mobile: {docks}}},
        });
        let firstDestroyed = 0;
        let secondDestroyed = 0;
        let duplicateCreated = false;
        const first = {
            type: "first",
            element: {innerHTML: "first"},
            destroy: () => firstDestroyed++,
        };
        const second = {
            type: "second",
            element: {innerHTML: "second"},
            destroy: () => secondDestroyed++,
        };
        try {
            openMobilePluginDock("first", () => first as never);
            openMobilePluginDock("first", () => {
                duplicateCreated = true;
                return first as never;
            });
            openMobilePluginDock("second", () => second as never);

            assert.equal(duplicateCreated, false);
            assert.equal(firstDestroyed, 0);
            assert.equal(getMobilePluginDock("first"), first);
            assert.equal(getMobilePluginDock("second"), second);
            assert.equal(docks.first, first);
            assert.equal(docks.second, second);

            removeMobilePluginDock("first");
            assert.equal(firstDestroyed, 1);
            assert.equal(first.element.innerHTML, "");
            assert.equal(secondDestroyed, 0);
            assert.equal(getMobilePluginDock("first"), undefined);
            assert.equal(getMobilePluginDock("second"), second);
            assert.equal(docks.first, undefined);
            assert.equal(docks.second, second);
        } finally {
            removeMobilePluginDock("first");
            removeMobilePluginDock("second");
            if (windowDescriptor) {
                Object.defineProperty(globalThis, "window", windowDescriptor);
            } else {
                Reflect.deleteProperty(globalThis, "window");
            }
        }
    });
});
