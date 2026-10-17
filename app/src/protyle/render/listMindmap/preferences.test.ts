import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {runInNewContext} from "node:vm";
import {ScriptTarget, transpileModule} from "typescript";
import {LIST_MINDMAP_CONNECTOR_STYLES} from "./connectors";

const compiled = transpileModule(readFileSync("src/protyle/render/listMindmap/preferences.ts", "utf8")
    .replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, "") +
    "\nglobalThis.api = {getDefaultListMindmapConnectorStyle, setDefaultListMindmapConnectorStyle, LIST_MINDMAP_DEFAULT_CONNECTOR_STYLE_KEY};",
{compilerOptions: {target: ScriptTarget.ES2021}}).outputText;

test("connector preferences validate stored values and persist through the shared local storage API", () => {
    const storage: Record<string, unknown> = {};
    const saved: Record<string, unknown> = {};
    const writes: unknown[] = [];
    const context: any = {LIST_MINDMAP_CONNECTOR_STYLES, window: {siyuan: {storage, config: {}}},
        setStorageVal: (key: string, value: unknown) => { saved[key] = value; writes.push(value); }};
    runInNewContext(compiled, context);
    const {api} = context;
    const key = api.LIST_MINDMAP_DEFAULT_CONNECTOR_STYLE_KEY;
    for (const invalid of [undefined, null, "future", "", false, 1, {}, []]) {
        storage[key] = invalid;
        assert.equal(api.getDefaultListMindmapConnectorStyle(), "bezier");
        assert.equal(storage[key], invalid, "reading cannot overwrite an unknown preference");
    }
    for (const style of LIST_MINDMAP_CONNECTOR_STYLES) {
        api.setDefaultListMindmapConnectorStyle(style);
        assert.equal(storage[key], style);
        assert.equal(saved[key], style);
        assert.equal(api.getDefaultListMindmapConnectorStyle(), style);
    }
    assert.equal(writes.length, 4);
    api.setDefaultListMindmapConnectorStyle("rounded");
    api.setDefaultListMindmapConnectorStyle("future");
    assert.equal(writes.length, 4);
    context.window.siyuan.storage = JSON.parse(JSON.stringify(saved));
    const reloaded = {...context};
    runInNewContext(compiled, reloaded);
    assert.equal(reloaded.api.getDefaultListMindmapConnectorStyle(), "rounded", "reloaded local preferences retain the default");
    context.window.siyuan.storage[key] = "orthogonal";
    assert.equal(api.getDefaultListMindmapConnectorStyle(), "orthogonal", "storage updates from another window are read afresh");
    for (const mode of ["readonly", "publish"]) {
        context.window.siyuan.config.readonly = mode === "readonly";
        context.window.siyuan.isPublish = mode === "publish";
        api.setDefaultListMindmapConnectorStyle("spline");
        assert.equal(api.getDefaultListMindmapConnectorStyle(), "orthogonal");
        assert.equal(writes.length, 4);
    }
});
