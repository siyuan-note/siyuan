import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {describe, it, test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";
import {getFontFamilyDisplayName, getUniqueFontFamilies, parseSystemFontsJSON} from "./systemFontCore";

const font = {family: "HarmonyOS Sans", displayName: "HarmonyOS Sans", weight: 400};

const load = (container: string, bridge?: () => Promise<string>, kernel?: () => Promise<unknown>) => {
    let requests = 0;
    const exports: {loadSystemFonts?: () => Promise<typeof font[]>} = {};
    const window = {siyuan: {config: {system: {container}}}, JSHarmony: {getSystemFonts: bridge}};
    runInNewContext(transpileModule(readFileSync(resolve(process.cwd(), "src/util/systemFont.ts"), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText, {
        exports, window, console: {warn() {}},
        require: (name: string) => name === "./systemFontCore" ? {parseSystemFontsJSON} : {
            fetchSyncPost: async () => {
                requests++;
                return {data: kernel ? await kernel() : [font]};
            },
        },
    });
    return {load: () => exports.loadSystemFonts(), requests: () => requests};
};

test("HarmonyOS lists native families and refreshes after system font installation", async () => {
    let calls = 0;
    const harness = load("harmony", async () => {
        calls++;
        return JSON.stringify([{...font, family: calls === 1 ? font.family : "Newly Installed"}]);
    });
    assert.equal((await harness.load())[0].family, font.family);
    assert.equal((await harness.load())[0].family, "Newly Installed");
    assert.equal(harness.requests(), 0);
});

test("concurrent HarmonyOS pickers share one native enumeration", async () => {
    let calls = 0;
    const harness = load("harmony", async () => {
        calls++;
        return JSON.stringify([font]);
    });
    await Promise.all([harness.load(), harness.load()]);
    assert.equal(calls, 1);
});

test("older HarmonyOS containers and native failures retain the kernel fallback", async () => {
    const missing = load("harmony");
    assert.equal((await missing.load())[0].family, font.family);
    assert.equal(missing.requests(), 1);
    for (const result of ["[]", "null", "invalid", '[{"family": "Invalid"}]']) {
        const harness = load("harmony", async () => result);
        assert.equal((await harness.load())[0].family, font.family);
        assert.equal(harness.requests(), 1);
    }
    let calls = 0;
    const retry = load("harmony", async () => {
        if (++calls === 1) throw new Error("native unavailable");
        return JSON.stringify([font]);
    });
    await retry.load();
    await retry.load();
    assert.equal(calls, 2);
    assert.equal(retry.requests(), 1);
});

test("other containers retain cached kernel fonts", async () => {
    const harness = load("std", async () => { throw new Error("must not call HarmonyOS"); });
    await Promise.all([harness.load(), harness.load()]);
    await harness.load();
    assert.equal(harness.requests(), 1);
});

test("malformed native entries are skipped without losing valid fonts", () => {
    assert.deepEqual(parseSystemFontsJSON(JSON.stringify([
        null, {}, {...font, weight: 0}, {...font, aliases: [1]}, {...font, family: " "}, font,
    ])), [font]);
});

describe("getFontFamilyDisplayName", () => {
    const fonts = [{
        family: "eryapang",
        weight: 400,
        displayName: "尔雅胖丁体",
    }, {
        family: "Fallback Font",
        weight: 400,
        displayName: "",
    }];

    it("uses the display name and falls back to the CSS family", () => {
        assert.equal(getFontFamilyDisplayName(fonts, "eryapang"), "尔雅胖丁体");
        assert.equal(getFontFamilyDisplayName(fonts, "Fallback Font"), "Fallback Font");
        assert.equal(getFontFamilyDisplayName(fonts, "Unknown Font"), "Unknown Font");
        assert.equal(getFontFamilyDisplayName(fonts), undefined);
    });
});

describe("getUniqueFontFamilies", () => {
    it("keeps one regular entry per family and merges searchable aliases", () => {
        assert.deepEqual(getUniqueFontFamilies([{
            family: "Example Sans",
            weight: 700,
            displayName: "Example Sans Bold",
            aliases: ["示例粗体"],
        }, {
            family: "Example Sans",
            weight: 400,
            displayName: "Example Sans",
            aliases: ["示例"],
        }, {
            family: "Another Font",
            weight: 400,
            displayName: "Another Font",
        }]), [{
            family: "Another Font",
            weight: 400,
            displayName: "Another Font",
        }, {
            family: "Example Sans",
            weight: 400,
            displayName: "Example Sans",
            aliases: ["示例粗体", "示例"],
        }]);
    });
});
