import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {createPaletteFocusLifecycle, normalizePaletteHistory, queryCommandPalette, recordPaletteCommand} from "./paletteCore";
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
    it("prioritizes recent available commands and preserves the remaining order", () => {
        const registry = new CommandRegistry();
        registry.register(command("core.first", "First", 0), {});
        registry.register(command("core.second", "Second", 1), {});
        registry.register(command("plugin/recent", "Recent", 10_000), {});
        registry.register({...command("core.hidden", "Hidden", 2), when: () => false}, {});
        const history = ["missing", "core.hidden", "plugin/recent", "core.second"];
        assert.deepEqual(queryCommandPalette(registry, context, "", history).map(item => item.id), [
            "plugin/recent", "core.second", "core.first",
        ]);
    });

    it("keeps search relevance ahead of recency and uses recency to break ties", () => {
        const registry = new CommandRegistry();
        registry.register(command("exact", "Open", 0), {});
        registry.register(command("older", "Open file", 1), {});
        registry.register(command("recent", "Open notebook", 2), {});
        registry.register(command("unrelated", "Close", 3), {});
        assert.deepEqual(queryCommandPalette(registry, context, "open", ["unrelated", "recent"]).map(item => item.id), [
            "exact", "recent", "older",
        ]);
    });

    it("deduplicates and bounds persisted history and tolerates invalid data", () => {
        assert.deepEqual(normalizePaletteHistory({}), []);
        assert.deepEqual(normalizePaletteHistory([null, "", 1, "a", "a", "b"]), ["a", "b"]);
        assert.deepEqual(recordPaletteCommand(["a", "b"], "b"), ["b", "a"]);
        const history = recordPaletteCommand(Array.from({length: 100}, (_, index) => `${index}`), "new");
        assert.equal(history.length, 64);
        assert.equal(history[0], "new");
        assert.equal(history[63], "62");
    });

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
