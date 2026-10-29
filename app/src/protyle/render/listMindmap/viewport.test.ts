import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import type {ListMindmapViewport} from "./viewport";

const key = "local-mindmap-viewports";
const compiled = transpileModule(readFileSync("src/protyle/render/listMindmap/viewport.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;
const state: ListMindmapViewport = {scale: 1.25, center: {x: 220, y: 180}};
const fixture = (storage: Record<string, unknown> = {}) => {
    const writes: unknown[] = [];
    const timers = new Map<number, () => void>();
    let nextTimer = 0;
    const siyuan = {storage, config: {readonly: false}, isPublish: false};
    const root = {};
    const owner = {lite: false, notebookId: "ordinary", options: {action: [] as string[]}, wysiwyg: {element: root}};
    let excluded = false;
    const list = (id = "map") => ({dataset: {nodeId: id},
        closest: (selector: string) => selector === ".protyle-wysiwyg" ? root : excluded ? root : null});
    const api = {} as typeof import("./viewport");
    runInNewContext(compiled, {exports: api, window: {siyuan,
        setTimeout: (action: () => void) => { timers.set(++nextTimer, action); return nextTimer; },
        clearTimeout: (id: number) => timers.delete(id)}, require: (id: string) => {
        if (id === "../../../constants") {
            return {Constants: {LOCAL_MINDMAP_VIEWPORTS: key, CB_GET_HISTORY: "history"}};
        }
        if (id === "../../../util/pathName") {
            return {isEncryptedBox: (id: string) => id === "encrypted"};
        }
        assert.equal(id, "../../util/compatibility");
        return {setStorageVal: (name: string, value: unknown) => {
            assert.equal(name, key);
            writes.push(JSON.parse(JSON.stringify(value)));
        }};
    }});
    return {siyuan, owner, writes, timers, list, api,
        exclude: () => { excluded = true; },
        get: (id = "map") => api.getListMindmapViewport(owner as IProtyle, list(id) as unknown as HTMLElement),
        save: (value = state, id = "map") => api.saveListMindmapViewport(owner as IProtyle, list(id) as unknown as HTMLElement, value)};
};

test("mindmap viewports survive reopening and restart, independently for each block", () => {
    const f = fixture();
    f.save();
    f.save({scale: .75, center: {x: 10, y: 20}}, "other");
    assert.equal(f.writes.length, 0, "continuous changes are coalesced");
    assert.equal(f.timers.size, 1);
    assert.equal(JSON.stringify(f.get()), JSON.stringify(state));
    f.api.flushListMindmapViewports();
    assert.equal(f.writes.length, 1);
    assert.equal(f.timers.size, 0);
    const restarted = fixture({[key]: f.writes[0]});
    assert.equal(JSON.stringify(restarted.get()), JSON.stringify(state));
    assert.equal(restarted.get("other").scale, .75);
    assert.equal(restarted.get("missing"), undefined);
    restarted.get().center.x = 999;
    assert.equal(restarted.get().center.x, state.center.x, "callers cannot mutate the stored center");
    f.save();
    assert.equal(f.timers.size, 0, "unchanged drawing does not schedule another write");
});

test("encrypted, readonly and published viewports remain only in workspace session memory", () => {
    for (const mode of ["encrypted", "readonly", "publish"]) {
        const f = fixture({[key]: {map: {scale: 2, center: {x: 1, y: 2}}}});
        f.owner.notebookId = mode === "encrypted" ? "encrypted" : "ordinary";
        f.siyuan.config.readonly = mode === "readonly";
        f.siyuan.isPublish = mode === "publish";
        assert.equal(f.get(), undefined, "session-only contexts do not read persistent positions");
        f.save();
        assert.equal(JSON.stringify(f.get()), JSON.stringify(state));
        assert.equal(f.timers.size, 0);
        f.api.flushListMindmapViewports();
        assert.equal(f.writes.length, 0);
        assert.equal((f.siyuan.storage[key] as Record<string, ListMindmapViewport>).map.scale, 2);
        f.siyuan.storage = {};
        assert.equal(f.get(), undefined, "workspace sessions are isolated");
    }
});

test("history, lite editors, embedded maps and missing IDs do not read or overwrite saved positions", () => {
    for (const mode of ["history", "lite", "embedded", "missing-id"]) {
        const f = fixture({[key]: {map: state}});
        f.owner.options.action = mode === "history" ? ["history"] : [];
        f.owner.lite = mode === "lite";
        if (mode === "embedded") {
            f.exclude();
        }
        const id = mode === "missing-id" ? "" : "map";
        assert.equal(f.get(id), undefined);
        f.save(state, id);
        assert.equal(f.timers.size, 0);
    }
});

test("malformed saved viewports are ignored and invalid updates preserve existing data", () => {
    const invalidValues: unknown[] = [null, [], "invalid", {scale: 0, center: state.center},
        {scale: 3, center: state.center}, {scale: 1, center: {x: Infinity, y: 0}},
        {scale: 1, center: {x: 0, y: 1000001}}, {scale: "1", center: state.center}, {scale: 1}];
    for (const invalid of invalidValues) {
        const f = fixture({[key]: {map: invalid}});
        assert.equal(f.get(), undefined);
        f.save(invalid as ListMindmapViewport);
        assert.equal(f.siyuan.storage[key] && (f.siyuan.storage[key] as Record<string, unknown>).map, invalid);
        assert.equal(f.timers.size, 0);
    }
});

test("viewport history is bounded and retains the most recently changed maps", () => {
    const saved = Object.fromEntries(Array.from({length: 1000}, (_, index) => [`map-${index}`, state]));
    const f = fixture({[key]: saved});
    f.save({...state, scale: 2}, "map-0");
    f.save(state, "new");
    assert.equal(f.get("map-1"), undefined);
    assert.equal(f.get("map-0").scale, 2);
    assert.equal(Object.keys(f.siyuan.storage[key]).length, 1000);
    f.api.flushListMindmapViewports();
    assert.equal(f.writes.length, 1);
});
