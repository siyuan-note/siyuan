import * as assert from "node:assert/strict";
import test from "node:test";
import {CommandRegistry} from "./registry";
import {IShortcutCandidate, resolveShortcut} from "./shortcutResolver";
import {canShareKeymap, canShareShortcutPaths, getShortcutScopes} from "./shortcutCatalog";
import type {ICommandContextSnapshot, ICommandDefinition} from "./types";

const context: ICommandContextSnapshot = {app: {}, source: "shortcut", environment: "desktop", focus: "editor", selectedBlocks: []};
const candidate = (id: string, priority = 0, scope: IShortcutCandidate["scope"] = "global"): IShortcutCandidate =>
    ({id, priority, scope, context});
const definition = (id: string, overrides: Partial<ICommandDefinition> = {}): ICommandDefinition =>
    ({id, category: "core", label: () => id, execute: () => undefined, ...overrides});

test("local scope wins before explicit priorities; disabled local commands fall back", async () => {
    const registry = new CommandRegistry();
    let enabled = true;
    registry.register(definition("local", {enabled: () => enabled}), "local");
    registry.register(definition("global"), "global");
    const candidates = [candidate("global", 100), candidate("local", 0, "editor")];
    assert.equal(resolveShortcut(registry, candidates, assert.fail).candidate.id, "local");
    enabled = false;
    assert.equal(resolveShortcut(registry, candidates, assert.fail).candidate.id, "global");
});

test("source, platform, when and enabled are checked before execution", () => {
    const registry = new CommandRegistry();
    registry.register(definition("source", {surfaces: ["menu"]}), "source");
    registry.register(definition("platform", {platform: environment => environment === "mobile"}), "platform");
    registry.register(definition("when", {when: () => false}), "when");
    registry.register(definition("enabled", {enabled: () => false}), "enabled");
    registry.register(definition("available"), "available");
    assert.equal(resolveShortcut(registry, [candidate("source", 4), candidate("platform", 3),
        candidate("when", 2), candidate("enabled", 1), candidate("available")], assert.fail).candidate.id, "available");
});

test("tie breaking survives registration and plugin reload order", () => {
    for (const order of [["b", "a"], ["a", "b"]]) {
        const registry = new CommandRegistry();
        order.forEach(id => registry.register(definition(id), id));
        assert.equal(resolveShortcut(registry, order.map(id => candidate(id)), assert.fail).candidate.id, "a");
        registry.unregisterOwner("a");
        assert.equal(resolveShortcut(registry, order.map(id => candidate(id)), assert.fail).candidate.id, "b");
        registry.register(definition("a"), "a");
        assert.equal(resolveShortcut(registry, order.map(id => candidate(id)), assert.fail).candidate.id, "a");
    }
});

test("preparing a shortcut has no execution side effects and failures never run another candidate", async () => {
    for (const failure of [false, new Error("failed")]) {
        const calls: string[] = [];
        const registry = new CommandRegistry();
        registry.register(definition("first", {execute: async () => {
            calls.push("first");
            if (failure instanceof Error) {
                throw failure;
            }
            return failure;
        }}), "first");
        registry.register(definition("second", {execute: () => calls.push("second")}), "second");
        const prepared = resolveShortcut(registry, [candidate("first", 1), candidate("second")], assert.fail);
        assert.deepEqual(calls, []);
        if (failure instanceof Error) {
            await assert.rejects(prepared.run, /failed/);
        } else {
            assert.equal((await prepared.run()).value, false);
        }
        assert.deepEqual(calls, ["first"]);
    }
});

test("a throwing condition is reported and skipped", () => {
    const errors: unknown[] = [];
    const registry = new CommandRegistry();
    registry.register(definition("first", {when: () => { throw new Error("condition"); }}), "first");
    registry.register(definition("second"), "second");
    assert.equal(resolveShortcut(registry, [candidate("first", 1), candidate("second")], error => errors.push(error)).candidate.id, "second");
    assert.equal(errors.length, 1);
});

test("shared bindings expose only migrated native actions and installed plugin commands", () => {
    assert.equal(canShareKeymap(["general", "goToTab5"], []), true);
    assert.equal(canShareKeymap(["editor", "insert", "bold"], []), false);
    assert.equal(canShareKeymap(["plugin", "missing", "command"], []), false);
    assert.deepEqual(getShortcutScopes(["plugin", "test", "command"], [{name: "test", commands: [{langKey: "command",
        callback: (): void => {}, editorCallback: (): void => {}, globalCallback: (): void => {}}]}]), ["editor", "system"]);
});

test("system-wide bindings cannot shadow application bindings through sharing", () => {
    const plugins = [{name: "test", commands: [{langKey: "system", globalCallback: true}, {langKey: "other", globalCallback: true}]}];
    assert.equal(canShareShortcutPaths([["general", "goToTab5"], ["plugin", "test", "system"]], plugins), false);
    assert.equal(canShareShortcutPaths([["plugin", "test", "other"], ["plugin", "test", "system"]], plugins), true);
});
