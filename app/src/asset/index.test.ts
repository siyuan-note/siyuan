import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import * as path from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import * as escape from "../util/escape";
import * as mergePathSegments from "../util/mergePathSegments";

type Flags = {MOBILE: boolean; BROWSER: boolean};

const compile = (file: string, flags: Flags) => transpileModule(require("ifdef-loader/preprocessor").parse(
    readFileSync(file, "utf8"), flags, false, true), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const loadAsset = (flags: Flags) => {
    const window = {siyuan: {config: {fileTree: {}}, languages: {}}};
    const document = {getElementById: (id: string) => id === "baseURL" ? {getAttribute: () => "http://127.0.0.1:6806"} : null};
    const load = (file: string, modules: Record<string, unknown> = {}) => {
        const exports: Record<string, any> = {};
        runInNewContext(compile(file, flags), {exports, window, document, navigator: {userAgent: ""},
            SIYUAN_VERSION: "dev", NODE_ENV: "development",
            require: (id: string) => modules[id] ?? (id === "path" ? path : {})});
        return exports;
    };
    const pathName = load("src/util/pathName.ts", {"./mergePathSegments": mergePathSegments, "./escape": escape});
    const constants = load("src/constants.ts");
    const assetModule = load("src/asset/index.ts", {
        "../util/pathName": pathName,
        "../util/escape": escape,
        "../constants": constants,
        "../layout/Model": {Model: class {}},
    });
    const titles: string[] = [];
    const asset = Object.create(assetModule.Asset.prototype);
    Object.assign(asset, {
        element: {innerHTML: ""},
        parent: {updateTitle: (title: string) => titles.push(title)},
        pdfLoadState: {isDestroyed: false, clearPending() {}},
    });
    return {asset, titles};
};

for (const {name, flags} of [
    {name: "desktop", flags: {MOBILE: false, BROWSER: false}},
    {name: "browser", flags: {MOBILE: false, BROWSER: true}},
    {name: "mobile", flags: {MOBILE: true, BROWSER: true}},
]) {
    test(`asset tabs render media whose links carry queries or fragments (${name})`, () => {
        const {asset} = loadAsset(flags);
        for (const [assetPath, tag] of [
            ["assets/image.png", "img"],
            ["assets/image.png#preview", "img"],
            ["assets/image.png?v=1.2", "img"],
            ["assets/image.png?box=20260101000000-abcdefg#preview", "img"],
            ["assets/video.mp4#t=10", "video"],
            ["assets/song.MP3#t=30", "audio"],
        ]) {
            asset.path = assetPath;
            asset.element.innerHTML = "";
            asset.render();
            assert.match(asset.element.innerHTML, new RegExp(`^<div class="asset"><${tag} `), assetPath);
            // src 保留原始路径，以便内核读取 box 参数、浏览器按 #t= 定位媒体
            assert.ok(asset.element.innerHTML.includes(`src="http://127.0.0.1:6806/${assetPath}"`), assetPath);
        }
    });

    test(`asset tab titles omit queries and fragments (${name})`, () => {
        const {asset, titles} = loadAsset(flags);
        for (const assetPath of ["assets/image-20260101000000-abcdefg.png#preview", "assets/image-20260101000000-abcdefg.png?v=1.2"]) {
            asset.update(assetPath);
        }
        assert.deepEqual(titles, ["image-20260101000000-abcdefg.png", "image-20260101000000-abcdefg.png"]);
    });
}
