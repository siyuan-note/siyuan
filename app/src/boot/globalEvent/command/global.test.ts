import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import * as path from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import * as escape from "../../../util/escape";
import * as mergePathSegments from "../../../util/mergePathSegments";

type Flags = {MOBILE: boolean; BROWSER: boolean};

const compile = (file: string, flags: Flags) => transpileModule(require("ifdef-loader/preprocessor").parse(
    readFileSync(file, "utf8"), flags, false, true), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const reopenClosedAsset = (flags: Flags, assetPath: string) => {
    const requests: Array<{url: string; data: {path: string}}> = [];
    const opened: Array<{assetPath: string; page: unknown}> = [];
    const window = {siyuan: {storage: {} as Record<string, unknown[]>}};
    const recorder = new Proxy({}, {get: (_target, name) => name === "__esModule" ? undefined : (): undefined => undefined});
    const load = (file: string, modules: Record<string, unknown> = {}) => {
        const exports: Record<string, any> = {};
        runInNewContext(compile(file, flags), {exports, window, navigator: {userAgent: ""},
            SIYUAN_VERSION: "dev", NODE_ENV: "development",
            require: (id: string) => modules[id] ?? (id === "path" ? path : recorder)});
        return exports;
    };
    const pathName = load("src/util/pathName.ts", {"./mergePathSegments": mergePathSegments, "./escape": escape});
    const constants = load("src/constants.ts");
    const global = load("src/boot/globalEvent/command/global.ts", {
        "../../../util/pathName": pathName,
        "../../../constants": constants,
        "../../../protyle/util/compatibility": {sanitizeClosedTabs: (tabs: unknown[]) => tabs, setStorageVal() {}},
        "../../../editor/util": {openFile: (options: {assetPath: string; page: unknown}) => opened.push(options)},
        "../../../util/fetch": {
            fetchPost: (url: string, data: {path: string}, callback: (response: {code: number}) => void) => {
                requests.push({url, data});
                callback({code: 0});
            },
        },
    });
    window.siyuan.storage[constants.Constants.LOCAL_CLOSED_TABS] = [{children: {instance: "Asset", path: assetPath, page: 3}}];
    assert.equal(global.globalCommand("recentClosed", {}), true);
    return {requests, opened};
};

for (const {name, flags} of [
    {name: "desktop", flags: {MOBILE: false, BROWSER: false}},
    {name: "browser", flags: {MOBILE: false, BROWSER: true}},
]) {
    test(`reopening a closed asset tab checks the file without its URL fragment (${name})`, () => {
        for (const [assetPath, statPath] of [
            ["assets/image.png", "assets/image.png"],
            ["assets/video.mp4#t=10", "assets/video.mp4"],
            ["assets/image.png?box=20260101000000-abcdefg#preview", "assets/image.png?box=20260101000000-abcdefg"],
        ]) {
            const {requests, opened} = reopenClosedAsset(flags, assetPath);
            assert.deepEqual(requests.map(request => [request.url, request.data.path]), [["/api/asset/statAsset", statPath]], assetPath);
            // 重新打开时仍使用原始路径，保留媒体片段
            assert.deepEqual(opened.map(options => [options.assetPath, options.page]), [[assetPath, 3]], assetPath);
        }
    });
}
