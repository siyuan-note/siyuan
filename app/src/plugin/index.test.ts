import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import * as path from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {ContractFormData} from "../util/contractFormData";
import * as mergePathSegments from "../util/mergePathSegments";

const compile = (file: string, flags: {MOBILE: boolean; BROWSER: boolean}) => transpileModule(require("ifdef-loader/preprocessor").parse(
    readFileSync(file, "utf8"), flags, false, true), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const loadPlugin = (flags = {MOBILE: false, BROWSER: false}) => {
    const requests: Array<{url: string; data: unknown}> = [];
    const window = {siyuan: {config: {readonly: false}, isPublish: false, languages: {}}};
    const pathName = {};
    runInNewContext(compile("src/util/pathName.ts", flags), {exports: pathName, window,
        require: (id: string) => id === "path" ? path : id === "./mergePathSegments" ? mergePathSegments : {}});
    const exports: Record<string, any> = {};
    runInNewContext(compile("src/plugin/index.ts", flags), {exports, window, Promise, File, Blob,
        require: (id: string) => id === "../util/pathName" ? pathName :
            id === "../util/contractFormData" ? {ContractFormData} :
            id === "./toolbarItem" ? {clearPluginToolbarItems: () => {}} :
            id === "../constants" ? {Constants: {SIYUAN_APPID: "app"}} : id === "../util/fetch" ? {
            fetchPost: (url: string, data: unknown, callback: (response: unknown) => void) => {
                requests.push({url, data});
                callback({code: 0, msg: "", data: null});
            },
        } : {}});
    const plugin = Object.create(exports.Plugin.prototype);
    Object.assign(plugin, {name: "sample", data: {}});
    return {plugin, requests, window, dispose: () => exports.markPluginDisposed(plugin)};
};

test("plugin storage rejects names without a file segment before sending requests", async () => {
    for (const storageName of ["..", "../", "..\\", "./..", ".", "", "/"]) {
        const {plugin, requests} = loadPlugin();
        for (const call of [() => plugin.loadData(storageName), () => plugin.saveData(storageName, "value"),
            () => plugin.removeData(storageName)]) {
            await assert.rejects(call(), {code: 400, msg: "Invalid storage name", data: null}, JSON.stringify(storageName));
        }
        assert.deepEqual(requests, [], JSON.stringify(storageName));
        assert.deepEqual(Object.keys(plugin.data), [], JSON.stringify(storageName));
    }
});

test("plugin storage keeps normalized subdirectory names inside the plugin directory", async () => {
    const {plugin, requests} = loadPlugin();
    await plugin.loadData("../folder/config.json");
    await plugin.removeData("folder\\config.json");
    assert.deepEqual(requests.map(request => (request.data as {path: string}).path), [
        "/data/storage/petal/sample/folder/config.json",
        "/data/storage/petal/sample/folder/config.json",
    ]);
});

for (const {name, flags} of [
    {name: "desktop", flags: {MOBILE: false, BROWSER: false}},
    {name: "browser", flags: {MOBILE: false, BROWSER: true}},
    {name: "mobile", flags: {MOBILE: true, BROWSER: true}},
]) {
    test(`plugin storage uploads normalized JSON and text files with original cache keys (${name})`, async () => {
        const {plugin, requests} = loadPlugin(flags);
        const cases = [
            {storageName: "a/../folder\\config.json", data: {enabled: true}, fileName: "config.json"},
            {storageName: "../folder/text.txt", data: "plain text", fileName: "text.txt"},
        ];
        for (const {storageName, data, fileName} of cases) {
            const response = await plugin.saveData(storageName, data);
            assert.deepEqual(response, {code: 0, msg: "", data: null});
            const request = requests.at(-1);
            assert.equal(request.url, "/api/file/putFile");
            assert.ok(request.data instanceof ContractFormData);
            assert.equal(request.data.get("path"), `/data/storage/petal/sample/folder/${fileName}`);
            assert.equal(request.data.get("isDir"), "false");
            assert.equal(request.data.get("app"), "app");
            const file = request.data.get("file");
            assert.ok(file instanceof File);
            assert.equal(file.name, fileName);
            assert.equal(await file.text(), typeof data === "object" ? JSON.stringify(data) : data);
            assert.equal(plugin.data[storageName], data);
            assert.equal(Object.hasOwn(plugin.data, `folder/${fileName}`), false);
        }
        assert.equal(requests.length, cases.length);
    });

    test(`plugin storage preserves cache and checks lifecycle before session and storage name (${name})`, async () => {
        const {plugin, requests, window, dispose} = loadPlugin(flags);
        const invalidName = "..";
        plugin.data[invalidName] = "keep cached value";
        const unserializable = {toJSON: () => { throw new Error("must not serialize invalid storage data"); }};
        const calls = [
            {method: "loadData", call: () => plugin.loadData(invalidName)},
            {method: "saveData", call: () => plugin.saveData(invalidName, unserializable)},
            {method: "removeData", call: () => plugin.removeData(invalidName)},
        ];
        for (const {call} of calls) {
            await assert.rejects(call(), {code: 400, msg: "Invalid storage name", data: null});
        }
        for (const session of [
            {readonly: true, publish: false},
            {readonly: false, publish: true},
            {readonly: true, publish: true},
        ]) {
            window.siyuan.config.readonly = session.readonly;
            window.siyuan.isPublish = session.publish;
            for (const {method, call} of calls) {
                await assert.rejects(call(), method === "loadData" ?
                    {code: 400, msg: "Invalid storage name", data: null} :
                    {code: 403, msg: "Readonly mode or publish mode", data: null});
            }
        }
        dispose();
        for (const {call} of calls) {
            await assert.rejects(call(), {code: 410, msg: "Plugin lifecycle has ended", data: null});
        }
        assert.deepEqual(requests, []);
        assert.deepEqual(plugin.data, {[invalidName]: "keep cached value"});
    });
}
