import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";

for (const keywords of ["", "gradient"]) {
    test(`remount restores scroll after asynchronous initialization and search (keywords=${keywords})`, async () => {
        const source = readFileSync(resolve(process.cwd(), "src/config/setting/mount.ts"), "utf8");
        const code = transpileModule(source, {compilerOptions: {module: ModuleKind.CommonJS}}).outputText;
        const root = {innerHTML: "settings", scrollTop: 235.5, scrollLeft: 12};
        const visibleItemIds = new Set(["bodyGradient"]);
        const tab = {
            scanSearch: () => ({visibleItemIds}),
            mount: async (element: typeof root, search: {visibleItemIds?: Set<string>}, _app: unknown, rebuild: boolean) => {
                assert.equal(element, root);
                assert.equal(rebuild, true);
                assert.equal(search.visibleItemIds, keywords ? visibleItemIds : undefined);
                element.scrollTop = 0;
                element.scrollLeft = 0;
                await Promise.resolve();
                element.scrollTop = 210;
            },
        };
        const moduleExports: {remountOpenSettingTab?: (tabId: string) => Promise<void>} = {};
        runInNewContext(code, {
            exports: moduleExports,
            window: {siyuan: {dialogs: [{element: {
                getAttribute: () => "settings",
                querySelector: () => root,
            }}]}},
            require: (name: string) => {
                if (name === "../../constants") {
                    return {Constants: {DIALOG_SETTING: "settings"}};
                }
                if (name === "../search/normalize") {
                    return {getSearchKeywordsLower: () => keywords};
                }
                if (name === "./tabs") {
                    return {getSettingTab: () => tab};
                }
                return {};
            },
        });
        await moduleExports.remountOpenSettingTab("appearance");
        assert.equal(root.scrollTop, 235.5);
        assert.equal(root.scrollLeft, 12);
    });
}
