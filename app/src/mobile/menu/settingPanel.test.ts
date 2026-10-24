import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";

test("mobile authentication panels rebuild conditional settings when reopened", async () => {
    const compiled = transpileModule(readFileSync("src/mobile/menu/settingPanel.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText;
    for (const id of ["access", "appearance"]) {
        let options: {html: string; bindEvent: (element: unknown) => void};
        let rebuilt: boolean;
        let watched = 0;
        const root = {isConnected: true, querySelector: (): Element | null => null, classList: {toggle: () => {}}};
        const app = {};
        const exports = {} as {openSettingTab: (app: unknown, tab: unknown) => void};
        runInNewContext(compiled, {exports, require: () => ({
            isMobile: () => true,
            openModel: (value: typeof options) => { options = value; },
            bindSettingSaveDelegation: () => {},
            watchSettingTabInteractions: () => { watched++; },
            getSettingTab: () => ({mount: async (element: unknown, _search: unknown, owner: unknown, rebuild: boolean) => {
                assert.equal(element, root);
                assert.equal(owner, app);
                rebuilt = rebuild;
            }}),
        })});
        exports.openSettingTab(app, {id, title: "Settings"});
        assert.ok(options.html.includes(`data-setting-tab="${id}"`));
        options.bindEvent({firstElementChild: root});
        await Promise.resolve();
        assert.equal(watched, 1);
        assert.equal(rebuilt, id === "access");
    }
});
