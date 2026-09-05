import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {createPaletteFocusLifecycle, queryCommandPalette} from "./paletteCore";
import {CommandRegistry} from "./registry";
import type {ICommandContextSnapshot, ICommandDefinition} from "./types";

const context: ICommandContextSnapshot = {
    app: {},
    source: "commandPanel",
    environment: "desktop",
    focus: "global",
    selectedBlocks: [],
};

const command = (id: string, label: string, order: number): ICommandDefinition => ({
    id,
    category: id.startsWith("plugin/") ? "plugin" : "core",
    label: () => label,
    order,
    execute: () => undefined,
});

describe("command palette core", () => {
    it("keeps core commands before plugins regardless of registration time", () => {
        const registry = new CommandRegistry();
        registry.register(command("plugin/sample/open", "Plugin open", 10_000), {});
        registry.register(command("core.general.open", "Open", 0), {});

        assert.deepEqual(queryCommandPalette(registry, context, "").map(item => item.id), [
            "core.general.open",
            "plugin/sample/open",
        ]);
    });

    it("returns an empty result without throwing", () => {
        assert.deepEqual(queryCommandPalette(new CommandRegistry(), context, "anything"), []);
    });

    it("restores focus before a command without stealing it again on close", () => {
        const events: string[] = [];
        const lifecycle = createPaletteFocusLifecycle(() => events.push("restore"));

        lifecycle.prepareCommand(() => events.push("prevent default"));
        events.push("execute");
        lifecycle.restoreAfterCancel();

        assert.deepEqual(events, ["prevent default", "restore", "execute"]);
    });

    it("restores focus once when the palette is canceled", () => {
        const events: string[] = [];
        const lifecycle = createPaletteFocusLifecycle(() => events.push("restore"));

        assert.equal(lifecycle.restoreAfterCancel(), true);
        assert.equal(lifecycle.restoreAfterCancel(), true);

        assert.deepEqual(events, ["restore"]);
    });

    it("can cancel without restoring focus", () => {
        const events: string[] = [];
        const lifecycle = createPaletteFocusLifecycle(() => events.push("restore"));

        assert.equal(lifecycle.restoreAfterCancel(false), true);
        assert.deepEqual(events, []);
    });

    it("does not treat command execution as cancellation", () => {
        const lifecycle = createPaletteFocusLifecycle(() => undefined);

        lifecycle.prepareCommand();

        assert.equal(lifecycle.restoreAfterCancel(false), false);
    });
});
