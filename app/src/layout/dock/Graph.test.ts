import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {flushSettingSaves, trackSettingRequest} from "../../config/setting/pending";

for (const type of ["global", "local", "pin"]) {
    test(`reset flushes the latest delayed graph settings before acknowledging (${type})`, async () => {
        const timers = new Map<number, () => void>();
        const writes: Array<{type: string, conf: {dailyNote: boolean}}> = [];
        let timerID = 0;
        let release: () => void;
        const request = new Promise<void>(resolve => { release = resolve; });
        const exports = {} as typeof import("./Graph");
        const code = transpileModule(readFileSync("src/layout/dock/Graph.ts", "utf8"), {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
        }).outputText;
        runInNewContext(code, {
            exports,
            require: () => ({Model: class {}, fetchPost: (url: string, data: typeof writes[number]) => {
                writes.push(data);
                return trackSettingRequest(url, request);
            }}),
            window: {
                siyuan: {config: {graph: {}}},
                setTimeout: (callback: () => void) => { timers.set(++timerID, callback); return timerID; },
                clearTimeout: (id: number) => timers.delete(id),
            },
        });
        let conf = {dailyNote: false};
        const graph = Object.assign(Object.create(exports.Graph.prototype), {
            type, getGraphConf: () => conf, onGraph() {},
        });
        graph.updateGraphOptions();
        conf = {dailyNote: true};
        graph.updateGraphOptions();
        assert.equal(writes.length, 0);
        assert.equal(timers.size, 1);
        graph.scheduleGraphSearch();
        const resume = graph.suspendSettingsSaving();
        assert.equal(timers.size, 0);
        assert.equal(writes.length, 1);
        assert.equal(writes[0].type, type === "global" ? "global" : "local");
        assert.equal(writes[0].conf, conf);
        graph.searchGraph();
        assert.equal(writes.length, 1);
        let flushed = false;
        const flush = flushSettingSaves().then(() => { flushed = true; });
        await Promise.resolve();
        await Promise.resolve();
        assert.equal(flushed, false);
        release();
        await flush;
        graph.flushPendingSettings();
        assert.equal(writes.length, 1);
        let refreshed = false;
        graph.searchGraph = () => { refreshed = true; };
        resume();
        assert.equal(refreshed, true);
        assert.equal(graph.settingsSavingSuspended, false);
    });
}
