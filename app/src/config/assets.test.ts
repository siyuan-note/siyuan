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
