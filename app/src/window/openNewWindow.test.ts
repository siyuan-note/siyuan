import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import * as path from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import * as escape from "../util/escape";
import * as mergePathSegments from "../util/mergePathSegments";
import * as imageURL from "../util/imageURL";

const compile = (file: string) => transpileModule(require("ifdef-loader/preprocessor").parse(
    readFileSync(file, "utf8"), {MOBILE: false, BROWSER: false}, false, true), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const openAssetWindow = (assetPath: string, page?: number) => {
    const sent: Array<{url: string}> = [];
    const window = {location: {origin: "http://127.0.0.1:6806"}};
    const recorder = new Proxy({}, {get: (_target, name) => name === "__esModule" ? undefined : (): undefined => undefined});
    const load = (file: string, modules: Record<string, unknown> = {}) => {
        const exports: Record<string, any> = {};
        runInNewContext(compile(file), {exports, window, navigator: {userAgent: ""}, URL,
            SIYUAN_VERSION: "dev", NODE_ENV: "development",
            require: (id: string) => modules[id] ?? (id === "path" ? path : recorder)});
        return exports;
    };
    const pathName = load("src/util/pathName.ts", {"./mergePathSegments": mergePathSegments, "./escape": escape});
    const constants = load("src/constants.ts");
    const newWindow = load("src/window/openNewWindow.ts", {
        "../util/pathName": pathName,
        "../constants": constants,
        "../util/imageURL": imageURL,
        "../util/hostCapabilities": {appendRemoteQuery: (url: URL) => url},
        "electron": {ipcRenderer: {send: (_channel: string, data: {url: string}) => sent.push(data)}},
    });
    newWindow.openAssetNewWindow(assetPath, {}, page);
    assert.equal(sent.length, 1, assetPath);
    return JSON.parse(new URL(sent[0].url).searchParams.get("json"))[0];
};

test("asset windows title files without queries or fragments and keep the original path", () => {
    for (const [assetPath, title] of [
        ["assets/image-20260101000000-abcdefg.png#preview", "image-20260101000000-abcdefg.png"],
        ["assets/video-20260101000000-abcdefg.mp4#t=10", "video-20260101000000-abcdefg.mp4"],
        ["assets/image-20260101000000-abcdefg.png?box=20260101000000-hijklmn", "image-20260101000000-abcdefg.png"],
    ]) {
        const tab = openAssetWindow(assetPath);
        assert.equal(tab.title, title, assetPath);
        assert.equal(tab.children.path, assetPath, assetPath);
    }
    assert.equal(openAssetWindow("assets/document.pdf", 3).children.page, 3);
});
