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

const copyAssetTab = (flags: Flags, assetPath: string, title: string) => {
    const copied: string[] = [];
    const items: Array<{id: string; click?: () => void}> = [];
    const anyShortcut = new Proxy({}, {get: () => ({custom: ""})});
    const window = {siyuan: {languages: {}, config: {keymap: {general: anyShortcut}}, layout: {centerLayout: {}},
        menus: {menu: {remove() {}, append() {}, element: {setAttribute() {}}}}}};
    const recorder = new Proxy({}, {get: (_target, name) => name === "__esModule" ? undefined : (): undefined => undefined});
    const load = (file: string, modules: Record<string, unknown> = {}) => {
        const exports: Record<string, any> = {};
        runInNewContext(compile(file, flags), {exports, window, navigator: {userAgent: ""},
            SIYUAN_VERSION: "dev", NODE_ENV: "development",
            require: (id: string) => modules[id] ?? (id === "path" ? path : recorder)});
        return exports;
    };
    class Asset {}
    class Editor {}
    const pathName = load("src/util/pathName.ts", {"./mergePathSegments": mergePathSegments, "./escape": escape});
    const tabMenu = load("src/menus/tab.ts", {
        "../util/pathName": pathName,
        "../asset": {Asset},
        "../editor": {Editor},
        "../protyle/util/compatibility": {writeText: (text: string) => copied.push(text)},
        "./Menu": {MenuItem: class {
            element = {};
            constructor(options: {id: string; click?: () => void}) {
                items.push(options);
            }
        }},
    });
    const model = Object.assign(Object.create(Asset.prototype), {path: assetPath, parent: {title}});
    const tab: Record<string, unknown> = {id: "tab", model,
        headElement: {getAttribute: (): null => null, classList: {contains: () => false}}};
    tab.parent = {children: [tab]};
    tabMenu.initTabMenu({}, tab);
    items.find(item => item.id === "copy").click();
    return copied;
};

for (const {name, flags} of [
    {name: "desktop", flags: {MOBILE: false, BROWSER: false}},
    {name: "browser", flags: {MOBILE: false, BROWSER: true}},
]) {
    test(`copying an asset tab labels the link with the real file extension (${name})`, () => {
        for (const [assetPath, label] of [
            ["assets/image-20260101000000-abcdefg.png", "image.png"],
            ["assets/image-20260101000000-abcdefg.png#preview", "image.png"],
            ["assets/video-20260101000000-abcdefg.mp4#t=10", "video.mp4"],
            ["assets/image-20260101000000-abcdefg.png?v=1.2", "image.png"],
        ]) {
            const title = assetPath.split(/[?#]/, 1)[0].substring("assets/".length);
            assert.deepEqual(copyAssetTab(flags, assetPath, title), [`[${label}](${assetPath})`], assetPath);
        }
    });
}
