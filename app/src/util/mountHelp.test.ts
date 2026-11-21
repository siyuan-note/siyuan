import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

test("opening the user guide requests notebook positioning before the mount notification", async () => {
    const source = transpileModule(readFileSync("src/util/mount.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText;
    for (const platform of ["desktop", "mobile", "onboarding"]) {
        const mobile = platform === "mobile";
        for (const code of [0, -1]) {
            const calls: string[] = [];
            const files = {
                docTree: {revealNotebookOnMount: (id: string) => {
                    calls.push(`reveal:${id}`);
                    return () => calls.push("cancel");
                }},
            };
            const exports: {mountHelp?: () => void} = {};
            const dependencies: Record<string, object> = {
                "../constants": {Constants: {HELP_PATH: {en: "guide"}, SIYUAN_APPID: "app"}},
                "./functions": {isMobile: () => mobile},
                "./fetch": {
                    fetchPost: (url: string, body: {notebook: string}, complete: () => void) => {
                        assert.equal(body.notebook, "guide");
                        calls.push(url);
                        complete();
                    },
                    fetchSyncPost: async (url: string, body: {notebook: string; app: string}) => {
                        assert.equal(body.notebook, "guide");
                        assert.equal(body.app, "app");
                        calls.push(url);
                        return {code};
                    },
                },
                "../layout/tabUtil": {getDockByType: () => mobile ? undefined : {data: {file: files}}},
            };
            runInNewContext(source, {
                exports,
                require: (name: string) => dependencies[name] ?? {},
                window: {siyuan: {config: {appearance: {lang: "en"}}, layout: platform === "desktop" ? {} : undefined,
                    mobile: mobile ? {docks: {file: files}} : undefined}},
            });
            exports.mountHelp();
            await Promise.resolve();
            const hasTree = platform !== "onboarding";
            assert.deepEqual(calls, ["/api/notebook/removeNotebook", ...(hasTree ? ["reveal:guide"] : []),
                "/api/notebook/openNotebook", ...(hasTree && code !== 0 ? ["cancel"] : [])]);
        }
    }
});
