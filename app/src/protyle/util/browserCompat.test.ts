import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {createContext, runInContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";

test("compatibility loader skips native runtimes and retries failures before dependent scripts load", async () => {
    const source = transpileModule(readFileSync("src/protyle/util/browserCompat.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText;
    const exports = {} as typeof import("./browserCompat");
    const requests: string[] = [];
    let install = false;
    const context = createContext({exports, window: {siyuan: {languages: {loadingError: "loading failed"}}},
        URL: class {}, AbortSignal: class {},
        require: (name: string) => name === "../../constants" ? {Constants: {PROTYLE_CDN: "/stage/protyle"}} : {
            addScriptSync: async (url: string) => {
                requests.push(url);
                if (install) runInContext("structuredClone = () => {}; Object.groupBy = () => {}; URL.parse = () => {}; AbortSignal.any = () => {}; Promise.withResolvers = () => {};", context);
            },
        }});
    runInContext(source, context);
    await assert.rejects(exports.ensureBrowserCompatibility(), /loading failed/);
    install = true;
    await exports.ensureBrowserCompatibility();
    await exports.ensureBrowserCompatibility();
    assert.deepEqual(requests, ["/stage/protyle/js/webview-compat.js?v=1", "/stage/protyle/js/webview-compat.js?v=1"]);
});
