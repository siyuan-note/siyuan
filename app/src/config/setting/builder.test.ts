import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import type {SettingBuilder} from "./builder";

test("settings onShow runs on first opening and on return without rebuilding existing controls", async () => {
    const code = transpileModule(readFileSync("src/config/setting/builder.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const events: string[] = [];
    const runtime = {} as {SettingBuilder: typeof SettingBuilder};
    runInNewContext(code, {
        exports: runtime,
        require: (name: string) => name === "./mount" ? {
            mountSettingTab: async (_id: string, root: {innerHTML: string}) => {
                events.push("mount");
                root.innerHTML = "controls";
            },
        } : {},
    });
    const tab = new runtime.SettingBuilder().tab({
        id: "sync", icon: "iconCloud", title: () => "Account",
        afterMount: () => { events.push("afterMount"); },
        onShow: () => { events.push("show"); },
    }, () => {});
    const root = {innerHTML: ""} as HTMLElement;
    await tab.mount(root);
    await tab.mount(root);
    assert.deepEqual(events, ["mount", "afterMount", "show", "show"]);
    assert.equal(root.innerHTML, "controls");
});
