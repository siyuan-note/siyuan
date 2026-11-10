import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";
import * as themeCompatibility from "./themeCompatibility";
import * as browserCompatibility from "../protyle/util/browserCompatibility";
import type {TBrowserNavigator} from "../protyle/util/browserCompatibility";

const {parse} = require("ifdef-loader/preprocessor");

class AssetElement extends EventTarget {
    isConnected = true;
    rel = "";
    onload: () => void;
    onerror: () => void;
    parentNode: {insertBefore: (element: AssetElement, reference: AssetElement) => void};

    constructor(public attributes: Record<string, string>, private onRemove: () => void) {
        super();
    }

    get id() {
        return this.attributes.id;
    }

    set id(value: string) {
        this.attributes.id = value;
    }

    get href() {
        return this.attributes.href;
    }

    set href(value: string) {
        this.attributes.href = value;
    }

    getAttribute(key: string) {
        return this.attributes[key];
    }

    setAttribute(key: string, value: string) {
        this.attributes[key] = value;
    }

    toggleAttribute(key: string, enabled: boolean) {
        if (enabled) {
            this.attributes[key] = "";
        } else {
            delete this.attributes[key];
        }
    }

    remove() {
        this.isConnected = false;
        this.onRemove();
    }

    emit(type: "load" | "error") {
        this[type === "load" ? "onload" : "onerror"]?.();
        this.dispatchEvent(new Event(type));
    }
}

const createAssets = (ensureLute: () => Promise<void> = async () => {}, client: {
    navigator?: TBrowserNavigator;
    backend?: string;
    mobile?: boolean;
    dark?: boolean;
    customAppearance?: boolean;
} = {}) => {
    const source = readFileSync(resolve(process.cwd(), "src/util/assets.ts"), "utf8");
    const processed = parse(source, {MOBILE: client.mobile || false, BROWSER: true}, false, true);
    const code = transpileModule(processed, {compilerOptions: {module: ModuleKind.CommonJS}}).outputText;
    const removedElements: string[] = [];
    const nodes: AssetElement[] = [];
    const element = (attributes: Record<string, string>) => {
        const result = new AssetElement(attributes, () => removedElements.push(attributes.href || attributes.src));
        result.rel = attributes.href ? "stylesheet" : "";
        result.parentNode = {insertBefore: (newElement, reference) => {
            assert.ok(reference.isConnected);
            newElement.isConnected = true;
        }};
        nodes.push(result);
        return result;
    };
    const elements = {
        themeDefaultStyle: element({href: `/appearance/themes/${client.dark ? "midnight" : "daylight"}/theme.css?v=3.8.5`}),
        themeStyle: element({href: "/appearance/themes/custom/theme.css?v=1.0.0"}),
        iconDefaultScript: element({src: "/appearance/icons/litheness/icon.js?v=3.8.5"}),
        iconScript: element({src: "/appearance/icons/custom/icon.js?v=1.0.0"}),
    };
    Object.entries(elements).forEach(([id, item]) => item.id = id);
    const html = element({"data-theme-mode": client.dark ? "dark" : "light"});
    const appearance = {
        pdfTheme: {light: "light", dark: "dark", annoColor: "var(--b3-pdf-background1)"},
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
    const writes: {path: string; value: unknown}[] = [];
    runInNewContext(code, {
        exports: moduleExports,
        URL,
        console: {error: (message: string) => errors.push(message)},
        window: {
            siyuan: {config: {appearance}, storage: {pdf: {light: "light", dark: "dark"}}},
            location: {href: "http://localhost/stage/build/desktop/"},
            navigator: client.navigator || {userAgent: "", platform: "", maxTouchPoints: 0},
            matchMedia: () => ({matches: client.dark || false}),
            setTimeout: () => 0,
            clearTimeout: () => {},
        },
        document: {
            documentElement: {style: {setProperty: () => {}, removeProperty: () => {}}},
            body: {children: []},
            getElementsByTagName: () => [html],
            getElementById: (id: string) => nodes.find(item => item.id === id && item.isConnected),
            createElement: () => {
                const result = element({});
                result.isConnected = false;
                return result;
            },
            querySelectorAll: (): unknown[] => [],
        },
        require: (name: string) => {
            if (name === "../constants") {
                return {Constants: {SIYUAN_VERSION: "3.8.5", LOCAL_PDFTHEME: "pdf"}};
            }
            if (name === "./hostCapabilities") {
                return {getHostCapabilities: () => ({customAppearance: client.customAppearance !== false})};
            }
            if (name === "../config/util/configApi") {
                return {config: {set: (path: string, value: unknown) => writes.push({path, value})}};
            }
            if (name === "./themeCompatibility") {
                return themeCompatibility;
            }
            if (name === "../protyle/util/browserCompatibility") {
                return browserCompatibility;
            }
            if (name === "./functions") {
                return {
                    getBackend: () => client.backend || "linux",
                    getFrontend: () => client.mobile ? "browser-mobile" : "browser-desktop",
                };
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
            if (name === "../protyle/util/addStyle") {
                return {addStyle: (href: string, id: string) => element({href, id})};
            }
            if (name === "../protyle/util/lute") {
                return {ensureLute};
            }
            return new Proxy({}, {get: () => (): undefined => undefined});
        },
    });
    return {assets: moduleExports, appearance, elements, html, errors, scriptURLs, removedElements, writes, nodes};
};

for (const mobile of [false, true]) {
    test(`failed default styles preserve the current theme and allow retry (mobile=${mobile})`, async () => {
        const {assets, appearance, elements, nodes, errors} = createAssets(undefined, {mobile});
        const originalStyle = elements.themeDefaultStyle;
        appearance.mode = 1;
        for (let attempt = 0; attempt < 3; attempt++) {
            await assets.loadAssets(appearance);
            const pending = nodes.at(-1);
            assert.equal(pending.href, "/appearance/themes/midnight/theme.css?v=3.8.5");
            assert.ok(originalStyle.isConnected);
            assert.ok(pending.isConnected);
            pending.emit("error");
            assert.ok(originalStyle.isConnected);
            assert.equal(originalStyle.id, "themeDefaultStyle");
            assert.equal(pending.isConnected, false);
            assert.equal(pending.onload, null);
            assert.equal(pending.onerror, null);
            assert.equal(nodes.filter(item => item.isConnected && item.rel === "stylesheet").length, 1);
        }
        assert.equal(errors.length, 3);

        await assets.loadAssets(appearance);
        const loaded = nodes.at(-1);
        loaded.emit("load");
        assert.equal(originalStyle.isConnected, false);
        assert.ok(loaded.isConnected);
        assert.equal(loaded.id, "themeDefaultStyle");
        assert.equal(loaded.onload, null);
        assert.equal(loaded.onerror, null);
        assert.equal(nodes.filter(item => item.isConnected && item.id === "themeDefaultStyle").length, 1);
        const count = nodes.length;
        await assets.loadAssets(appearance);
        assert.equal(nodes.length, count);
    });

    test(`repeated default theme updates reuse pending styles and cancel stale loads (mobile=${mobile})`, async () => {
        const {assets, appearance, elements, nodes, errors} = createAssets(undefined, {mobile});
        appearance.mode = 1;
        await assets.loadAssets(appearance);
        const staleStyle = nodes.at(-1);
        const lateLoad = staleStyle.onload;
        const count = nodes.length;
        await assets.loadAssets(appearance);
        assert.equal(nodes.length, count);

        appearance.mode = 0;
        await assets.loadAssets(appearance);
        assert.equal(staleStyle.isConnected, false);
        assert.equal(staleStyle.onload, null);
        assert.equal(staleStyle.onerror, null);
        assert.ok(elements.themeDefaultStyle.isConnected);

        appearance.mode = 1;
        await assets.loadAssets(appearance);
        const latestStyle = nodes.at(-1);
        lateLoad();
        assert.ok(elements.themeDefaultStyle.isConnected);
        latestStyle.emit("load");
        assert.equal(elements.themeDefaultStyle.isConnected, false);
        assert.equal(latestStyle.id, "themeDefaultStyle");
        assert.equal(nodes.filter(item => item.isConnected && item.id === "themeDefaultStyle").length, 1);
        assert.deepEqual(errors, []);
    });

    test(`default style loads tolerate removed or replaced fallback elements (mobile=${mobile})`, async () => {
        for (const action of ["remove", "reload", "replace"]) {
            const {assets, appearance, elements, nodes} = createAssets(undefined, {mobile});
            appearance.mode = 1;
            await assets.loadAssets(appearance);
            const pending = nodes.at(-1);
            const lateLoad = pending.onload;
            elements.themeDefaultStyle.remove();
            if (action === "reload") {
                await assets.loadAssets(appearance);
                assert.equal(pending.isConnected, false);
                lateLoad();
            } else if (action === "replace") {
                const replacement = new AssetElement({id: "themeDefaultStyle", href: pending.href}, () => {});
                nodes.push(replacement);
                pending.emit("load");
                assert.equal(pending.isConnected, false);
                assert.ok(replacement.isConnected);
            } else {
                pending.emit("load");
                assert.ok(pending.isConnected);
                assert.equal(pending.id, "themeDefaultStyle");
            }
            assert.equal(nodes.filter(item => item.isConnected && item.id === "themeDefaultStyle").length, 1);
        }
    });

    for (const dark of [false, true]) {
        for (const customAppearance of [false, true]) {
            test(`system theme rendering does not write shared settings (mobile=${mobile}, dark=${dark}, custom=${customAppearance})`, async () => {
                const {assets, appearance, elements, html, writes} = createAssets(undefined,
                    {mobile, dark, customAppearance, backend: "android"});
                appearance.modeOS = true;
                appearance.themeLight = "daylight";
                for (let notification = 0; notification < 3; notification++) {
                    // 手机与浏览器共用内核，收到的模式可能与当前前端的系统模式相反。
                    appearance.mode = dark ? 0 : 1;
                    await assets.loadAssets(appearance);
                    assert.equal(appearance.mode, dark ? 1 : 0);
                    assert.equal(html.getAttribute("data-theme-mode"), dark ? "dark" : "light");
                    assert.equal(elements.themeDefaultStyle.getAttribute("href"),
                        `/appearance/themes/${dark ? "midnight" : "daylight"}/theme.css?v=3.8.5`);
                    assert.deepEqual(writes, []);
                }
            });
        }
    }
    test(`manual theme mode takes precedence over the system (mobile=${mobile})`, async () => {
        const {assets, appearance, elements, html, writes} = createAssets(undefined, {mobile, dark: true});
        elements.themeDefaultStyle.setAttribute("href", "/appearance/themes/daylight/theme.css?v=3.8.5");
        html.setAttribute("data-theme-mode", "light");
        await assets.loadAssets(appearance);
        assert.equal(appearance.mode, 0);
        assert.equal(html.getAttribute("data-theme-mode"), "light");
        assert.equal(elements.themeDefaultStyle.getAttribute("href"), "/appearance/themes/daylight/theme.css?v=3.8.5");
        assert.deepEqual(writes, []);
    });
}

test("appearance exposes the kernel backend and the browser frontend independently", async () => {
    const cases = [
        {name: "Windows client with iOS backend", backend: "ios", mobile: false,
            navigator: {userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", platform: "Win32", maxTouchPoints: 0}},
        {name: "macOS client with iOS backend", backend: "ios", mobile: false,
            navigator: {userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", platform: "MacIntel", maxTouchPoints: 0}},
        {name: "Android client with iOS backend", backend: "ios", mobile: true,
            navigator: {userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9)", platform: "Linux armv8l", maxTouchPoints: 5}},
        {name: "iPhone client with Linux backend", backend: "linux", mobile: true,
            navigator: {userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X)", platform: "iPhone", maxTouchPoints: 5}},
        {name: "iPad desktop client with Linux backend", backend: "linux", mobile: false,
            navigator: {userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)", platform: "MacIntel", maxTouchPoints: 5}},
    ];
    for (const scenario of cases) {
        const {assets, appearance, html} = createAssets(undefined, scenario);
        await assets.loadAssets(appearance);
        assert.equal(html.getAttribute("data-backend"), scenario.backend, scenario.name);
        assert.equal(html.getAttribute("data-frontend"), scenario.mobile ? "browser-mobile" : "browser-desktop", scenario.name);
    }
});

test("third-party appearance scripts wait for Lute before execution", async () => {
    let complete: () => void;
    const pending = new Promise<void>(resolve => complete = resolve);
    const {assets, appearance, scriptURLs} = createAssets(() => pending);
    appearance.themeJS = true;
    const loaded = assets.loadAssets(appearance);
    assert.deepEqual(scriptURLs, []);
    complete();
    await loaded;
    assert.ok(scriptURLs.some(url => url.startsWith("/appearance/themes/custom/theme.js")));
});

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
