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
            if (name === "./ocr") return {ocrSearchStrings: (): string[] => []};
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

test("desktop and mobile asset tabs identify unused queries and retry failed missing scans", async () => {
    for (const [mobile, type] of [[false, "remove"], [false, "missing"], [true, "remove"], [true, "missing"]] as const) {
        const code = transpileModule(readFileSync("src/config/assets.ts", "utf8"), {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
        }).outputText;
        const requests: {url: string; headers: Record<string, string>}[] = [];
        let click: (event: any) => void;
        const classList = {contains: (value: string) => value === "item", add: () => {}, remove: () => {}};
        const preview = {classList, removeAttribute: () => {}};
        const list = {nextElementSibling: preview, addEventListener: () => {}, querySelector: (): null => null};
        const attributes = new Map<string, string>();
        const panel = {
            classList,
            getAttribute: (key: string) => key === "data-type" ? type : attributes.get(key),
            setAttribute: (key: string, value: string) => attributes.set(key, value),
            removeAttribute: (key: string) => attributes.delete(key),
            querySelector: () => list,
        };
        const root = {
            classList,
            querySelector: (selector: string) => selector.includes("config-assets__list") ? list : {classList},
            querySelectorAll: () => [panel],
            addEventListener: (_name: string, callback: typeof click) => { click = callback; },
        };
        const context = {
            exports: {} as {assets: {element: typeof root; bindEvent: (app: any) => void}},
            MutationObserver: class {observe() {} disconnect() {}},
            require: (name: string) => {
                if (name === "../util/fetch") return {
                    fetchPost: (url: string, _data: any, _callback: any, headers: Record<string, string>) => {
                        requests.push({url, headers});
                    },
                    fetchSyncPost: async (url: string): Promise<{code: number; data: null; msg: string}> => {
                        requests.push({url, headers: {}});
                        return {code: -1, data: null, msg: "Scan incomplete"};
                    },
                };
                if (name === "../util/escape") return {escapeHtml: (text: string) => text};
                if (name === "../util/fetchAppId") return {SIYUAN_APP_ID_HEADER: "X-SiYuan-App-ID"};
                if (name === "../constants") return {Constants: {SIYUAN_APPID: "this-window"}};
                if (name === "../util/functions") return {isMobile: () => mobile};
                if (name === "./ocr") return {mountOCRSettings: () => {}};
                if (name === "./assetPreview") return {AssetPreview: class {clear() {}}};
                if (name === "../protyle") return {Protyle: class {protyle = {};}};
                if (name === "../protyle/util/onGet") return {disabledProtyle: () => {}};
                if (name === "../protyle/ui/initUI") return {removeLoading: () => {}};
                return {};
            },
        };
        runInNewContext(code + "\nexports.assets = assets;", context);
        context.exports.assets.element = root;
        context.exports.assets.bindEvent({appId: "settings-host-window"});
        const event = {
            target: {classList, getAttribute: () => type, isEqualNode: () => false},
            preventDefault: () => {}, stopPropagation: () => {},
        };
        click(event);
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(requests.length, 2);
        assert.equal(requests[0].url, "/api/asset/getUnusedAssets");
        assert.equal(requests[0].headers["X-SiYuan-App-ID"], "this-window");
        if (type === "remove") {
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
    }
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
