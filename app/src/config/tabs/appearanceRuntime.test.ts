import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";

const {parse} = require("ifdef-loader/preprocessor");

for (const mobile of [true, false]) {
    for (const change of ["gradient", "duplicate", "theme", "initial"] as const) {
        test(`appearance updates preserve gradient controls without skipping theme initialization (${change}, mobile=${mobile})`, () => {
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
                    return new Proxy({}, {get: (_, key) => () => calls.push(String(key))});
                },
            });
            moduleExports.appearanceConfigApi.apply(next);
            assert.equal(siyuan.config.appearance, next);
            const updatesInPlace = change === "gradient" || change === "duplicate";
            assert.equal(calls.includes("syncBodyGradient"), updatesInPlace);
            assert.equal(calls.includes("setBodyHighlight"), updatesInPlace);
            assert.equal(calls.includes("loadAssets"), !updatesInPlace);
            assert.equal(calls.includes("remountOpenSettingTab"), !updatesInPlace && !mobile);
        });
    }
}
