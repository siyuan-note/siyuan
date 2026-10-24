import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import * as path from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import * as mergePathSegments from "../util/mergePathSegments";

const compile = (file: string) => transpileModule(require("ifdef-loader/preprocessor").parse(
    readFileSync(file, "utf8"), {MOBILE: false, BROWSER: false}, false, true), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const loadPlugin = () => {
    const requests: Array<{url: string; data: unknown}> = [];
    const window = {siyuan: {config: {readonly: false}, isPublish: false, languages: {}}};
    const pathName = {};
    runInNewContext(compile("src/util/pathName.ts"), {exports: pathName, window,
        require: (id: string) => id === "path" ? path : id === "./mergePathSegments" ? mergePathSegments : {}});
    const exports: Record<string, any> = {};
    runInNewContext(compile("src/plugin/index.ts"), {exports, window, Promise,
        require: (id: string) => id === "../util/pathName" ? pathName :
            id === "../constants" ? {Constants: {SIYUAN_APPID: "app"}} : id === "../util/fetch" ? {
            fetchPost: (url: string, data: unknown, callback: (response: unknown) => void) => {
                requests.push({url, data});
                callback({code: 0, msg: "", data: null});
            },
        } : {}});
    const plugin = Object.create(exports.Plugin.prototype);
    Object.assign(plugin, {name: "sample", data: {}});
    return {plugin, requests};
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
