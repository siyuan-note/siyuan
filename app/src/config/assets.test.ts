import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const createAssets = () => {
    const code = transpileModule(readFileSync("src/config/assets.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    let complete: () => void;
    let fail: (error: Error) => void;
    let loading = new Promise<void>((resolve, reject) => { complete = resolve; fail = reject; });
    let mounted = 0;
    let errors = 0;
    const searched: string[] = [];
    const context = {
        exports: {} as {
            mountAssetsTab: (root: any, keywords: string, app: any) => Promise<void>;
            unmountAssetsTab: (root: any) => void;
            assets: {genHTML: () => string; bindEvent: () => void};
        },
        Lute: undefined as unknown,
        console: {error: () => {}},
        window: {siyuan: {languages: {_kernel: {258: "Operation failed"}}}},
        require: (name: string) => {
            if (name === "../protyle/util/lute") return {ensureLute: () => loading};
            if (name === "../dialog/message") return {showMessage: () => errors++};
            if (name === "./setting/mount") return {switchSettingPanelSubTab: (_root: any, keywords: string) => searched.push(keywords)};
            return {};
        },
    };
    runInNewContext(code + "\nexports.assets = assets;", context);
    context.exports.assets.genHTML = () => "preview";
    context.exports.assets.bindEvent = () => mounted++;
    return {
        api: context.exports, mounted: () => mounted, errors: () => errors, searched,
        complete: () => { context.Lute = {}; complete(); }, fail: () => fail(new Error("network")),
        retry: () => loading = new Promise<void>((resolve, reject) => { complete = resolve; fail = reject; }),
    };
};

test("assets preview waits for Lute and repeated mounts use the latest search", async () => {
    const assets = createAssets();
    const root = {innerHTML: "", isConnected: true};
    const first = assets.api.mountAssetsTab(root, "old", {});
    const second = assets.api.mountAssetsTab(root, "new", {});
    assert.equal(assets.mounted(), 0);
    assert.equal(root.innerHTML, "");
    assets.complete();
    await Promise.all([first, second]);
    assert.equal(assets.mounted(), 1);
    assert.deepEqual(assets.searched, ["new"]);
});

test("closing or replacing an assets panel while Lute loads cancels its preview", async () => {
    for (const action of ["unmount", "detach", "replace"]) {
        const assets = createAssets();
        const root = {innerHTML: "", isConnected: true};
        const pending = assets.api.mountAssetsTab(root, "", {});
        let replacement: Promise<void>;
        if (action === "unmount") assets.api.unmountAssetsTab(root);
        if (action === "detach") root.isConnected = false;
        if (action === "replace") replacement = assets.api.mountAssetsTab({innerHTML: "", isConnected: true}, "", {});
        assets.complete();
        await Promise.all([pending, replacement]);
        assert.equal(root.innerHTML, "");
        assert.equal(assets.mounted(), action === "replace" ? 1 : 0);
    }
});

test("a failed assets dependency reports an error and permits another mount", async () => {
    const assets = createAssets();
    const root = {innerHTML: "", isConnected: true};
    const pending = assets.api.mountAssetsTab(root, "", {});
    assets.fail();
    await pending;
    assert.equal(assets.errors(), 1);
    assert.equal(assets.mounted(), 0);
    assert.equal(root.innerHTML, "");
    assets.retry();
    const retried = assets.api.mountAssetsTab(root, "", {});
    assets.complete();
    await retried;
    assert.equal(assets.mounted(), 1);
});

test("desktop and mobile asset tabs filter loaded filenames immediately and retry failed missing scans", async () => {
    for (const [mobile, type] of [[false, "remove"], [false, "missing"], [true, "remove"], [true, "missing"]] as const) {
        const code = transpileModule(readFileSync("src/config/assets.ts", "utf8"), {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
        }).outputText;
        const requests: {url: string; headers: Record<string, string>; data?: any}[] = [];
        const inputEvents = new Map<string, (event: any) => void>();
        const rendered: any[][] = [];
        const files = [{item: "assets/Cover-20261025.JPG", name: "Cover-20261025.JPG"}, {item: "assets/other.zip", name: "other.zip"}];
        let click: (event: any) => void;
        const classList = {contains: (value: string) => value === "item", add: () => {}, remove: () => {}};
        const preview = {classList, removeAttribute: () => {}};
        const list = {nextElementSibling: preview, addEventListener: () => {}, querySelector: (): null => null};
        const input = {value: "", addEventListener: (name: string, callback: (event: any) => void) => inputEvents.set(name, callback)};
        const attributes = new Map<string, string>();
        const panel = {
            isConnected: true,
            classList,
            getAttribute: (key: string) => key === "data-type" ? type : attributes.get(key),
            setAttribute: (key: string, value: string) => attributes.set(key, value),
            removeAttribute: (key: string) => attributes.delete(key),
            querySelector: (selector: string) => selector === '[data-type="search"]' ? input : list,
        };
        const root = {
            classList,
            querySelector: (selector: string) => selector.includes("config-assets__list") ? list :
                selector === '.config-assets[data-type="remove"]' ? panel : {classList},
            querySelectorAll: () => [panel],
            addEventListener: (_name: string, callback: typeof click) => { click = callback; },
        };
        const context = {
            window: {
                siyuan: {languages: {_kernel: {258: "Operation failed"}}},
            },
            exports: {} as {assets: {element: typeof root; bindEvent: (app: any) => void; disposePreview: () => void; _renderList: (data: any[]) => void}},
            MutationObserver: class {observe() {} disconnect() {}},
            require: (name: string) => {
                if (name === "../util/fetch") return {
                    fetchPost: (url: string, _data: any, _callback: any, headers: Record<string, string>) => {
                        requests.push({url, headers});
                    },
                    fetchSyncPost: async (url: string, data: any, headers: Record<string, string>): Promise<{code: number; data: typeof files | null; msg?: string}> => {
                        requests.push({url, headers: headers || {}, data});
                        if (url === "/api/asset/getUnusedAssets") return {code: 0, data: files};
                        return {code: -1, data: null, msg: "Scan incomplete"};
                    },
                };
                if (name === "../util/escape") return {escapeHtml: (text: string) => text};
                if (name === "../util/fetchAppId") return {SIYUAN_APP_ID_HEADER: "X-SiYuan-App-ID"};
                if (name === "../constants") return {Constants: {SIYUAN_APPID: "this-window"}};
                if (name === "../util/functions") return {isMobile: () => mobile};
                if (name === "./assetPreview") return {AssetPreview: class {clear() {}}};
                if (name === "../protyle") return {Protyle: class {protyle = {};}};
                if (name === "../protyle/util/onGet") return {disabledProtyle: () => {}};
                if (name === "../protyle/ui/initUI") return {removeLoading: () => {}};
                return {};
            },
        };
        runInNewContext(code + "\nexports.assets = assets;", context);
        context.exports.assets._renderList = data => rendered.push(data);
        context.exports.assets.element = root;
        context.exports.assets.bindEvent({appId: "settings-host-window"});
        const event = {
            target: {classList, getAttribute: () => type, isEqualNode: () => false},
            preventDefault: () => {}, stopPropagation: () => {},
        };
        click(event);
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(requests[0].url, "/api/asset/getUnusedAssets");
        assert.equal(requests[0].headers["X-SiYuan-App-ID"], "this-window");
        assert.equal(requests[0].data.all, true);
        if (type === "remove") {
            assert.equal(requests.length, 1);
            click(event);
            await new Promise(resolve => setImmediate(resolve));
            assert.equal(requests.length, 2);
            assert.equal(requests[1].url, "/api/asset/getUnusedAssets");
            assert.equal(requests[1].headers["X-SiYuan-App-ID"], "this-window");
        } else {
            assert.equal(requests[1].url, "/api/asset/getMissingAssets");
            assert.equal(attributes.has("data-init"), false);
            assert.equal(attributes.has("data-loading"), false);
            click(event);
            await new Promise(resolve => setImmediate(resolve));
            assert.equal(requests.length, 3);
            assert.equal(requests[2].url, "/api/asset/getMissingAssets");
        }

        const count = requests.length;
        const renderCount = rendered.length;
        input.value = " Cover-20261025.JPG ";
        inputEvents.get("input")({isComposing: true});
        assert.equal(rendered.length, renderCount);
        assert.equal(requests.length, count);
        inputEvents.get("compositionend")({isComposing: false});
        inputEvents.get("input")({isComposing: false});
        assert.deepEqual(Array.from(rendered.at(-1)), [files[0]]);
        input.value = "missing";
        inputEvents.get("input")({isComposing: false});
        assert.equal(rendered.at(-1).length, 0);
        input.value = "";
        inputEvents.get("input")({isComposing: false});
        assert.deepEqual(Array.from(rendered.at(-1)), files);
        assert.equal(requests.length, count);
        context.exports.assets.disposePreview();
        const disposedCount = rendered.length;
        inputEvents.get("input")({isComposing: false});
        assert.equal(rendered.length, disposedCount);
    }
});

const createUnusedSearch = () => {
    const code = transpileModule(readFileSync("src/config/assets.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const requests: {complete: (response: any) => void; fail: (error: Error) => void; data: any}[] = [];
    const rendered: any[][] = [];
    let cleared = 0;
    let errors = 0;
    const context = {
        exports: {} as {
            createUnusedAssetsSearch: (panel: any, clear: () => void) => {
                load: () => Promise<void>; filter: () => void; more: () => void; remove: (item: string) => void; clear: () => void; dispose: () => void;
            };
            assets: {_renderList: (data: any[]) => void};
        },
        window: {siyuan: {languages: {_kernel: {258: "Operation failed"}}}},
        console: {error: () => {}},
        require: (name: string) => {
            if (name === "../util/fetch") return {
                fetchSyncPost: (_url: string, data: any) => new Promise((complete, fail) => requests.push({complete, fail, data})),
            };
            if (name === "../util/escape") return {escapeHtml: (text: string) => text.replaceAll("<", "&lt;")};
            if (name === "../util/fetchAppId") return {SIYUAN_APP_ID_HEADER: "X-SiYuan-App-ID"};
            if (name === "../constants") return {Constants: {SIYUAN_APPID: "window"}};
            if (name === "../dialog/message") return {showMessage: () => errors++};
            return {};
        },
    };
    runInNewContext(code + "\nexports.createUnusedAssetsSearch = createUnusedAssetsSearch; exports.assets = assets;", context);
    const list = {innerHTML: "old files", insertAdjacentHTML: (_position: string, html: string) => { list.innerHTML += html; }};
    context.exports.assets._renderList = data => { rendered.push(Array.from(data)); list.innerHTML = "rows"; };
    const input = {value: ""};
    const panel = {isConnected: true, querySelector: (selector: string) => selector === '[data-type="search"]' ? input : list};
    const search = context.exports.createUnusedAssetsSearch(panel, () => cleared++);
    return {search, requests, rendered, list, input, panel, errors: () => errors, cleared: () => cleared};
};

test("unused filename search covers the full snapshot, batches display and never refetches on input or deletion", async () => {
    const {search, requests, rendered, list, input} = createUnusedSearch();
    const files = Array.from({length: 1025}, (_, index) => ({item: `assets/file-${index}.zip`, name: `file-${index}.zip`}));
    const target = {item: "assets/Target-20261025.JPG", name: "Target-20261025.JPG"};
    files.push(target, {item: "assets/literal[1]%.zip", name: "literal[1]%.zip"});
    const loading = search.load();
    await search.load();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].data.all, true);
    input.value = " tArGeT-20261025.jpg ";
    search.filter();
    requests[0].complete({code: 0, data: files});
    await loading;
    assert.deepEqual(rendered.at(-1), [target]);
    input.value = "";
    search.filter();
    assert.equal(rendered.at(-1).length, 512);
    assert.match(list.innerHTML, /moreUnusedAssets/);
    search.more();
    assert.equal(rendered.at(-1).length, 1024);
    search.more();
    assert.equal(rendered.at(-1).length, files.length);
    assert.doesNotMatch(list.innerHTML, /moreUnusedAssets/);
    search.remove(files[0].item);
    assert.equal(rendered.at(-1).length, files.length - 1);
    assert.doesNotMatch(list.innerHTML, /moreUnusedAssets/);
    input.value = "[1]%";
    search.filter();
    assert.deepEqual(rendered.at(-1), [files.at(-1)]);
    input.value = "Target";
    search.filter();
    search.remove(target.item);
    assert.deepEqual(rendered.at(-1), []);
    input.value = "";
    search.filter();
    search.more();
    search.more();
    assert.equal(rendered.at(-1).length, files.length - 2);
    assert.equal(rendered.at(-1).some(item => item.item === target.item), false);
    search.clear();
    search.filter();
    assert.deepEqual(rendered.at(-1), []);
    assert.equal(requests.length, 1);
});

test("unused asset snapshots retain scan failures, retry and discard pending data after deletion or disposal", async () => {
    const {search, requests, rendered, list, errors} = createUnusedSearch();
    const keep = {item: "assets/keep.jpg", name: "keep.jpg"};
    const deleted = {item: "assets/deleted.jpg", name: "deleted.jpg"};
    const first = search.load();
    search.remove(deleted.item);
    requests[0].complete({code: 0, data: [keep, deleted]});
    await first;
    assert.deepEqual(rendered.at(-1), [keep]);
    const failed = search.load();
    requests[1].complete({code: -1, msg: "Scan incomplete: <broken.sy>"});
    await failed;
    assert.match(list.innerHTML, /Scan incomplete: &lt;broken.sy>/);
    assert.doesNotMatch(list.innerHTML, /fn__loading|old files/);
    search.filter();
    assert.equal(rendered.length, 1);
    const offline = search.load();
    requests[2].fail(new Error("offline"));
    await offline;
    assert.match(list.innerHTML, /Operation failed/);
    assert.equal(errors(), 1);
    const retried = search.load();
    requests[3].complete({code: 0, data: []});
    await retried;
    assert.deepEqual(rendered.at(-1), []);
    const clearing = search.load();
    search.clear();
    const count = rendered.length;
    requests[4].complete({code: 0, data: [keep]});
    await clearing;
    assert.equal(rendered.length, count);
    const closing = search.load();
    search.dispose();
    requests[5].complete({code: 0, data: [keep]});
    await closing;
    await search.load();
    assert.equal(requests.length, 6);
    assert.equal(rendered.length, count);
    const detached = createUnusedSearch();
    detached.panel.isConnected = false;
    await detached.search.load();
    assert.equal(detached.requests.length, 0);
});

test("missing asset failures replace loading, remain retryable and never render an empty success", async () => {
    const code = transpileModule(readFileSync("src/config/assets.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const rendered: unknown[] = [];
    let complete: (response: any) => void;
    let reject: (error: Error) => void;
    let requests = 0;
    let messages = 0;
    const context = {
        exports: {} as {loadMissingAssets: (panel: any) => Promise<void>; assets: {_renderList: (data: unknown) => void}},
        window: {siyuan: {languages: {_kernel: {258: "Operation failed"}}}},
        console: {error: () => {}},
        require: (name: string) => {
            if (name === "../util/fetch") return {
                fetchSyncPost: (url: string) => {
                    assert.equal(url, "/api/asset/getMissingAssets");
                    requests++;
                    return new Promise((resolve, fail) => { complete = resolve; reject = fail; });
                },
            };
            if (name === "../util/escape") return {escapeHtml: (text: string) => text.replaceAll("<", "&lt;")};
            if (name === "../dialog/message") return {showMessage: () => messages++};
            return {};
        },
    };
    runInNewContext(code + "\nexports.loadMissingAssets = loadMissingAssets; exports.assets = assets;", context);
    context.exports.assets._renderList = data => rendered.push(data);
    const attributes = new Map<string, string>();
    const list = {innerHTML: ""};
    const panel = {
        getAttribute: (key: string) => attributes.get(key),
        setAttribute: (key: string, value: string) => attributes.set(key, value),
        removeAttribute: (key: string) => attributes.delete(key),
        querySelector: () => list,
    };
    const failed = context.exports.loadMissingAssets(panel);
    await context.exports.loadMissingAssets(panel);
    assert.equal(requests, 1);
    complete({code: -1, data: null, msg: "Scan incomplete: <broken.sy>"});
    await failed;
    assert.match(list.innerHTML, /Scan incomplete: &lt;broken.sy>/);
    assert.doesNotMatch(list.innerHTML, /fn__loading/);
    assert.equal(attributes.has("data-init"), false);
    assert.equal(attributes.has("data-loading"), false);
    assert.equal(rendered.length, 0);

    const networkFailure = context.exports.loadMissingAssets(panel);
    reject(new Error("offline"));
    await networkFailure;
    assert.match(list.innerHTML, /Operation failed/);
    assert.equal(messages, 1);
    assert.equal(attributes.has("data-init"), false);

    for (const data of [[], [{item: "assets/missing.png"}]]) {
        const retried = context.exports.loadMissingAssets(panel);
        complete({code: 0, data, msg: ""});
        await retried;
        assert.equal(attributes.get("data-init"), "true");
        assert.equal(attributes.has("data-loading"), false);
        assert.equal(rendered.at(-1), data);
    }
});
