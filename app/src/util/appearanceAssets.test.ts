import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";
import * as themeCompatibility from "./themeCompatibility";

const {parse} = require("ifdef-loader/preprocessor");

const createAssets = () => {
    const source = readFileSync(resolve(process.cwd(), "src/util/assets.ts"), "utf8");
    const processed = parse(source, {MOBILE: false, BROWSER: true}, false, true);
    const code = transpileModule(processed, {compilerOptions: {module: ModuleKind.CommonJS}}).outputText;
    const removedElements: string[] = [];
    const element = (attributes: Record<string, string>) => ({
        attributes,
        getAttribute: (key: string) => attributes[key],
        setAttribute: (key: string, value: string) => attributes[key] = value,
        addEventListener: () => {},
        remove: () => removedElements.push(attributes.href || attributes.src),
    });
    const elements = {
        themeDefaultStyle: element({href: "/appearance/themes/daylight/theme.css?v=3.8.5"}),
        themeStyle: element({href: "/appearance/themes/custom/theme.css?v=1.0.0"}),
        iconDefaultScript: element({src: "/appearance/icons/litheness/icon.js?v=3.8.5"}),
        iconScript: element({src: "/appearance/icons/custom/icon.js?v=1.0.0"}),
    };
    const html = element({"data-theme-mode": "light"});
    const appearance = {
        lang: "en", mode: 0, modeOS: false, themeLight: "custom", themeDark: "midnight", themeVer: "1.0.0",
        icon: "custom", iconVer: "1.0.0", themeJS: false,
        lightThemes: [{name: "custom", label: "Custom", frontends: ["all"]}],
        icons: [{name: "custom", label: "Custom"}],
    };
    const moduleExports: {
        enqueueAppearanceUpdate?: (apply: () => Promise<void>) => Promise<void>;
        markAppearanceReloadPending?: () => void;
        invalidateAppearancePackages?: (themes: string[], icons: string[], revision: string) => {themes: string[]; icons: string[]};
        loadAssets?: (data: unknown) => Promise<void>;
    } = {};
    const errors: string[] = [];
    const scriptURLs: string[] = [];
    runInNewContext(code, {
        exports: moduleExports,
        URL,
        console: {error: (message: string) => errors.push(message)},
        window: {
            siyuan: {config: {appearance}, storage: {pdf: {light: "light", dark: "dark"}}},
            location: {href: "http://localhost/stage/build/desktop/"},
            navigator: {},
            matchMedia: () => ({matches: false}),
            setTimeout: () => 0,
            clearTimeout: () => {},
        },
        document: {
            documentElement: {style: {setProperty: () => {}, removeProperty: () => {}}},
            body: {children: []},
            getElementsByTagName: () => [html],
            getElementById: (id: keyof typeof elements) => elements[id],
            querySelectorAll: (): unknown[] => [],
        },
        require: (name: string) => {
            if (name === "../constants") {
                return {Constants: {SIYUAN_VERSION: "3.8.5", LOCAL_PDFTHEME: "pdf"}};
            }
            if (name === "./hostCapabilities") {
                return {getHostCapabilities: () => ({customAppearance: true})};
            }
            if (name === "./themeCompatibility") {
                return themeCompatibility;
            }
            if (name === "../layout/getAll") {
                return {getAllModels: (): {graph: unknown[]} => ({graph: []})};
            }
            if (name === "../protyle/util/addScript") {
                return {addScript: async (url: string, id: keyof typeof elements) => {
                    scriptURLs.push(url);
                    elements[id]?.setAttribute("src", url);
                }};
            }
            return new Proxy({}, {get: () => (): undefined => undefined});
        },
    });
    return {assets: moduleExports, appearance, elements, errors, scriptURLs, removedElements};
};

test("missing appearance packages use built-in resources without replacing the saved choices", async () => {
    const {assets, appearance, elements, scriptURLs, removedElements} = createAssets();
    appearance.lightThemes = [];
    appearance.icons = [];
    appearance.themeJS = true;
    await assets.loadAssets(appearance);
    assert.ok(removedElements.includes("/appearance/themes/custom/theme.css?v=1.0.0"));
    assert.ok(removedElements.includes("/appearance/icons/custom/icon.js?v=1.0.0"));
    assert.equal(elements.themeDefaultStyle.getAttribute("href"), "/appearance/themes/daylight/theme.css?v=3.8.5");
    assert.equal(elements.iconDefaultScript.getAttribute("src"), "/appearance/icons/litheness/icon.js?v=3.8.5");
    assert.deepEqual(scriptURLs, []);
    assert.equal(appearance.themeLight, "custom");
    assert.equal(appearance.icon, "custom");
    assert.equal(appearance.themeVer, "1.0.0");
    assert.equal(appearance.iconVer, "1.0.0");
});

test("appearance resource revisions refresh only affected packages without changing versions", async () => {
    const {assets, appearance, elements, scriptURLs} = createAssets();
    assets.invalidateAppearancePackages(["other"], ["other"], "unrelated");
    await assets.loadAssets(appearance);
    assert.equal(elements.themeStyle.getAttribute("href"), "/appearance/themes/custom/theme.css?v=1.0.0");
    assert.deepEqual(scriptURLs, []);

    assets.invalidateAppearancePackages(["custom"], ["custom"], "sync 1");
    await assets.loadAssets(appearance);
    assert.equal(elements.themeStyle.getAttribute("href"), "/appearance/themes/custom/theme.css?v=1.0.0&revision=sync%201");
    assert.equal(elements.iconScript.getAttribute("src"), "/appearance/icons/custom/icon.js?v=1.0.0&revision=sync%201");
    assert.equal(appearance.themeVer, "1.0.0");
    assert.equal(appearance.iconVer, "1.0.0");
    const repeated = assets.invalidateAppearancePackages(["custom"], ["custom"], "sync 1");
    assert.equal(repeated.themes.length, 0);
    assert.equal(repeated.icons.length, 0);
});

test("appearance updates wait for pending work and continue after an update rejects", async () => {
    const {assets, errors} = createAssets();
    const calls: string[] = [];
    let release: () => void;
    const waiting = new Promise<void>(resolve => release = resolve);
    const first = assets.enqueueAppearanceUpdate(async () => {
        calls.push("first-start");
        await waiting;
        calls.push("first-end");
    });
    const second = assets.enqueueAppearanceUpdate(async () => {
        calls.push("second");
        throw new Error("test update failed");
    });
    const third = assets.enqueueAppearanceUpdate(async () => {
        calls.push("third");
    });
    await Promise.resolve();
    assert.deepEqual(calls, ["first-start"]);
    release();
    await Promise.all([first, second, third]);
    assert.deepEqual(calls, ["first-start", "first-end", "second", "third"]);
    assert.equal(errors.length, 1);
});

test("appearance updates stop after a page reload has been requested", async () => {
    const {assets} = createAssets();
    const calls: string[] = [];
    await assets.enqueueAppearanceUpdate(async () => {
        calls.push("reload");
        assets.markAppearanceReloadPending();
    });
    await assets.enqueueAppearanceUpdate(async () => {
        calls.push("load-again");
    });
    assert.deepEqual(calls, ["reload"]);
});
