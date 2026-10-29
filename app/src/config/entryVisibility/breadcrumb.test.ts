import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import * as catalog from "./catalog";
import * as order from "./order";
import * as profile from "./profile";
import {getPluginBreadcrumbEntryKey} from "../../plugin/breadcrumbButtonRegistry";

const {parse} = require("ifdef-loader/preprocessor");
const keys = ["undo", "redo", "outdent", "indent", "command-panel", "readonly", "doc", "more"];
const root = catalog.BREADCRUMB_ROOT_PATH;

test("breadcrumb catalog matches built-in markup and preserves existing profile defaults", () => {
    catalog.refreshBreadcrumbCatalog([]);
    const source = readFileSync("src/protyle/breadcrumb/index.ts", "utf8");
    assert.deepEqual(Array.from(source.matchAll(/data-breadcrumb-entry="([^"]+)"/g), match => match[1]), keys);
    assert.deepEqual(catalog.getEntryCatalogChildren(root).map(node => node.key), keys);
    for (const key of keys) {
        const path = `${root}.${key}`;
        const node = catalog.getEntryCatalogNode(path);
        assert.equal(catalog.getEntryParentPath(path), root);
        assert.equal(profile.getBuiltinProfileEntryVisibility("simple", node.simple), true);
        assert.equal(profile.getProfileEntryVisibility({entries: {}}, path), true);
    }
    for (const key of ["mobile-menu", "exit-focus", "context"]) {
        assert.equal(catalog.getEntryCatalogNode(`${root}.${key}`), undefined);
    }
});

test("breadcrumb catalog refreshes registered plugins without duplicating or reusing built-in IDs", () => {
    const key = getPluginBreadcrumbEntryKey("plugin.a", "more");
    catalog.refreshBreadcrumbCatalog([{key, label: "Plugin - More"}, {key, label: "Duplicate"},
        {key: "more", label: "Invalid"}]);
    assert.deepEqual(catalog.getEntryCatalogChildren(root).map(node => node.key), [key, ...keys]);
    assert.equal(catalog.getEntryCatalogNode(`${root}.${key}`).label(), "Plugin - More");
    assert.equal(catalog.getEntryParentPath(`${root}.${key}`), root);
    catalog.refreshBreadcrumbCatalog([]);
    assert.equal(catalog.getEntryCatalogNode(`${root}.${key}`), undefined);
    assert.ok(catalog.getEntryCatalogNode(`${root}.more`));
});

for (const mobile of [false, true]) {
    test(`${mobile ? "mobile" : "desktop"} breadcrumb profiles mix plugin order and retain business visibility`, () => {
        const pluginKey = getPluginBreadcrumbEntryKey("plugin", "button");
        catalog.refreshBreadcrumbCatalog([{key: pluginKey, label: "Plugin"}]);
        const makeElement = (key?: string, hidden = false) => ({
            dataset: {breadcrumbEntry: key},
            attributes: new Map<string, string>(),
            businessHidden: hidden,
            disabled: key === "undo",
            setAttribute(name: string, value: string) { this.attributes.set(name, value); },
            removeAttribute(name: string) { this.attributes.delete(name); },
        });
        const fixed = makeElement(undefined, true);
        const children = [makeElement(pluginKey), fixed, ...keys.map(key => makeElement(key, key === "readonly"))];
        const element = {children, append(item: typeof children[number]) {
            children.splice(children.indexOf(item), 1);
            children.push(item);
        }};
        const custom = {id: "custom", entries: {[`${root}.readonly`]: false, [`${root}.${pluginKey}`]: false},
            orders: {[root]: ["more", "plugin:unavailable:button", pluginKey, "doc", "readonly", "command-panel",
                "indent", "outdent", "redo", "undo"]}};
        const config = {active: "custom", profiles: [custom]};
        const saved = JSON.stringify(custom);
        const exports = {} as {applyBreadcrumbEntryVisibility: (element: unknown) => void;
            applyEntryVisibility: (config: unknown) => void};
        const compiled = transpileModule(parse(readFileSync("src/config/entryVisibility/runtime.ts", "utf8"),
            {MOBILE: mobile, BROWSER: true}, false, true), {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
        }).outputText;
        runInNewContext(compiled, {
            exports,
            require: (name: string) => name === "./catalog" ? catalog : name === "./order" ? order :
                name === "./profile" ? profile : name === "./dockOrder" ? {isDockOrderScope: () => false} : {},
            window: {siyuan: {config: {appearance: {entryVisibility: config}}}, dispatchEvent() {}},
            document: {querySelectorAll: (selector: string) => selector === ".protyle-breadcrumb__actions" ? [element] : []},
            CustomEvent: class {},
        });
        const apply = () => mobile ? exports.applyEntryVisibility(config) : exports.applyBreadcrumbEntryVisibility(element);
        apply();
        assert.equal(children[1], fixed);
        assert.deepEqual(children.filter(item => item !== fixed).map(item => item.dataset.breadcrumbEntry),
            custom.orders[root].filter(key => key !== "plugin:unavailable:button"));
        for (const key of [pluginKey, "readonly"]) {
            assert.equal(children.find(item => item.dataset.breadcrumbEntry === key).attributes.get("data-entry-hidden"), "true");
        }
        config.active = "full";
        apply();
        assert.deepEqual(children.filter(item => item !== fixed).map(item => item.dataset.breadcrumbEntry), [pluginKey, ...keys]);
        assert.equal(children.find(item => item.dataset.breadcrumbEntry === "readonly").businessHidden, true);
        assert.equal(children.find(item => item.dataset.breadcrumbEntry === "undo").disabled, true);
        assert.ok(children.every(item => !item.attributes.has("data-entry-hidden")));
        assert.equal(fixed.businessHidden, true);
        config.active = "custom";
        apply();
        assert.equal(JSON.stringify(custom), saved);
        catalog.refreshBreadcrumbCatalog([]);
    });
}
