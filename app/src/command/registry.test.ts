import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {CommandRegistry} from "./registry";
import {getCommandRegistry} from "./service";
import type {ICommandContextSnapshot, ICommandDefinition} from "./types";

const createContext = (
    overrides: Partial<ICommandContextSnapshot> = {},
): ICommandContextSnapshot => ({
    app: {},
    source: "commandPanel",
    environment: "desktop",
    focus: "global",
    selectedBlocks: [],
    ...overrides,
});

const createCommand = (
    id: string,
    overrides: Partial<ICommandDefinition> = {},
): ICommandDefinition => ({
    id,
    category: "core",
    label: () => id,
    execute: () => undefined,
    ...overrides,
});

describe("command registry", () => {
    it("rejects duplicate IDs and unregisters commands by owner", () => {
        const registry = new CommandRegistry();
        const firstOwner = {};
        const secondOwner = {};
        registry.register(createCommand("core.first"), firstOwner);

        assert.throws(
            () => registry.register(createCommand("core.first"), secondOwner),
            /already registered/,
        );
        assert.equal(registry.unregisterOwner(firstOwner), 1);
        assert.equal(registry.get("core.first"), undefined);
        assert.equal(registry.unregisterOwner(firstOwner), 0);
    });

    it("keeps a newer generation when an old disposer runs", () => {
        const registry = new CommandRegistry();
        const oldOwner = {};
        const oldDispose = registry.register(createCommand("core.reload"), oldOwner);
        registry.unregisterOwner(oldOwner);
        const current = createCommand("core.reload", {label: () => "current"});
        registry.register(current, {});

        assert.equal(oldDispose(), false);
        assert.equal(registry.get("core.reload")?.label(), "current");
    });

    it("uses order and then registration sequence", () => {
        const registry = new CommandRegistry();
        registry.register(createCommand("plugin.first", {order: 10_000}), {});
        registry.register(createCommand("core.second", {order: 2}), {});
        registry.register(createCommand("core.first", {order: 1}), {});
        registry.register(createCommand("core.also-first", {order: 1}), {});

        assert.deepEqual(
            registry.list(createContext()).map(command => command.id),
            ["core.first", "core.also-first", "core.second", "plugin.first"],
        );
    });

    it("filters by source, platform, and context", () => {
        const registry = new CommandRegistry();
        registry.register(createCommand("core.editor", {
            surfaces: ["commandPanel"],
            platform: environment => environment === "desktop",
            when: context => context.focus === "editor",
        }), {});

        assert.deepEqual(registry.list(createContext()).map(command => command.id), []);
        assert.deepEqual(registry.list(createContext({focus: "editor"})).map(command => command.id), ["core.editor"]);
        assert.deepEqual(registry.list(createContext({focus: "editor", environment: "mobile"})), []);
        assert.deepEqual(registry.list(createContext({focus: "editor", source: "shortcut"})), []);
    });

    it("reports execution status and awaits asynchronous handlers", async () => {
        const registry = new CommandRegistry();
        registry.register(createCommand("core.disabled", {enabled: () => false}), {});
        registry.register(createCommand("core.hidden", {when: () => false}), {});
        registry.register(createCommand("core.async", {execute: async () => "done"}), {});

        assert.deepEqual(registry.list(createContext()).map(command => command.id), ["core.disabled", "core.async"]);
        assert.equal((await registry.execute("missing", createContext())).status, "notFound");
        assert.equal((await registry.execute("core.hidden", createContext())).status, "unavailable");
        assert.equal((await registry.execute("core.disabled", createContext())).status, "disabled");
        assert.deepEqual(await registry.execute("core.async", createContext()), {
            status: "executed",
            command: registry.get("core.async"),
            value: "done",
        });
    });

    it("keeps dynamic command metadata live", () => {
        const registry = new CommandRegistry();
        let hotkey = "Ctrl+A";
        const definition = createCommand("core.dynamic", {hotkey: () => hotkey});
        registry.register(definition, {});

        assert.equal(registry.get("core.dynamic")?.hotkey?.(), "Ctrl+A");
        hotkey = "Ctrl+B";
        definition.id = "core.changed";
        assert.equal(registry.get("core.dynamic")?.hotkey?.(), "Ctrl+B");
        assert.equal(registry.get("core.dynamic")?.id, "core.dynamic");
        assert.equal(registry.get("core.changed"), undefined);
    });

    it("isolates registries by app", () => {
        const firstApp = {};
        const secondApp = {};
        getCommandRegistry(firstApp).register(createCommand("core.first"), firstApp);

        assert.notEqual(getCommandRegistry(firstApp), getCommandRegistry(secondApp));
        assert.equal(getCommandRegistry(secondApp).get("core.first"), undefined);
    });
});
