import {it} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";

it("defers plugin API dependency reads and shares the initialized API", () => {
    const source = readFileSync(resolve(process.cwd(), "src/plugin/API.ts"), "utf8");
    const compiled = ts.transpileModule(source, {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
    }).outputText;
    let dependenciesReady = false;
    const confirmations: unknown[][] = [];
    const dialog = {};
    const adaptHotkey = (value: string) => value;
    const openPluginInputDialog = (): void => undefined;
    const openAssetPicker = async (): Promise<null> => null;
    const openDatePicker = (): void => undefined;
    const dependency = new Proxy({}, {
        get(_target, key) {
            if (key === "__esModule") return true;
            assert.ok(dependenciesReady, `Dependency ${String(key)} was read during module initialization`);
            if (key === "createDesktopConfirmDialog") {
                return (...args: unknown[]) => { confirmations.push(args); return dialog; };
            }
            if (key === "openPluginInputDialog") {
                return openPluginInputDialog;
            }
            if (key === "openAssetPicker") {
                return openAssetPicker;
            }
            if (key === "openDatePicker") {
                return openDatePicker;
            }
            return key === "updateHotkeyTip" ? adaptHotkey : (): void => undefined;
        },
    });
    const exports: {getAPI?: () => {
        adaptHotkey: typeof adaptHotkey,
        openInputDialog: typeof openPluginInputDialog,
        openAssetPicker: typeof openAssetPicker,
        openDatePicker: typeof openDatePicker,
        confirm: (title: string, text: string, callback?: (...args: unknown[]) => void) => unknown,
        insertContent: (options: import("./insertContent").IInsertContentOptions) =>
            import("./insertContent").IInsertContentResult
    }} = {};
    runInNewContext(compiled, {exports, require: () => dependency});
    dependenciesReady = true;
    const api = exports.getAPI();
    assert.equal(api.adaptHotkey, adaptHotkey);
    assert.equal(api.openInputDialog, openPluginInputDialog);
    assert.equal(api.openAssetPicker, openAssetPicker);
    assert.equal(api.openDatePicker, openDatePicker);
    assert.equal(typeof api.insertContent, "function");
    assert.equal(exports.getAPI(), api);
    const callbacks: unknown[][] = [];
    const callback = (...args: unknown[]) => { callbacks.push(args); };
    assert.equal(api.confirm("", "", callback), dialog);
    assert.deepEqual(callbacks, []);
    assert.equal(confirmations.length, 1);
    assert.equal(confirmations[0].length, 1);
    const options = confirmations[0][0] as import("../dialog/confirmDialog").IConfirmDialogOptions;
    assert.equal(options.title, "");
    assert.equal(options.text, "");
    assert.equal(options.confirm, callback);
});
