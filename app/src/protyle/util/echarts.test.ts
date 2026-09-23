import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import * as path from "node:path";
import {test} from "node:test";
import {ModuleKind, transpileModule} from "typescript";

test("ECharts loading shares the pending script and allows retry after failure", async () => {
    const source = transpileModule(readFileSync(path.join(__dirname, "echarts.ts"), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText;
    const exports = {} as typeof import("./echarts");
    const fakeWindow = {echarts: undefined as object | undefined};
    const loads: {url: string; id: string; resolve: (loaded: boolean) => void}[] = [];
    new Function("require", "exports", "window", source)((name: string) => {
        if (name === "../../constants") {
            return {Constants: {PROTYLE_CDN: "/stage/protyle"}};
        }
        if (name === "./addScript") {
            return {addScript: (url: string, id: string) => new Promise<boolean>(resolve => loads.push({url, id, resolve}))};
        }
        throw new Error(`Unexpected dependency: ${name}`);
    }, exports, fakeWindow);

    const first = exports.loadECharts();
    assert.equal(exports.loadECharts(), first);
    assert.equal(loads.length, 1);
    assert.equal(loads[0].id, "protyleEchartsScript");
    assert.equal(loads[0].url, "/stage/protyle/js/echarts/echarts.min.js?v=5.3.2");
    loads[0].resolve(false);
    assert.equal(await first, false);

    const retry = exports.loadECharts("https://example.com/protyle");
    assert.equal(exports.loadECharts(), retry);
    assert.equal(loads.length, 2);
    assert.equal(loads[1].url, "https://example.com/protyle/js/echarts/echarts.min.js?v=5.3.2");
    const registry = {};
    fakeWindow.echarts = registry;
    loads[1].resolve(true);
    assert.equal(await retry, true);
    assert.equal(await exports.loadECharts(), true);
    assert.equal(loads.length, 2, "loaded ECharts must not execute again and reset the chart registry");
    assert.equal(fakeWindow.echarts, registry);
});
