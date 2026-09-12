import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import * as catalog from "./catalog";
import * as order from "./order";
import * as profile from "./profile";

const keys = ["barDock", "message", "spacer", "backgroundTask", "counter", "statusHelp"];

test("status bar catalog matches markup and preserves default visibility", () => {
    const nodes = catalog.getEntryCatalogChildren(catalog.STATUS_BAR_ROOT_PATH);
    const source = readFileSync("src/layout/status.ts", "utf8");
    assert.deepEqual(Array.from(source.matchAll(/data-statusbar-entry="([^"]+)"/g), match => match[1]), keys);
    assert.deepEqual(nodes.map(node => node.key), keys);
    assert.equal(catalog.isEntryCatalogNodeConfigurable(nodes[2]), false);
    assert.ok(catalog.getEntryOrderParents().includes(catalog.STATUS_BAR_ROOT_PATH));
    nodes.filter(catalog.isEntryCatalogNodeConfigurable).forEach(node => {
        const path = `${catalog.STATUS_BAR_ROOT_PATH}.${node.key}`;
        assert.equal(profile.getBuiltinProfileEntryVisibility("simple", node.simple), true);
        assert.equal(profile.getProfileEntryVisibility({entries: {}}, path), true);
    });
});

const compiled = transpileModule(readFileSync("src/config/entryVisibility/runtime.ts", "utf8")
    .replace(/\/\/\/ #if MOBILE\r?\n[\s\S]*?\/\/\/ #endif/g, ""), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

test("status bar profiles preserve plugin slots and conditional visibility across refreshes", () => {
    const elements = keys.map(key => ({
        dataset: {statusbarEntry: key},
        attributes: new Map<string, string>(),
        setAttribute(name: string, value: string) { this.attributes.set(name, value); },
        removeAttribute(name: string) { this.attributes.delete(name); },
    }));
    const plugin = {...elements[0], dataset: {statusbarEntry: ""}};
    const children = [...elements];
    children.splice(2, 0, plugin);
    const status = {
        children,
        append(item: typeof elements[number]) {
            children.splice(children.indexOf(item), 1);
            children.push(item);
        },
    };
    const custom = {
        id: "custom", entries: {"statusBar.backgroundTask": false, "statusBar.counter": false, "statusBar.spacer": false},
        orders: {statusBar: ["statusHelp", "message", "spacer", "counter", "backgroundTask", "barDock"]},
    };
    const config = {active: "custom", profiles: [custom]};
    const exports = {} as {applyStatusBarEntryVisibility: () => void};
    runInNewContext(compiled, {
        exports,
        require: (name: string) => name === "./catalog" ? catalog : name === "./order" ? order :
            name === "./profile" ? profile : name === "./dockOrder" ? {isDockOrderScope: () => false} : {},
        window: {siyuan: {config: {appearance: {entryVisibility: config}}}},
        document: {getElementById: () => status},
    });
    exports.applyStatusBarEntryVisibility();
    assert.equal(children[2], plugin);
    assert.deepEqual(children.filter(item => item !== plugin).map(item => item.dataset.statusbarEntry), custom.orders.statusBar);
    assert.equal(elements[3].attributes.get("data-entry-hidden"), "true");
    assert.equal(elements[4].attributes.get("data-entry-hidden"), "true");
    assert.equal(elements[2].attributes.has("data-entry-hidden"), false);
    exports.applyStatusBarEntryVisibility();
    assert.equal(elements[3].attributes.get("data-entry-hidden"), "true");
    config.active = "full";
    exports.applyStatusBarEntryVisibility();
    assert.deepEqual(children.filter(item => item !== plugin).map(item => item.dataset.statusbarEntry), keys);
    assert.equal(elements[3].attributes.has("data-entry-hidden"), false);
    assert.equal(children[2], plugin);
    children.splice(children.indexOf(elements[0]), 1);
    assert.doesNotThrow(() => exports.applyStatusBarEntryVisibility());
});

test("older status bar orders place newly added items on their default side of the spacer", () => {
    const resolved = order.resolveEntryOrderWithBoundaryDefaults(keys, ["statusHelp", "spacer", "barDock"], "spacer", new Set());
    assert.ok(resolved.indexOf("message") < resolved.indexOf("spacer"));
    assert.ok(resolved.indexOf("counter") > resolved.indexOf("spacer"));
    assert.ok(resolved.indexOf("backgroundTask") > resolved.indexOf("spacer"));
});
