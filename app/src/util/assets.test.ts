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
