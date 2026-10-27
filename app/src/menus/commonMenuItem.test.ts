import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import * as path from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import * as escape from "../util/escape";
import * as mergePathSegments from "../util/mergePathSegments";
import * as imageURL from "../util/imageURL";
import * as pdfAssetLink from "../editor/pdfAssetLink";

type Flags = {MOBILE: boolean; BROWSER: boolean};

const compile = (file: string, flags: Flags) => transpileModule(require("ifdef-loader/preprocessor").parse(
    readFileSync(file, "utf8"), flags, false, true), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const loadOpenMenu = (flags: Flags) => {
    const calls: Array<{name: string; args: unknown[]}> = [];
    const window = {siyuan: {config: {editor: {}, fileTree: {}}, languages: {}}};
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
        runInNewContext(compile(file, flags), {exports, window, navigator: {userAgent: ""},
            SIYUAN_VERSION: "dev", NODE_ENV: "development", URL, URLSearchParams,
            require: (id: string) => modules[id] ?? (id === "path" ? path : recorder)});
        return exports;
    };
    const pathName = load("src/util/pathName.ts", {"./mergePathSegments": mergePathSegments, "./escape": escape});
    const constants = load("src/constants.ts", {});
    const menu = load("src/menus/commonMenuItem.ts", {
        "../util/pathName": pathName,
        "../constants": constants,
        "../util/imageURL": imageURL,
        "../editor/pdfAssetLink": pdfAssetLink,
    });
    return {openMenu: menu.openMenu, calls};
};

const app = {};

for (const {name, flags, newWindow} of [
    {name: "desktop", flags: {MOBILE: false, BROWSER: false}, newWindow: true},
    {name: "browser", flags: {MOBILE: false, BROWSER: true}, newWindow: false},
]) {
    test(`asset menu opens PDFs without fragments and passes the page separately (${name})`, () => {
        const {openMenu, calls} = loadOpenMenu(flags);
        const submenu = openMenu(app, " assets/document.pdf?box=20260101000000-abcdefg&page=3#view ", true, false);
        const opened = (id: string) => {
            calls.length = 0;
            submenu.find((item: {id: string}) => item.id === id).click();
            return calls.filter(call => call.name.startsWith("openAsset"));
        };
        const pdfPath = "assets/document.pdf?box=20260101000000-abcdefg";
        assert.deepEqual(opened("openBy"), [{name: "openAsset", args: [app, pdfPath, 3]}]);
        assert.deepEqual(opened("insertRight"), [{name: "openAsset", args: [app, pdfPath, 3, "right"]}]);
        assert.deepEqual(opened("insertBottom"), [{name: "openAsset", args: [app, pdfPath, 3, "bottom"]}]);
        assert.deepEqual(opened("openByBackground"), [{name: "openAssetInBackground", args: [app, pdfPath, 3]}]);
        if (newWindow) {
            // 窗口选项对象创建于 vm 上下文中，原型不同，按 JSON 比较
            assert.equal(JSON.stringify(opened("openByNewWindow")),
                JSON.stringify([{name: "openAssetNewWindow", args: [pdfPath, {}, 3]}]));
        } else {
            assert.equal(submenu.some((item: {id: string}) => item.id === "openByNewWindow"), false);
        }
    });

    test(`asset menu keeps media fragments when opening in a tab (${name})`, () => {
        const {openMenu, calls} = loadOpenMenu(flags);
        const submenu = openMenu(app, "assets/video.mp4#t=10", true, false);
        submenu.find((item: {id: string}) => item.id === "openBy").click();
        assert.deepEqual(calls.filter(call => call.name === "openAsset"),
            [{name: "openAsset", args: [app, "assets/video.mp4#t=10", undefined]}]);
    });
}
