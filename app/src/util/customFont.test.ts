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
            document: {getElementById: (): undefined => undefined, createElement: () => ({}), head: {append() {}}},
            require: () => ({fetchSyncPost: async () => {
                customRequests++;
                return {code: 0, data: [font]};
            }}),
        });
        const availableFonts = evaluate("src/util/availableFont.ts", {
            window,
            require: (name: string) => {
                if (name === "./customFont") {
                    return customFont;
                }
                if (name === "./systemFont") {
                    return {loadSystemFonts: async (): Promise<unknown[]> => []};
                }
                return {};
            },
        });
        const result = await availableFonts.loadAvailableFonts();
        const supported = ["docker", "android", "ios", "harmony"].includes(container);
        assert.equal(customRequests, supported ? 1 : 0);
        assert.equal(result.fontItems.length, supported ? 1 : 0);
        if (supported) {
            assert.equal(result.fontItems[0].family, font.family);
        }
    });
}

test("inline font picker uses the same available fonts on desktop and mobile", async () => {
    const font = {family: "SiYuanCustomFont-" + "a".repeat(64), weight: 400, displayName: "导入字体"};
    const core = evaluate("src/util/systemFontCore.ts", {});
    const menu = evaluate("src/protyle/toolbar/fontFamilyMenu.ts", {
        require: (name: string) => {
            if (name === "../../util/availableFont") {
                return {loadAvailableFonts: async () => ({fontItems: [font]})};
            }
            if (name === "../../util/systemFontCore") {
                return core;
            }
            return {};
        },
    }, "\nexports.loadFontFamilies = loadFontFamilies;");
    const fonts = await menu.loadFontFamilies();
    assert.equal(fonts[0].family, font.family);
    assert.equal(menu.getInlineFontFamilyLabel({family: font.family}), font.displayName);
    const source = readFileSync(resolve(process.cwd(), "src/protyle/toolbar/fontFamilyMenu.ts"), "utf8");
    assert.equal(source.split("await loadFontFamilies(options.family)").length - 1, 2);
});

test("one unavailable font source does not hide the other source", async () => {
    for (const failedSource of ["system", "custom"]) {
        const font = {family: "Available", weight: 400, displayName: "Available"};
        const availableFonts = evaluate("src/util/availableFont.ts", {
            console: {warn() {}},
            require: (name: string) => name === "./systemFont" ? {
                loadSystemFonts: async () => {
                    if (failedSource === "system") throw new Error("unavailable");
                    return [font];
                },
            } : {
                supportsCustomFonts: () => true,
                syncCustomFonts() {},
                loadCustomFonts: async () => {
                    if (failedSource === "custom") throw new Error("unavailable");
                    return [font];
                },
            },
        });
        assert.equal((await availableFonts.loadAvailableFonts()).fontItems[0].family, font.family);
    }
});

test("reopening a document registers imported fonts even without a configured default", async () => {
    const id = "a".repeat(64);
    const font = {id, family: "SiYuanCustomFont-" + id, weight: 400};
    const styles: {id?: string; textContent?: string}[] = [];
    let loads = 0;
    const customFont = evaluate("src/util/customFont.ts", {
        window: {siyuan: {config: {system: {container: "harmony"}}}},
        document: {
            getElementById: (): undefined => undefined,
            createElement: () => ({}),
            head: {append: (style: typeof styles[number]) => styles.push(style)},
            fonts: {load: () => { loads++; }},
        },
        require: () => ({fetchSyncPost: async () => ({code: 0, data: [font]})}),
    });
    await customFont.ensureSelectedCustomFonts([]);
    assert.equal(styles.length, 1);
    assert.match(styles[0].textContent, new RegExp(font.family));
    assert.equal(loads, 0);
});

test("font lists refresh after another window imports a font and share concurrent requests", async () => {
    const id = "d".repeat(64);
    const font = {id, family: "SiYuanCustomFont-" + id, weight: 400, displayName: "Imported"};
    let kernelFonts: typeof font[] = [];
    const styles = new Map<string, {id?: string; textContent?: string}>();
    let requests = 0;
    let loads = 0;
    const customFont = evaluate("src/util/customFont.ts", {
        window: {siyuan: {config: {system: {container: "harmony"}}}},
        document: {
            getElementById: (styleID: string) => styles.get(styleID),
            createElement: () => ({}),
            head: {append: (style: {id?: string; textContent?: string}) => styles.set(style.id, style)},
            fonts: {load: async (): Promise<FontFace[]> => { loads++; return []; }},
        },
        require: () => ({fetchSyncPost: async () => {
            requests++;
            return {code: 0, data: kernelFonts};
        }}),
    });
    await customFont.ensureSelectedCustomFonts([]);
    assert.equal(requests, 1);
    assert.equal(styles.size, 0);
    kernelFonts = [font];
    await customFont.ensureSelectedCustomFonts([font]);
    assert.equal(requests, 2);
    assert.equal(styles.size, 1);
    assert.equal(loads, 1);
    const [first, second] = await Promise.all([customFont.loadCustomFonts(), customFont.loadCustomFonts()]);
    assert.equal(requests, 3);
    assert.equal(first[0].family, font.family);
    assert.equal(second[0].family, font.family);
});

test("successful font refresh removes deleted registrations while failed reads preserve them", async () => {
    const id = "e".repeat(64);
    const font = {id, family: "SiYuanCustomFont-" + id, weight: 400};
    let response: {code: number; data: typeof font[]} = {code: 0, data: [font]};
    const styles = new Map<string, {id?: string; textContent?: string; remove?: () => void}>();
    const customFont = evaluate("src/util/customFont.ts", {
        window: {siyuan: {config: {system: {container: "harmony"}}}},
        console: {warn() {}},
        document: {
            getElementById: (styleID: string) => styles.get(styleID),
            createElement: () => ({}),
            head: {append: (style: {id?: string; textContent?: string; remove?: () => void}) => {
                styles.set(style.id, style);
                style.remove = () => { styles.delete(style.id); };
            }},
        },
        require: () => ({fetchSyncPost: async () => response}),
    });
    await customFont.ensureSelectedCustomFonts([]);
    assert.equal(styles.size, 1);
    response = {code: -1, data: []};
    await customFont.ensureSelectedCustomFonts([]);
    assert.equal(styles.size, 1);
    response = {code: 0, data: []};
    await customFont.ensureSelectedCustomFonts([]);
    assert.equal(styles.size, 0);
});

test("invalidating an in-flight font read does not clear its replacement request", async () => {
    const pending: Array<(response: {code: number; data: unknown[]}) => void> = [];
    const customFont = evaluate("src/util/customFont.ts", {
        require: () => ({fetchSyncPost: () => new Promise(resolve => pending.push(resolve))}),
    });
    const first = customFont.loadCustomFonts();
    customFont.invalidateCustomFonts();
    const replacement = customFont.loadCustomFonts();
    pending[0]({code: 0, data: []});
    await first;
    assert.equal(customFont.loadCustomFonts(), replacement);
    assert.equal(pending.length, 2);
    pending[1]({code: 0, data: []});
    await replacement;
});

test("HTML export embeds fonts used only in document styles and ignores plain text", async () => {
    const id = "b".repeat(64);
    const font = {id, family: "SiYuanCustomFont-" + id, weight: 400};
    const unusedID = "c".repeat(64);
    const unused = {id: unusedID, family: "SiYuanCustomFont-" + unusedID, weight: 400};
    let requestedURL = "";
    let parsedHTML = "";
    const customFont = evaluate("src/util/customFont.ts", {
        window: {siyuan: {config: {system: {container: "harmony"}}}},
        document: {createElement: () => ({
            set innerHTML(value: string) { parsedHTML = value; },
            content: {querySelectorAll: () => [{style: {fontFamily: `'${font.family}', serif`}}]},
        })},
        fetch: async (url: string) => {
            requestedURL = url;
            return {ok: true, blob: async () => ({})};
        },
        FileReader: class {
            result = "data:font/ttf;base64,AA==";
            onload: () => void;
            readAsDataURL() { this.onload(); }
        },
        require: () => ({fetchSyncPost: async () => ({code: 0, data: [font, unused]})}),
    });
    const html = `<span style="font-family: '${font.family}'">${unused.family}</span>`;
    const css = await customFont.getExportCustomFontStyle([], html);
    assert.equal(parsedHTML, html);
    assert.equal(requestedURL, `/custom-fonts/${id}`);
    assert.match(css, /data:font\/ttf;base64,AA==/);
    assert.ok(css.includes(font.family));
    assert.ok(!css.includes(unused.family));
    const previewCSS = await customFont.getCustomFontStyle();
    assert.ok(previewCSS.includes(`/custom-fonts/${id}`));
});

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
