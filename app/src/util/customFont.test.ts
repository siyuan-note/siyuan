import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";

const evaluate = (path: string, context: Record<string, unknown>, suffix = "") => {
    const source = readFileSync(resolve(process.cwd(), path), "utf8") + suffix;
    const exports: Record<string, (...args: any[]) => any> = {};
    runInNewContext(transpileModule(source, {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText, {exports, ...context});
    return exports;
};

for (const container of ["docker", "android", "ios", "harmony", "std", "unknown"]) {
    test(`appearance font list includes uploaded fonts only on supported containers: ${container}`, async () => {
        const window = {siyuan: {config: {system: {container}}}};
        let customRequests = 0;
        const font = {id: "a".repeat(64), family: "SiYuanCustomFont-" + "a".repeat(64), weight: 400};
        const customFont = evaluate("src/util/customFont.ts", {
            window,
            require: () => ({fetchSyncPost: async () => {
                customRequests++;
                return {data: [font]};
            }}),
        });
        const appearance = evaluate("src/config/tabs/appearanceTab.ts", {
            window,
            require: (name: string) => {
                if (name === "../../util/customFont") {
                    return customFont;
                }
                if (name === "../../util/systemFont") {
                    return {loadSystemFonts: async (): Promise<unknown[]> => []};
                }
                return {};
            },
        }, "\nexports.loadAvailableFonts = loadAvailableFonts;");
        const result = await appearance.loadAvailableFonts();
        const supported = ["docker", "android", "ios", "harmony"].includes(container);
        assert.equal(customRequests, supported ? 1 : 0);
        assert.equal(result.fontItems.length, supported ? 1 : 0);
        if (supported) {
            assert.equal(result.fontItems[0].family, font.family);
        }
    });
}

for (const key of ["globalFontFamilies", "fontFamilies", "codeFontFamilies"]) {
    test(`export embeds custom fonts when only ${key} is configured`, async () => {
        const font = {family: "SiYuanCustomFont-" + "a".repeat(64), weight: 400};
        const appearance = {globalFontFamilies: key === "globalFontFamilies" ? [font] : []};
        const editor = {
            fontFamilies: key === "fontFamilies" ? [font] : [],
            codeFontFamilies: key === "codeFontFamilies" ? [font] : [],
            fontSize: 16,
        };
        const assets = evaluate("src/util/assets.ts", {
            window: {siyuan: {config: {appearance, editor}}},
            document: {},
            CSS: {escape: (value: string) => value},
            require: (name: string) => {
                if (name === "./hostCapabilities") {
                    return {getHostCapabilities: () => ({customAppearance: true})};
                }
                if (name === "./customFont") {
                    return {getExportCustomFontStyle: async (fonts: typeof font[]) => {
                        assert.equal(fonts.length, 1);
                        assert.equal(fonts[0].family, font.family);
                        return "@font-face { src: url(data:font/ttf;base64,AA==); }";
                    }};
                }
                return new Proxy({}, {get: () => () => ""});
            },
        });
        assert.match(await assets.setInlineStyle(false), /data:font\/ttf;base64,AA==/);
    });
}
