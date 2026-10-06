import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {flushSettingSaves, trackSettingRequest} from "../../config/setting/pending";
import {posix} from "node:path";

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

const createMenuGraph = (restricted = false) => {
    const exports = {} as typeof import("./Graph");
    const listeners = new Map<string, Set<() => void>>();
    const requests: Array<{url: string, body: unknown}> = [];
    const menus: Parameters<typeof import("../../menus/navigation").initDocumentMenu>[1][] = [];
    const positions: IPosition[] = [];
    let resolveSiblings: (value: unknown) => void;
    const siblings = new Promise(resolve => { resolveSiblings = resolve; });
    runInNewContext(transpileModule(readFileSync("src/layout/dock/Graph.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText, {
        exports, AbortController,
        require: (name: string) => {
            if (name === "../Model") { return {Model: class {}}; }
            if (name === "../../util/pathName") { return {pathPosix: () => posix}; }
            if (name === "../../constants") { return {Constants: {
                CUSTOM_SY_SUBDOC_SORT_MODE: "custom-sy-subdoc-sort-mode", CUSTOM_SY_READONLY: "custom-sy-readonly"}}; }
            if (name === "../../menus/navigation") { return {
                initDocumentMenu: (_app: unknown, options: typeof menus[number]) => {
                    menus.push(options);
                    return {popup: (position: IPosition) => positions.push(position)};
                }}; }
            if (name === "../../util/fetch") { return {
                fetchSyncPost: (url: string, body: unknown) => {
                    requests.push({url, body});
                    if (url.endsWith("getBlockInfo")) {
                        return Promise.resolve({code: 0, data: restricted ? {publishAccessRequired: true} :
                            {box: "notebook", path: "/parent/doc.sy"}});
                    }
                    if (url.endsWith("getDocInfo")) {
                        return Promise.resolve({code: 0, data: {rootID: "doc", name: "Document", subFileCount: 2,
                            ial: {"custom-sy-subdoc-sort-mode": "0", "custom-sy-readonly": "true"}}});
                    }
                    return siblings;
                }}; }
            return {};
        },
        document: {
            addEventListener: (name: string, listener: () => void) => {
                if (!listeners.has(name)) { listeners.set(name, new Set()); }
                listeners.get(name).add(listener);
            },
            removeEventListener: (name: string, listener: () => void) => listeners.get(name)?.delete(listener),
        },
        window: {siyuan: {menus: {menu: {remove() {}}}, config: {editor: {readOnly: false}}}},
    });
    const graph = Object.assign(Object.create(exports.Graph.prototype), {
        app: {}, menuRequestVersion: 0, graphElement: {isConnected: true, querySelectorAll: (): HTMLElement[] => []},
    });
    return {graph, listeners, requests, menus, positions, resolveSiblings: () =>
        resolveSiblings({code: 0, data: {effectiveSortMode: 6, files: []}})};
};

test("graph document menu uses current metadata independently of the document tree display limit", async () => {
    const {graph, menus, positions, requests, listeners, resolveSiblings} = createMenuGraph();
    const pending = graph.openGraphNodeMenu({node: {id: "doc", path: "/stale/doc.sy"}, x: 80, y: 100});
    resolveSiblings();
    await pending;
    assert.equal(menus.length, 1);
    assert.equal(menus[0].path, "/parent/doc.sy");
    assert.equal(menus[0].childrenSortMode, 0);
    assert.equal(menus[0].customSort, true);
    assert.equal(menus[0].readonlyHistory, true);
    assert.equal(menus[0].elements.length, 0);
    assert.equal(JSON.stringify(positions), '[{"x":80,"y":100}]');
    assert.equal(JSON.stringify(requests[2].body),
        '{"notebook":"notebook","path":"/parent","maxListCount":1,"ignoreMaxListHint":true}');
    assert.equal(listeners.get("pointerdown").size, 0);
    assert.equal(listeners.get("keydown").size, 0);
});

for (const event of ["pointerdown", "keydown"]) {
    test(`graph menu requests are discarded after ${event}`, async () => {
        const {graph, menus, listeners, resolveSiblings} = createMenuGraph();
        const pending = graph.openGraphNodeMenu({node: {id: "doc"}, x: 0, y: 0});
        listeners.get(event).forEach(listener => listener());
        resolveSiblings();
        await pending;
        assert.equal(menus.length, 0);
        assert.equal(listeners.get(event).size, 0);
    });
}

test("graph menu does not act on restricted document metadata", async () => {
    const {graph, requests, menus} = createMenuGraph(true);
    await graph.openGraphNodeMenu({node: {id: "doc"}, x: 0, y: 0});
    assert.equal(menus.length, 0);
    assert.equal(requests.length, 2);
});
