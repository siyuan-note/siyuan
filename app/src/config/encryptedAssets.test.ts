import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {parseFragment, type DefaultTreeAdapterMap} from "parse5";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {escapeHtml, escapeHtmlTextAndAttr} from "../util/escape";

const compiled = transpileModule(readFileSync("src/config/encryptedAssets.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

type Child = DefaultTreeAdapterMap["childNode"];
type Element = DefaultTreeAdapterMap["element"];

const isElement = (node: Child): node is Element => "tagName" in node;

// 与浏览器一致的片段解析：属性名大小写、实体解码后再断言，避免只比较转义后的字符串。
const parseRows = (html: string) => parseFragment(html).childNodes.filter(isElement)
    .filter(row => row.tagName === "div")
    .map(row => {
        const input = row.childNodes.filter(isElement).find(node => node.tagName === "input");
        const button = row.childNodes.filter(isElement).find(node => node.tagName === "button");
        return {
            attributes: input.attrs.filter(attr => !attr.namespace),
            buttonText: button.childNodes.map(node => "value" in node ? node.value : "").join(""),
        };
    });

const attribute = (attributes: Element["attrs"], name: string) =>
    attributes.find(attr => attr.name === name)?.value;

class Control {
    checked = false;
    indeterminate = false;
    disabled = false;
    textContent = "";
    dataset: Record<string, string> = {};
    classList = {add: () => {}, remove: () => {}};
    listeners = new Map<string, (event?: unknown) => unknown>();
    inputs: Control[] = [];
    html = "";
    set innerHTML(html: string) {
        this.html = html;
        this.inputs = Array.from(html.matchAll(/data-index="(\d+)"/g), match => {
            const input = new Control();
            input.dataset.index = match[1];
            return input;
        });
    }
    querySelectorAll() { return this.inputs; }
    closest() { return this; }
    addEventListener(name: string, handler: (event?: unknown) => unknown) { this.listeners.set(name, handler); }
    dispatch(name: string, event?: unknown) { return this.listeners.get(name)?.(event); }
}

const fixtures = [
    {item: "assets/a.png", name: "<private name>.png"},
    {item: "assets/b.png", name: "private-b.png"},
    {item: "assets/c.png", name: '资料 "终稿" & <附图>.png'},
    {item: "assets/d.png", name: 'report.png" autofocus onfocus="void 0" x=".png'},
].map(({item, name}) => ({item, name, path: `${item}?box=secret`}));

const setup = (mobile = false) => {
    const controls = Object.fromEntries(["list", "all", "delete", "refresh", "preview", "cancel", "count"]
        .map(key => [key, new Control()]));
    const pending: Promise<unknown>[] = [];
    const requests: Array<{url: string, data: {notebook: string, paths?: string[]}}> = [];
    const callbacks: Array<() => void> = [];
    let current: {element: {isConnected: boolean, dataset: Record<string, string>}, destroy: () => void};
    let response = {code: 0, data: fixtures};
    let releaseScan: (() => void) | undefined;
    let delay = false;
    let maintenanceFailure = false;
    let previewClears = 0;
    const previews: string[][] = [];
    const siyuan = {config: {readonly: false}, notebooks: [{id: "secret", encrypted: true, closed: false}],
        languages: {loading: "Loading", emptyContent: "Empty", clearAll: "Confirm cleanup"}};
    const exports = {} as typeof import("./encryptedAssets");
    const dependencies = {
        AdaptiveDialog: class {
            element = {isConnected: true, dataset: {} as Record<string, string>,
                querySelector: (selector: string) => controls[selector.match(/data-type="([^"]+)"/)[1]]};
            constructor(private options: {destroyCallback: () => void}) {
                current = {element: this.element, destroy: () => this.destroy()};
            }
            destroy() {
                this.element.dataset.dialogClosing = "true";
                this.element.isConnected = false;
                this.options.destroyCallback();
            }
        },
        AssetPreview: class {
            clear() { previewClears++; }
            show(...args: string[]) { previews.push(args); }
        },
        fetchSyncPost: async (url: string, data: typeof requests[number]["data"]) => {
            requests.push({url, data});
            if (delay) {
                await new Promise<void>(resolve => { releaseScan = resolve; });
            }
            return response;
        },
        confirmDialog: ({confirm}: {confirm: () => void}) => { callbacks.push(confirm); },
        showMessage: () => {},
        trackNotebookHistoryDialog: () => {},
        forgetNotebookHistoryDialog: () => {},
        escapeHtml,
        escapeHtmlTextAndAttr,
        getNotebookName: () => "Private notebook",
        isMobile: () => mobile,
        runSettingsMaintenance: (action: () => Promise<unknown>) => {
            const task = maintenanceFailure ? Promise.resolve() : action();
            pending.push(task);
            return task;
        },
    };
    runInNewContext(compiled, {exports, require: () => dependencies,
        window: {siyuan}});
    return {
        controls, requests, callbacks, previews, siyuan,
        canClean: () => exports.canCleanEncryptedNotebookAssets("secret"),
        open: () => exports.openEncryptedAssetsCleanup("secret"),
        settle: async () => { await Promise.all(pending); await new Promise(resolve => setImmediate(resolve)); },
        close: () => current.destroy(),
        delay: () => { delay = true; },
        release: () => { delay = false; releaseScan?.(); },
        fail: () => { response = {code: -1, data: []}; },
        failMaintenance: (fail: boolean) => { maintenanceFailure = fail; },
        previewClears: () => previewClears,
    };
};

const previewTarget = (index: number) => {
    const row = {dataset: {index: String(index)}};
    const target = {closest: (selector: string) => selector === "[data-index]" ? row : target};
    return target;
};

for (const mobile of [false, true]) {
    test(`${mobile ? "mobile" : "desktop"} cleanup previews and deletes only explicitly confirmed selections`, async () => {
        const state = setup(mobile);
        state.open();
        await state.settle();
        assert.equal(state.requests.length, 1);
        assert.equal(state.requests[0].data.notebook, "secret");
        const rows = parseRows(state.controls.list.html);
        assert.equal(rows.length, fixtures.length);
        rows.forEach((row, index) => {
            assert.deepEqual(row.attributes.map(attr => attr.name).sort(), ["aria-label", "class", "type"]);
            assert.equal(attribute(row.attributes, "aria-label"), fixtures[index].name);
            assert.equal(row.buttonText, fixtures[index].name);
        });
        assert.ok(state.controls.list.html.includes("&quot;"));
        assert.ok(state.controls.list.html.includes("&lt;private name>.png"));
        assert.equal(state.controls.delete.disabled, true);
        state.controls.list.dispatch("click", {target: previewTarget(2)});
        assert.deepEqual(state.previews.at(-1), ["assets/c.png?box=secret", "secret/assets/c.png"]);
        state.controls.list.inputs[1].checked = true;
        state.controls.list.dispatch("change");
        assert.equal(state.controls.delete.disabled, false);
        state.controls.delete.dispatch("click");
        assert.equal(state.requests.length, 1);
        assert.equal(state.callbacks.length, 1);
        state.callbacks[0]();
        await state.settle();
        const deletion = state.requests.find(request => request.url.endsWith("removeUnusedEncryptedBoxAssets"));
        assert.deepEqual(JSON.parse(JSON.stringify(deletion.data)), {notebook: "secret", paths: ["assets/b.png"]});
        assert.equal(state.requests.filter(request => request.url.endsWith("getUnusedEncryptedBoxAssets")).length, 2);
        state.close();
        assert.ok(state.previewClears() >= 2);
    });
}

test("maintenance preparation failure releases cleanup controls and permits retry", async () => {
    const state = setup();
    state.open();
    await state.settle();
    state.controls.all.checked = true;
    state.controls.all.dispatch("change");
    state.controls.delete.dispatch("click");
    state.failMaintenance(true);
    state.callbacks[0]();
    await state.settle();
    assert.equal(state.requests.some(request => request.url.endsWith("removeUnusedEncryptedBoxAssets")), false);
    assert.equal(state.controls.refresh.disabled, false);
    state.failMaintenance(false);
    state.controls.all.checked = true;
    state.controls.all.dispatch("change");
    state.controls.delete.dispatch("click");
    state.callbacks[1]();
    await state.settle();
    assert.equal(state.requests.filter(request => request.url.endsWith("removeUnusedEncryptedBoxAssets")).length, 1);
    assert.equal(state.controls.refresh.disabled, false);
});

test("closing during a scan prevents publishing late decrypted filenames", async () => {
    const state = setup();
    state.delay();
    state.open();
    state.close();
    state.release();
    await state.settle();
    assert.equal(state.controls.list.html, "");
    assert.equal(state.requests.length, 1);
});

test("a confirmation cannot delete after the notebook dialog closes", async () => {
    const state = setup();
    state.open();
    await state.settle();
    state.controls.all.checked = true;
    state.controls.all.dispatch("change");
    state.controls.delete.dispatch("click");
    state.close();
    state.callbacks[0]();
    await state.settle();
    assert.equal(state.requests.length, 1);
});

test("cleanup is available only for an unlocked encrypted notebook in a writable workspace", () => {
    const state = setup();
    assert.equal(state.canClean(), true);
    state.siyuan.notebooks[0].closed = true;
    assert.equal(state.canClean(), false);
    state.open();
    assert.equal(state.requests.length, 0);
    state.siyuan.notebooks[0].closed = false;
    state.siyuan.notebooks[0].encrypted = false;
    assert.equal(state.canClean(), false);
    state.siyuan.notebooks[0].encrypted = true;
    state.siyuan.config.readonly = true;
    assert.equal(state.canClean(), false);
});
