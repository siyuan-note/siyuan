import * as assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";
import {isPluginSnapshotPath} from "./pluginSnapshotPaths";

class ElementStub {
    children: ElementStub[] = [];
    listeners: Record<string, (...args: any[]) => void> = {};
    nodes: Record<string, ElementStub> = {};
    disabled = false;
    value = "";
    textContent = "";
    className = "";
    type = "";
    dataset: Record<string, string> = {};
    isConnected = true;
    innerHTML = "";
    classList = {add() {}, remove() {}, contains: () => false};
    constructor(public tag = "div") {}
    append(...items: ElementStub[]) { this.children.push(...items); }
    replaceChildren() { this.children = []; }
    addEventListener(type: string, callback: (...args: any[]) => void) { this.listeners[type] = callback; }
    querySelector(selector: string): ElementStub { return this.nodes[selector]; }
    querySelectorAll(selector: string): ElementStub[] {
        const descendants = this.children.flatMap(child => [child, ...child.querySelectorAll("*")]);
        return selector === "*" ? descendants : descendants.filter(child => selector.includes(child.tag));
    }
}

test("plugin snapshot previews separate program and data by exact package directory", () => {
    for (const prefix of ["", "/"]) {
        const program = prefix + "plugins/example/index.js";
        const data = prefix + "storage/petal/example/data.json";
        assert.equal(isPluginSnapshotPath(program, "example"), true);
        assert.equal(isPluginSnapshotPath(data, "example"), true);
        assert.equal(isPluginSnapshotPath(program, "example", "program"), true);
        assert.equal(isPluginSnapshotPath(data, "example", "data"), true);
        assert.equal(isPluginSnapshotPath(program, "example", "data"), false);
        assert.equal(isPluginSnapshotPath(data, "example", "program"), false);
        for (const part of [undefined, "program", "data"] as const) {
            for (const path of ["plugins/example-other/index.js", "storage/petal/example-other/data.json", "storage/petal/petals.json", "assets/example.png"]) {
                assert.equal(isPluginSnapshotPath(prefix + path, "example", part), false);
            }
        }
    }
});

const setup = () => {
    const root = new ElementStub();
    const form = new ElementStub("form");
    const input = new ElementStub("input");
    const submit = new ElementStub("button");
    form.nodes.input = input;
    form.append(input, submit);
    const list = new ElementStub("ul");
    const result = new ElementStub();
    const previous = new ElementStub("button");
    const next = new ElementStub("button");
    root.nodes = {"[data-plugin-search]": form, "[data-plugin-list]": list, "[data-plugin-result]": result,
        '[data-plugin-page="previous"]': previous, '[data-plugin-page="next"]': next};
    for (const key of ["[data-plugin-select]", "[data-plugin-back]", "[data-plugin-detail-title]", ".history__plugin-detail", ".history__plugin-detail-content"]) {
        root.nodes[key] = new ElementStub();
    }
    let confirm: () => Promise<boolean>;
    let releaseUnload: () => void;
    let delayUnload = false;
    const calls: Array<{url: string, body?: any}> = [];
    const opened: unknown[][] = [];
    const snapshot = {id: "a".repeat(40), created: 1000, memo: "<img onerror=alert(1)>",
        program: {count: 1, size: 100}, data: {count: 2, size: 200}};
    const app = {appId: "app", plugins: [{name: "example"}]};
    const exports: typeof import("./pluginSnapshots") = {} as any;
    const languages = {pluginSnapshotOpenData: "Open data", pluginSnapshotOpenProgram: "Open program", rollback: "Rollback", pluginSnapshotRestoreTip: "Restore ${name}", pluginSnapshotRestored: "Backup ${id}",
        pageCountAndSnapshotCount: "${x} pages ${y} snapshots", pluginSnapshotStats: "${programCount}/${programSize}/${dataCount}/${dataSize}"};
    const config = {readonly: false};
    runInNewContext(transpileModule(readFileSync(join(__dirname, "pluginSnapshots.ts"), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText, {exports, AbortController, document: {createElement: (tag: string) => new ElementStub(tag)},
        window: {siyuan: {languages, config}},
        require: (module: string) => {
            if (module.endsWith("mobileConfirmDialog")) return {mobileConfirmDialog: (_title: string, _tip: string, callback: typeof confirm) => { confirm = callback; }};
            if (module.endsWith("/fetch")) return {fetchSyncPost: async (url: string, body: unknown) => {
                calls.push({url, body});
                return {code: 0, data: url.endsWith("getPluginSnapshots") ?
                    {snapshots: [snapshot], pageCount: 2, totalCount: 33} : {backupID: "backup"}};
            }};
            if (module.endsWith("/loader")) return {unloadPlugin: async () => {
                calls.push({url: "unload"});
                if (delayUnload) await new Promise<void>(resolve => { releaseUnload = resolve; });
            }};
            if (module.endsWith("/escape")) return {escapeHtml: (text: string) => text};
            if (module === "dayjs") return require("dayjs");
            if (module === "filesize") return require("filesize");
            if (module === "./pluginSnapshotSelect") return {createPluginSnapshotSelect: () => ({input, close() {}, canSubmit: () => true, destroy() {}})};
            if (module === "./snapshotDetail") return {mountSnapshotDetail: (...args: unknown[]) => { opened.push(args); return {destroy() {}}; }};
            return {};
        }});
    const panel = exports.mountPluginSnapshots(app as any, root as any, () => {});
    const flush = () => new Promise<void>(resolve => setImmediate(resolve));
    return {root, input, list, result, previous, next, calls, opened, app, snapshot, flush, panel, config,
        search: async () => { input.value = " example "; form.listeners.submit({preventDefault() {}}); await flush(); },
        confirm: () => confirm(),
        delayUnload: () => { delayUnload = true; }, release: () => releaseUnload(),
        restore: () => list.children[0].children.at(-1).children.at(-1).listeners.click(),
    };
};

test("plugin snapshots search exact package names and render metadata as text", async () => {
    const state = setup();
    await state.search();
    assert.equal(state.calls[0].body.name, "example");
    assert.equal(state.calls[0].body.page, 1);
    assert.equal(state.result.textContent, "2 pages 33 snapshots");
    assert.equal(state.list.children[0].children[1].textContent, "1/100 B/2/200 B");
    assert.equal(state.list.children[0].children[2].textContent, state.snapshot.memo);
    assert.equal(state.list.children[0].className, "history__association");
    assert.match(state.root.innerHTML, /class="history__plugin-list" data-plugin-list/);
    assert.match(state.root.innerHTML, /class="history__plugin-pagination"/);
    const actions = state.list.children[0].children.at(-1);
    assert.equal(actions.className, "fn__flex history__repo-actions");
    assert.equal(actions.children[0].textContent, "Open data");
    assert.equal(actions.children[1].textContent, "Open program");
    assert.equal(actions.children[2].textContent, "Rollback");
    actions.children[0].listeners.click();
    assert.equal(state.opened.length, 1);
    assert.equal((state.opened[0][2] as {id: string}).id, state.snapshot.id);
    assert.deepEqual(JSON.parse(JSON.stringify(state.opened[0][4])), {plugin: {name: "example", part: "data"}});
    assert.equal(state.previous.disabled, true);
    assert.equal(state.next.disabled, false);
    state.next.listeners.click();
    await state.flush();
    assert.equal(state.calls[1].body.page, 2);
    assert.equal(state.next.disabled, true);
    assert.equal(state.previous.disabled, false);
    state.previous.listeners.click();
    await state.flush();
    assert.equal(state.calls[2].body.page, 1);
    assert.equal(state.previous.disabled, true);
    assert.equal(state.next.disabled, false);
});

test("plugin restore waits for confirmation and unload before replacing files, then stays disabled", async () => {
    const state = setup();
    await state.search();
    state.delayUnload();
    state.restore();
    assert.equal(state.calls.length, 1);
    const pending = state.confirm();
    await state.flush();
    assert.deepEqual(state.calls.map(call => call.url), ["/api/repo/getPluginSnapshots", "/api/petal/setPetalEnabled", "unload"]);
    assert.equal(state.calls[1].body.enabled, false);
    assert.equal(state.panel.canClose(), false);
    state.release();
    assert.equal(await pending, true);
    assert.equal(state.calls.at(-1).url, "/api/repo/restorePluginSnapshot");
    assert.equal(state.calls.at(-1).body.id, state.snapshot.id);
    assert.equal(state.result.textContent, "Backup backup");
    assert.equal(state.panel.canClose(), true);
    assert.equal(state.next.disabled, false);
    assert.equal(state.calls.filter(call => call.body?.enabled === true).length, 0);
});

test("closing the parent before confirmation prevents restoration", async () => {
    const state = setup();
    await state.search();
    state.restore();
    state.panel.destroy();
    assert.equal(await state.confirm(), false);
    assert.equal(state.calls.length, 1);
});

test("closing the owner while a plugin unloads prevents replacing its files", async () => {
    const state = setup();
    await state.search();
    state.delayUnload();
    state.restore();
    const pending = state.confirm();
    await state.flush();
    state.panel.destroy();
    state.release();
    assert.equal(await pending, false);
    assert.equal(state.calls.some(call => call.url.endsWith("restorePluginSnapshot")), false);
});

test("read-only plugin snapshots retain previews and reject restoration", async () => {
    const state = setup();
    state.config.readonly = true;
    await state.search();
    const actions = state.list.children[0].children.at(-1).children;
    assert.equal(actions[0].disabled, false);
    assert.equal(actions[1].disabled, false);
    assert.equal(actions[2].disabled, true);
    actions[1].listeners.click();
    assert.deepEqual(JSON.parse(JSON.stringify(state.opened[0][4])), {plugin: {name: "example", part: "program"}});
    state.restore();
    assert.equal(state.calls.length, 1);
});
