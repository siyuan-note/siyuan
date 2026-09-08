import * as assert from "node:assert/strict";
import test from "node:test";
import {CommandRegistry} from "./registry";
import {IShortcutCandidate, resolveShortcut} from "./shortcutResolver";
import type {ICommandContextSnapshot, ICommandDefinition} from "./types";

const context: ICommandContextSnapshot = {app: {}, source: "shortcut", environment: "desktop", focus: "editor", selectedBlocks: []};
const candidate = (id: string, scope: IShortcutCandidate["scope"] = "global"): IShortcutCandidate =>
    ({id, scope, context});
const definition = (id: string, overrides: Partial<ICommandDefinition> = {}): ICommandDefinition =>
    ({id, category: "core", label: () => id, execute: () => undefined, ...overrides});

test("current local scope wins before global scope; disabled local commands fall back", async () => {
    const registry = new CommandRegistry();
    let enabled = true;
    registry.register(definition("local", {enabled: () => enabled}), "local");
    registry.register(definition("global"), "global");
    const candidates = [candidate("global"), candidate("local", "editor")];
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
    registry.register(definition("zz.available"), "zz.available");
    assert.equal(resolveShortcut(registry, [candidate("source"), candidate("platform"),
        candidate("when"), candidate("enabled"), candidate("zz.available")], assert.fail).candidate.id, "zz.available");
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
        const prepared = resolveShortcut(registry, [candidate("first"), candidate("second")], assert.fail);
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
    assert.equal(resolveShortcut(registry, [candidate("first"), candidate("second")], error => errors.push(error)).candidate.id, "second");
    assert.equal(errors.length, 1);
});

test("inactive local scopes never handle the shortcut", () => {
    const registry = new CommandRegistry();
    registry.register(definition("dock"), "dock");
    registry.register(definition("global"), "global");
    assert.equal(resolveShortcut(registry, [candidate("dock", "dock"), candidate("global")], assert.fail).candidate.id, "global");
});

test("legacy priorities do not affect the fixed order", () => {
    const registry = new CommandRegistry();
    registry.register(definition("a"), "a");
    registry.register(definition("b"), "b");
    const candidates = [Object.assign(candidate("b"), {priority: 100}), candidate("a")];
    assert.equal(resolveShortcut(registry, candidates, assert.fail).candidate.id, "a");
});
