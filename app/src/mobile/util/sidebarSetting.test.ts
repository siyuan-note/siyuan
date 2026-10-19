import {test} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";
import {resolveMobileSidebarConfig} from "./mobileBarsConfig";

test("sidebar switches retain one entry and preserve unrelated configuration", async () => {
    const mobileBars = {autoHide: false, sidebarSwipe: true, sidebarButtons: true};
    const inputs = new Map(["sidebarSwipe", "sidebarButtons"].map(key => [key, {
        checked: false,
        disabled: false,
        change: undefined as (() => void) | undefined,
        addEventListener(_type: string, listener: (event: unknown) => void) {
            this.change = () => listener({target: this});
        },
    }]));
    let saves = 0;
    let updates = 0;
    const moduleExports: {mountSidebarSetting?: (root: unknown) => void} = {};
    const source = readFileSync(resolve(process.cwd(), "src/mobile/util/sidebarSetting.ts"), "utf8");
    const code = transpileModule(source, {compilerOptions: {module: ModuleKind.CommonJS}}).outputText;
    runInNewContext(code, {
        exports: moduleExports,
        window: {siyuan: {config: {readonly: false, appearance: {mobileBars}}, isPublish: false}},
        require: (name: string) => {
            if (name === "./mobileBarsConfig") {
                return {getMobileSidebarConfig: () => resolveMobileSidebarConfig(mobileBars)};
            }
            if (name === "../../config/tabs/appearancePreferences") {
                return {patchAppearancePreference: async (path: string, value: boolean) => {
                    saves++;
                    Reflect.set(mobileBars, path.split(".")[1], value);
                }};
            }
            if (name === "./sidebarButtons") {
                return {updateSidebarButtons: () => updates++};
            }
            return {showMobileBars: () => {}};
        },
    });
    moduleExports.mountSidebarSetting({querySelector: (selector: string) => inputs.get(selector.split('"')[1])});
    const swipe = inputs.get("sidebarSwipe");
    const buttons = inputs.get("sidebarButtons");
    assert.equal(swipe.checked, true);
    assert.equal(buttons.checked, true);
    swipe.checked = false;
    swipe.change();
    await Promise.resolve();
    assert.equal(buttons.disabled, true);
    assert.equal(swipe.disabled, false);
    assert.equal(mobileBars.autoHide, false);
    buttons.checked = false;
    buttons.change();
    await Promise.resolve();
    assert.equal(buttons.checked, true);
    assert.equal(saves, 1);
    swipe.checked = true;
    swipe.change();
    await Promise.resolve();
    assert.equal(buttons.disabled, false);
    buttons.checked = false;
    buttons.change();
    await Promise.resolve();
    assert.equal(swipe.disabled, true);
    assert.equal(swipe.checked, true);
    assert.equal(saves, 3);
    assert.equal(updates, 3);
});
