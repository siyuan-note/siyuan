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

test("plugin snapshot file previews retain both exact package directories and exclude other data", () => {
    for (const prefix of ["", "/"]) {
        assert.equal(isPluginSnapshotPath(prefix + "plugins/example/index.js", "example"), true);
        assert.equal(isPluginSnapshotPath(prefix + "storage/petal/example/data.json", "example"), true);
        for (const path of ["plugins/example-other/index.js", "storage/petal/example-other/data.json", "storage/petal/petals.json", "assets/example.png"]) {
            assert.equal(isPluginSnapshotPath(prefix + path, "example"), false);
        }
    }
});

const setup = (mobile = false) => {
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
    let options: any;
    let confirm: () => Promise<boolean>;
    let releaseUnload: () => void;
    let delayUnload = false;
    const calls: Array<{url: string, body?: any}> = [];
    const snapshot = {id: "a".repeat(40), created: 1000, memo: "<img onerror=alert(1)>",
        program: {count: 1, size: 100}, data: {count: 2, size: 200}};
    const app = {appId: "app", plugins: [{name: "example"}]};
    const exports: typeof import("./pluginSnapshots") = {} as any;
    const languages = {pluginSnapshotRestoreTip: "Restore ${name}", pluginSnapshotRestored: "Backup ${id}",
        pageCountAndSnapshotCount: "${x} pages ${y} snapshots", pluginSnapshotStats: "${programCount}/${programSize}/${dataCount}/${dataSize}"};
    runInNewContext(transpileModule(readFileSync(join(__dirname, "pluginSnapshots.ts"), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText, {exports, document: {createElement: (tag: string) => new ElementStub(tag)},
        window: {siyuan: {languages, config: {readonly: false}}},
        require: (module: string) => {
            if (module === "../dialog") return {Dialog: class {element = root; constructor(value: unknown) { options = value; }}};
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
            if (module.endsWith("/functions")) return {isMobile: () => mobile};
            if (module === "dayjs") return require("dayjs");
            return {};
        }});
    exports.openPluginSnapshots(app as any);
    const flush = () => new Promise<void>(resolve => setImmediate(resolve));
    return {root, input, list, result, next, calls, app, snapshot, flush,
        get options() { return options; },
        search: async () => { input.value = " example "; form.listeners.submit({preventDefault() {}}); await flush(); },
        confirm: () => confirm(),
        delayUnload: () => { delayUnload = true; }, release: () => releaseUnload(),
        restore: () => list.children[0].children.at(-1).listeners.click(),
    };
};

for (const mobile of [false, true]) {
    test(`${mobile ? "mobile" : "desktop"} plugin snapshots search exact package names and render metadata as text`, async () => {
        const state = setup(mobile);
        await state.search();
        assert.equal(state.calls[0].body.name, "example");
        assert.equal(state.calls[0].body.page, 1);
        assert.equal(state.result.textContent, "2 pages 33 snapshots");
        assert.equal(state.list.children[0].children[1].textContent, "1/100/2/200");
        assert.equal(state.list.children[0].children[2].textContent, state.snapshot.memo);
        assert.equal(state.next.disabled, false);
        state.next.listeners.click();
        await state.flush();
        assert.equal(state.calls[1].body.page, 2);
    });
}

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
    assert.equal(state.options.beforeClose(), false);
    state.release();
    assert.equal(await pending, true);
    assert.equal(state.calls.at(-1).url, "/api/repo/restorePluginSnapshot");
    assert.equal(state.calls.at(-1).body.id, state.snapshot.id);
    assert.equal(state.result.textContent, "Backup backup");
    assert.equal(state.options.beforeClose(), true);
    assert.equal(state.next.disabled, false);
    assert.equal(state.calls.filter(call => call.body?.enabled === true).length, 0);
});

test("closing the parent before confirmation prevents restoration", async () => {
    const state = setup();
    await state.search();
    state.restore();
    state.options.destroyCallback();
    assert.equal(await state.confirm(), false);
    assert.equal(state.calls.length, 1);
});
