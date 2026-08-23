import * as assert from "node:assert/strict";
import test from "node:test";
import {openMobilePluginDock, removeMobilePluginDock} from "./pluginDockState";

test("mobile plugin docks replace and remove the active model", () => {
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
        assert.equal(firstDestroyed, 1);
        assert.equal(docks.first, undefined);
        assert.equal(docks.second, second);

        removeMobilePluginDock("second");
        assert.equal(secondDestroyed, 1);
        assert.equal(second.element.innerHTML, "");
        assert.equal(docks.second, undefined);
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
