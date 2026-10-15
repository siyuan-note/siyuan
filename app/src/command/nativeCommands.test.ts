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

it("database entry commands honor navigation boundaries and loading on every frontend", async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "window");
    const commands = ["previousDatabaseRow", "nextDatabaseRow"];
    Object.defineProperty(globalThis, "window", {configurable: true, value: {siyuan: {
        config: {keymap: {general: Object.fromEntries(commands.map(key => [key, {}])), editor: {general: {}}}},
    }}});
    try {
        const app = {};
        const executed: string[] = [];
        const previous = {disabled: true};
        const next = {disabled: false};
        const element = {
            isConnected: true,
            closest: (): null => null,
            querySelector: (selector: string) => selector.includes('"previous"') ? previous : next,
        } as unknown as HTMLElement;
        ensureNativeCommands(app, command => executed.push(command));
        const registry = getCommandRegistry(app);
        for (const environment of ["desktop", "desktop-window", "browser-desktop", "mobile", "browser-mobile"] as const) {
            const context: ICommandContextSnapshot = {
                app, source: "shortcut", environment, focus: "editor", selectedBlocks: [], activeTab: {element},
            };
            const previousID = getNativeCommandId(commands[0]);
            const nextID = getNativeCommandId(commands[1]);
            assert.equal((await registry.execute(previousID, context)).status, "disabled");
            assert.equal((await registry.execute(nextID, context)).status, "executed");
            next.disabled = true;
            assert.equal((await registry.execute(nextID, context)).status, "disabled");
            next.disabled = false;
            assert.equal((await registry.execute(nextID, {...context, focus: "fileTree"})).status, "disabled");
            assert.equal((await registry.execute(nextID, {...context, activeTab: undefined})).status, "disabled");
        }
        assert.deepEqual(executed, Array(5).fill("nextDatabaseRow"));
    } finally {
        if (original) {
            Object.defineProperty(globalThis, "window", original);
        } else {
            Reflect.deleteProperty(globalThis, "window");
        }
    }
});
