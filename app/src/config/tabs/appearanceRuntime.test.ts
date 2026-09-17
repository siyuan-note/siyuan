import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";

const {parse} = require("ifdef-loader/preprocessor");

for (const mobile of [true, false]) {
    for (const change of ["gradient", "duplicate", "theme", "initial"] as const) {
        test(`appearance updates preserve gradient controls without skipping theme initialization (${change}, mobile=${mobile})`, async () => {
            const source = readFileSync(resolve(process.cwd(), "src/config/tabs/appearanceRuntime.ts"), "utf8");
            const processed = parse(source, {MOBILE: mobile, BROWSER: true}, false, true);
            const code = transpileModule(processed, {compilerOptions: {module: ModuleKind.CommonJS}}).outputText;
            const appearance = {lang: "en_US", mode: 0, bodyGradient: {mode: "auto"}};
            const next = change === "initial" ? appearance : {
                ...appearance,
                mode: change === "theme" ? 1 : 0,
                bodyGradient: {mode: change === "duplicate" ? "auto" : "custom"},
            };
            const siyuan = {config: {appearance}};
            const calls: string[] = [];
            let pending: Promise<void>;
            const moduleExports: {appearanceConfigApi?: {apply: (data: unknown) => void}} = {};
            runInNewContext(code, {
                exports: moduleExports,
                window: {siyuan},
                document: {getElementById: (): HTMLElement | null => null},
                require: (name: string) => {
                    if (name === "../util/namespaceApi") {
                        return {createConfigNamespaceApi: (options: {setConfig: (data: unknown) => void}) => ({apply: options.setConfig})};
                    }
                    if (name === "../../util/themeCompatibility") {
                        return {shouldUnloadThemeScript: () => false};
                    }
                    if (name === "../../util/assets") {
                        return new Proxy({}, {get: (_, key) => key === "enqueueAppearanceUpdate" ?
                            (apply: () => Promise<void>) => pending = apply() : () => calls.push(String(key))});
                    }
                    return new Proxy({}, {get: (_, key) => () => calls.push(String(key))});
                },
            });
            moduleExports.appearanceConfigApi.apply(next);
            await pending;
            assert.equal(siyuan.config.appearance, next);
            const updatesInPlace = change === "gradient" || change === "duplicate";
            assert.equal(calls.includes("syncBodyGradient"), updatesInPlace);
            assert.equal(calls.includes("setBodyHighlight"), updatesInPlace);
            assert.equal(calls.includes("loadAssets"), !updatesInPlace);
            assert.equal(calls.includes("remountOpenSettingTab"), !updatesInPlace && !mobile);
        });
    }
}

for (const mobile of [true, false]) {
    for (const affected of ["selected", "other", "icon", "removed", "cannot-unload"] as const) {
        test(`synced appearance packages refresh without changing manifest versions (${affected}, mobile=${mobile})`, async () => {
            const source = readFileSync(resolve(process.cwd(), "src/config/tabs/appearanceRuntime.ts"), "utf8");
            const processed = parse(source, {MOBILE: mobile, BROWSER: true}, false, true);
            const code = transpileModule(processed, {compilerOptions: {module: ModuleKind.CommonJS}}).outputText;
            const appearance = {
                lang: "en", mode: 0, themeLight: "selected", themeDark: "midnight", themeVer: "1.0.0",
                icon: "custom", iconVer: "1.0.0", themeJS: true, bodyGradient: {mode: "auto"},
            };
            const next = {...appearance, themeLight: affected === "removed" ? "daylight" : "selected"};
            const siyuan: {config: {appearance: typeof appearance}; mobile: {editor: null}} = {
                config: {appearance}, mobile: {editor: null},
            };
            const calls: string[] = [];
            const moduleExports: {refreshAppearance?: (data: unknown) => Promise<void>} = {};
            runInNewContext(code, {
                exports: moduleExports,
                window: {siyuan, location: {reload: () => calls.push("reload")}},
                document: {getElementById: (): HTMLElement | null => null},
                require: (name: string) => {
                    if (name === "../util/namespaceApi") {
                        return {createConfigNamespaceApi: () => ({})};
                    }
                    if (name === "../../util/themeCompatibility") {
                        return {
                            shouldUnloadThemeScript: () => false,
                            getCurrentThemeName: (data: typeof appearance) => data.themeLight,
                            isCurrentThemeSupported: () => true,
                        };
                    }
                    if (name === "../../util/assets") {
                        return new Proxy({}, {get: (_, key) => {
                            if (key === "enqueueAppearanceUpdate") {
                                return (apply: () => Promise<void>) => apply();
                            }
                            if (key === "invalidateAppearancePackages") {
                                return (themes: string[], icons: string[], revision: string) => {
                                    assert.equal(revision, "sync-123");
                                    calls.push("invalidate");
                                    return {themes, icons};
                                };
                            }
                            if (key === "unloadThemeScript") {
                                return async () => {
                                    calls.push("unload");
                                    return affected !== "cannot-unload";
                                };
                            }
                            return () => calls.push(String(key));
                        }});
                    }
                    if (name === "../../layout/util") {
                        return {exportLayout: (options: {cb: () => void}) => options.cb()};
                    }
                    return new Proxy({}, {get: (_, key) => () => calls.push(String(key))});
                },
            });
            await moduleExports.refreshAppearance({
                appearance: next, revision: "sync-123",
                themes: affected === "icon" ? [] : [affected === "other" ? "other" : "selected"],
                icons: affected === "icon" ? ["custom"] : [],
            });
            const shouldUnload = affected !== "other" && affected !== "icon";
            assert.equal(calls.includes("unload"), shouldUnload);
            assert.equal(calls.includes("syncBodyGradient"), false);
            assert.equal(calls.includes("reload"), affected === "cannot-unload");
            assert.equal(calls.includes("loadAssets"), affected !== "cannot-unload");
            if (shouldUnload && affected !== "cannot-unload") {
                assert.ok(calls.indexOf("unload") < calls.indexOf("loadAssets"));
            }
            assert.equal(siyuan.config.appearance.themeVer, "1.0.0");
            assert.equal(siyuan.config.appearance.iconVer, "1.0.0");
        });
    }
}
