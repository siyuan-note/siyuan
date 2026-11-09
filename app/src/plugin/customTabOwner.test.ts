import * as assert from "node:assert/strict";
import {test} from "node:test";
import type {App} from "../index";
import type {Tab} from "../layout/Tab";
import {getCustomTabOwner, rememberCustomTabPlugins, resolveCustomModelFactory,
    resolveCustomTabOwner, setCustomTabCatalogAvailable, setCustomTabOwner} from "./customTabOwner";

const fixture = () => {
    const first = (): undefined => undefined;
    const second = (): undefined => undefined;
    const plugins = [{name: "foo", models: {foobar: first}}, {name: "foob", models: {foobar: second}}];
    const app = {plugins} as unknown as App;
    const tab = {} as Tab;
    return {app, tab, plugins, first, second};
};

test("ambiguous legacy custom tab keys never choose the first or longest matching plugin", () => {
    const {app, tab, plugins} = fixture();
    assert.equal(resolveCustomTabOwner(app, "foobar", tab), undefined);
    assert.equal(resolveCustomModelFactory(app, "foobar", tab), undefined);
    plugins[1].models = {} as typeof plugins[1]["models"];
    assert.equal(resolveCustomModelFactory(app, "foobar", tab), undefined,
        "a temporarily unregistered factory does not resolve an overlapping plugin name");
});

test("runtime ownership survives instance replacement and disambiguates colliding factories", () => {
    const {app, tab, plugins, first} = fixture();
    setCustomTabOwner(tab, "foo");
    assert.equal(getCustomTabOwner(tab), "foo");
    assert.equal(resolveCustomModelFactory(app, "foobar", tab), first);
    plugins[0] = {name: "foo", models: {} as typeof plugins[0]["models"]};
    assert.equal(resolveCustomTabOwner(app, "foobar", tab), "foo");
    assert.equal(resolveCustomModelFactory(app, "foobar", tab), undefined);
    plugins.splice(0, 1);
    assert.equal(resolveCustomTabOwner(app, "foobar", tab), "foo");
    assert.equal(resolveCustomModelFactory(app, "foobar", tab), undefined,
        "an unloaded owner's data cannot be passed to the colliding plugin");
});

test("installed disabled plugins participate in ownership and ambiguity without needing factories", () => {
    const {app} = fixture();
    app.plugins.length = 0;
    rememberCustomTabPlugins(app, ["foo"]);
    assert.equal(resolveCustomTabOwner(app, "foobar"), "foo");
    assert.equal(resolveCustomModelFactory(app, "foobar"), undefined);
    rememberCustomTabPlugins(app, ["foob"]);
    assert.equal(resolveCustomTabOwner(app, "foobar"), undefined);
    assert.equal(resolveCustomTabOwner(app, "orphan-tab"), undefined);
    assert.equal(resolveCustomTabOwner(app, "foo"), undefined);
    rememberCustomTabPlugins(app, ["siyuan"]);
    assert.equal(resolveCustomTabOwner(app, "siyuan-card"), undefined);
    assert.equal(resolveCustomTabOwner(app, "siyuan-database-row"), undefined);
});

test("nonstandard IDs use only an unambiguous registered factory and stay scoped to the app", () => {
    const {app, first} = fixture();
    app.plugins.splice(1, 1);
    app.plugins[0].models["legacy"] = first;
    assert.equal(resolveCustomModelFactory(app, "legacy"), first);
    rememberCustomTabPlugins(app, ["other"]);
    const other = {plugins: []} as unknown as App;
    assert.equal(resolveCustomTabOwner(other, "other-view"), undefined);
});

test("an unavailable installed catalog preserves tabs and blocks inferred factories without losing runtime owners", () => {
    const {app, tab, plugins, first} = fixture();
    plugins.splice(1, 1);
    setCustomTabCatalogAvailable(app, false);
    assert.equal(resolveCustomTabOwner(app, "foobar"), undefined);
    assert.equal(resolveCustomModelFactory(app, "foobar"), undefined);
    setCustomTabOwner(tab, "foo");
    assert.equal(resolveCustomModelFactory(app, "foobar", tab), first);
    setCustomTabCatalogAvailable(app, true);
    assert.equal(resolveCustomModelFactory(app, "foobar"), first);
});
