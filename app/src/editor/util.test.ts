import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import * as path from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import * as escape from "../util/escape";
import * as mergePathSegments from "../util/mergePathSegments";

const compile = (file: string) => transpileModule(require("ifdef-loader/preprocessor").parse(
    readFileSync(file, "utf8"), {MOBILE: false, BROWSER: false}, false, true), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const loadOpenBy = () => {
    const calls: Array<{name: string; args: unknown[]}> = [];
    const window = {siyuan: {config: {system: {os: "darwin"}}, languages: {}, notebooks: [] as unknown[]},
        location: {origin: "http://127.0.0.1:6806"}};
    // 未显式提供的依赖统一替换为记录调用的空函数
    const recorder = new Proxy({}, {
        get: (_target, name) => typeof name === "string" && name !== "__esModule" ?
            (...args: unknown[]) => {
                calls.push({name, args});
                return name === "getHostCapabilities" ? {localFileSystem: true} : undefined;
            } : undefined,
    });
    const load = (file: string, modules: Record<string, unknown> = {}) => {
        const exports: Record<string, any> = {};
        runInNewContext(compile(file), {exports, window, navigator: {userAgent: ""}, URL,
            SIYUAN_VERSION: "dev", NODE_ENV: "development",
            require: (id: string) => modules[id] ?? (id === "path" ? path : recorder)});
        return exports;
    };
    const pathName = load("src/util/pathName.ts", {"./mergePathSegments": mergePathSegments, "./escape": escape});
    const util = load("src/editor/util.ts", {"../util/pathName": pathName});
    return {openBy: util.openBy, calls};
};

test("opening assets externally resolves them without URL fragments", () => {
    const {openBy, calls} = loadOpenBy();
    for (const [url, expected] of [
        ["assets/video.mp4#t=10", "assets/video.mp4"],
        ["assets/image.png?box=20260101000000-abcdefg#preview", "assets/image.png?box=20260101000000-abcdefg"],
        ["assets/document.pdf?page=3#view", "assets/document.pdf"],
        ["assets/image%23copy.png", "assets/image%23copy.png"],
    ]) {
        for (const type of ["app", "folder"] as const) {
            calls.length = 0;
            openBy(url, type);
            const request = calls.find(call => call.name === "fetchPost");
            assert.equal(request?.args[0], "/api/asset/resolveAssetPath", url);
            assert.equal((request?.args[1] as {path: string}).path, expected, `${url} ${type}`);
        }
    }
});
