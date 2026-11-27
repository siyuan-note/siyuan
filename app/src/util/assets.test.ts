import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";
import {getEmojiFontStyle} from "./emojiFont";

const source = ts.transpileModule(readFileSync(join(__dirname, "assets.ts"), "utf8"), {
    compilerOptions: {module: ts.ModuleKind.CommonJS},
}).outputText;

test("database field layout preference updates existing global styles and defaults to row-first two columns", async () => {
    const api = {} as typeof import("./assets");
    const editor: {fontSize: number, databaseAttrLayout?: number} = {fontSize: 16};
    const style = {innerHTML: ""};
    runInNewContext(source, {
        exports: api,
        window: {siyuan: {config: {editor}}},
        document: {getElementById: () => style},
        require: (id: string) => {
            if (id === "../protyle/util/compatibility") return {
                isMac: () => false, isIPad: () => false, isIPhone: () => false,
                isWin11: async () => false, resolvePlatformClass: () => "body--windows",
            };
            if (id === "./hostCapabilities") return {getHostCapabilities: () => ({customAppearance: false})};
            return new Proxy({}, {get: () => () => ""});
        },
    });
    for (const value of [undefined, 0, 1, 2]) {
        editor.databaseAttrLayout = value;
        await api.setInlineStyle();
        assert.match(style.innerHTML, new RegExp(`--b3-database-attr-columns: ${value === 0 ? 1 : 2}`));
        assert.match(style.innerHTML, new RegExp(`--b3-database-attr-column-flow: ${value === 2 ? 1 : 0}`));
    }
});

for (const [name, platformClass, win11, apple] of [
    ["Windows 11", "body--windows", true, false],
    ["Windows fallback", "body--windows", false, false],
    ["Linux", "body--linux", false, false],
    ["Android", "body--android", false, false],
    ["HarmonyOS", "body--harmony", false, false],
    ["macOS", "body--mac", false, true],
    ["iOS", "body--ios", false, true],
] as const) {
    test(`selects frontend emoji fonts for ${name} independently of the kernel host`, async () => {
        const exports = {} as typeof import("./assets");
        runInNewContext(source, {
            exports,
            window: {siyuan: {config: {system: {container: "android"}, editor: {fontSize: 16}}}},
            document: {},
            require: (id: string) => {
                if (id === "../protyle/util/compatibility") {
                    return {isMac: () => platformClass === "body--mac", isIPad: () => false,
                        isIPhone: () => apple, isWin11: async () => win11,
                        resolvePlatformClass: () => platformClass};
                }
                if (id === "./emojiFont") {
                    return {getEmojiFontStyle};
                }
                if (id === "./hostCapabilities") {
                    return {getHostCapabilities: () => ({customAppearance: false})};
                }
                return new Proxy({}, {get: () => () => ""});
            },
        });
        const style = await exports.setInlineStyle(false, "");
        assert.equal(style.includes('font-family: "Emojis File Tree"'), platformClass === "body--windows" && !win11);
        assert.equal(style.includes('font-family: "Emojis Icon"'), win11);
    });
}

const runNativeAppearance = ({
    platform,
    frontend = "desktop",
    userAgent,
    colors = {"--b3-theme-background": "rgb(30, 30, 30)", "--b3-body-background": "rgb(46, 50, 54)"},
    mode = 1,
    canvasColor,
}: {
    platform: "ios" | "android" | "harmony" | "browser";
    frontend?: string;
    userAgent: string;
    colors?: Record<string, string>;
    mode?: number;
    canvasColor?: number[];
}) => {
    const api = {} as typeof import("./assets");
    const calls: (string | number)[][] = [];
    const attributes = new Map<string, string>();
    const styles = new Map<string, string>();
    const loadingStyle = {backgroundColor: "", setProperty: (_: string, value: string) => {
        loadingStyle.backgroundColor = value;
    }};
    const bodyStyle = {backgroundColor: ""};
    const changeStatusBarColor = (color: string, appearance: number) => calls.push([color, appearance]);
    runInNewContext(source, {
        exports: api,
        navigator: {userAgent},
        CSS: {supports: () => Boolean(canvasColor)},
        window: {
            siyuan: {config: {appearance: {mode, modeOS: false}}},
            matchMedia: () => ({matches: false, addEventListener() {}}),
            webkit: {messageHandlers: {changeStatusBar: {postMessage: (value: string) => calls.push([value])}}},
            JSAndroid: {changeStatusBarColor},
            JSHarmony: {changeStatusBarColor},
        },
        document: {
            getElementById: (id: string) => id === "loading" ? {querySelector: () => ({style: loadingStyle})} : null,
            createElement: (tag: string) => tag === "canvas" ? {
                getContext: () => ({fillRect() {}, getImageData: () => ({data: canvasColor})}),
            } : {style: {}, remove() {}},
            documentElement: {
                appendChild() {},
                setAttribute: (name: string, value: string) => attributes.set(name, value),
                style: {setProperty: (name: string, value: string) => styles.set(name, value)},
            },
            body: {style: bodyStyle},
        },
        getComputedStyle: (element: {style: {backgroundColor: string}}) => ({
            backgroundColor: colors[element.style.backgroundColor.slice(4, -1)] || "rgba(0, 0, 0, 0)",
        }),
        setTimeout: (callback: () => void) => callback(),
        require: (id: string) => {
            if (id === "../protyle/util/compatibility") {
                return {
                    isInMobileApp: () => platform !== "browser",
                    isInIOS: () => platform === "ios",
                    isIPhone: () => userAgent.includes("iPhone"),
                    isInAndroid: () => platform === "android",
                    isInHarmony: () => platform === "harmony",
                };
            }
            if (id === "./functions") {
                return {getFrontend: () => frontend};
            }
            return {};
        },
    });
    api.initAssets(true);
    return {calls, attributes, styles, loadingColor: loadingStyle.backgroundColor, bodyColor: bodyStyle.backgroundColor};
};

for (const [platform, userAgent] of [
    ["ios", "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)"],
    ["android", "Mozilla/5.0 (Linux; Android 17) Chrome/146.0.0.0 Mobile Safari/537.36"],
    ["harmony", "Mozilla/5.0 (Phone; OpenHarmony 6.0) ArkWeb/6.0.0.42 Mobile"],
] as const) {
    test(`${platform} phones match native bars to the desktop chrome without repainting the loading screen`, () => {
        const {calls, attributes, styles, loadingColor, bodyColor} = runNativeAppearance({platform, userAgent});
        assert.deepEqual(calls, platform === "ios" ? [["#2e3236ff 1"]] : [["#2e3236ff", 1]]);
        assert.ok(attributes.has("data-native-phone-desktop"));
        assert.equal(styles.get("--b3-phone-window-edge-color"), "#2e3236ff");
        assert.equal(loadingColor, "#1e1e1eff");
        assert.equal(bodyColor, "#1e1e1eff");

        const mobile = runNativeAppearance({platform, userAgent, frontend: "mobile"});
        assert.deepEqual(mobile.calls, platform === "ios" ? [["#1e1e1eff 1"]] : [["#1e1e1eff", 1]]);
        assert.equal(mobile.attributes.size, 0);
    });
}

test("tablet, Harmony PC and browser desktop do not use the phone edge treatment", () => {
    for (const [platform, userAgent] of [
        ["ios", "Mozilla/5.0 (iPad; CPU OS 26_0 like Mac OS X)"],
        ["android", "Mozilla/5.0 (Linux; Android 17) Chrome/146.0.0.0 Safari/537.36"],
        ["harmony", "Mozilla/5.0 (Tablet; OpenHarmony 6.0) ArkWeb/6.0.0.42"],
        ["harmony", "Mozilla/5.0 (PC; OpenHarmony 6.0) ArkWeb/6.0.0.42"],
        ["browser", "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)"],
    ] as const) {
        const {calls, attributes, styles} = runNativeAppearance({platform, userAgent});
        assert.deepEqual(calls, platform === "browser" ? [] : platform === "ios" ? [["#1e1e1eff 1"]] : [["#1e1e1eff", 1]]);
        assert.equal(attributes.size, 0);
        assert.equal(styles.size, 0);
    }
});

test("desktop phone edge sends opaque light and custom colors with the existing mode", () => {
    const args = {platform: "ios", userAgent: "iPhone", mode: 0} as const;
    const colors = {"--b3-theme-background": "rgb(255, 255, 255)", "--b3-body-background": "rgb(235, 236, 240)"};
    assert.deepEqual(runNativeAppearance({...args, colors}).calls, [["#ebecf0ff 0"]]);
    colors["--b3-body-background"] = "rgba(40, 50, 60, 0.25)";
    assert.deepEqual(runNativeAppearance({...args, colors}).calls, [["#ffffffff 0"]]);
    colors["--b3-body-background"] = "oklch(0.7 0.05 160)";
    assert.deepEqual(runNativeAppearance({...args, colors, canvasColor: [41, 92, 63, 255]}).calls, [["#295c3fff 0"]]);
});
