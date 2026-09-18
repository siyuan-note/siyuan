import {it} from "node:test";
import * as assert from "node:assert/strict";
import {ensureNativeCommands, getNativeCommandId} from "./nativeCommands";
import {getCommandRegistry} from "./service";
import type {ICommandContextSnapshot} from "./types";

it("hides publish write commands and rejects their shortcut execution", async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "window");
    const blocked = ["addToDatabase", "closeUnmodified", "editReadonly", "switchReadonly", "replace",
        "move", "newFile", "dailyNote", "syncNow", "dataHistory"];
    const siyuan = {
        isPublish: true,
        config: {keymap: {
            general: Object.fromEntries([...blocked, "search"].map(key => [key, {}])),
            editor: {general: {switchReadonly: {}}},
        }},
    };
    Object.defineProperty(globalThis, "window", {configurable: true, value: {siyuan}});
    try {
        const app = {};
        const executed: string[] = [];
        ensureNativeCommands(app, command => executed.push(command));
        const registry = getCommandRegistry(app);
        for (const environment of ["browser-desktop", "browser-mobile"] as const) {
            const context: ICommandContextSnapshot = {
                app, source: "commandPanel", environment, focus: "fileTree", selectedBlocks: [],
            };
            const visible = registry.list(context).map(command => command.id);
            for (const command of blocked) {
                const id = getNativeCommandId(command);
                assert.ok(!visible.includes(id), command);
                assert.equal((await registry.execute(id, {...context, source: "shortcut"})).status, "unavailable");
            }
            assert.ok(visible.includes(getNativeCommandId("search")));
            assert.equal((await registry.execute(getNativeCommandId("search"), context)).status, "executed");
        }
        assert.deepEqual(executed, ["search", "search"]);
        siyuan.isPublish = false;
        const context: ICommandContextSnapshot = {
            app, source: "commandPanel", environment: "browser-desktop", focus: "global", selectedBlocks: [],
        };
        assert.ok(registry.list(context).some(command => command.id === getNativeCommandId("replace")));
        assert.equal((await registry.execute(getNativeCommandId("replace"), context)).status, "executed");
    } finally {
        if (original) {
            Object.defineProperty(globalThis, "window", original);
        } else {
            Reflect.deleteProperty(globalThis, "window");
        }
    }
});
