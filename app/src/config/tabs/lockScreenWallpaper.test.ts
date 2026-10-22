import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {ContractFormData} from "../../util/contractFormData";

const fixture = () => {
    const listeners = new Map<string, () => void>();
    const controls = new Map<string, {disabled?: boolean; value?: string; files?: Blob[]; click?: () => void;
        addEventListener: (type: string, fn: () => void) => void}>();
    for (const selector of ["[data-wallpaper-file]", "[data-wallpaper-upload]", "[data-wallpaper-reset]"]) {
        controls.set(selector, {value: "", addEventListener: (type, fn) => listeners.set(selector + type, fn)});
    }
    const hidden = new Set<string>();
    const preview = {src: "", onload: (): void => {}, onerror: (): void => {},
        classList: {add: (key: string) => hidden.add(key), remove: (key: string) => hidden.delete(key)},
        removeAttribute: () => { preview.src = ""; }};
    const element = {querySelector: (selector: string) => selector === "[data-wallpaper-preview]" ? preview : controls.get(selector)};
    const config = {readonly: false, appearance: {lockScreenWallpaper: false}};
    const calls: string[] = [];
    const messages: string[] = [];
    let responseCode = 0;
    let patchFails = false;
    const exports = {} as {mountLockScreenWallpaper: (root: unknown) => void; syncLockScreenWallpaper: () => void};
    const compiled = transpileModule(readFileSync("src/config/tabs/lockScreenWallpaper.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    runInNewContext(compiled, {
        exports, Error, Date,
        document: {querySelectorAll: () => [element]},
        window: {siyuan: {config, languages: {_kernel: {438: "invalid image"}}}},
        require: (name: string) => {
            if (name.endsWith("contractFormData")) return {ContractFormData};
            if (name.endsWith("message")) return {showMessage: (text: string) => messages.push(text)};
            if (name.endsWith("appearanceRuntime")) return {appearanceConfigApi: {
                patch: async (key: string, value: boolean) => {
                    calls.push(`patch:${key}:${value}`);
                    if (patchFails) throw new Error("save failed");
                    config.appearance.lockScreenWallpaper = value;
                },
            }};
            return {fetchSyncPost: async (path: string, form?: ContractFormData<{file: Blob}>) => {
                calls.push(path);
                if (form) assert.ok(form.get("file") instanceof Blob);
                return {code: responseCode, msg: "upload failed"};
            }};
        },
    });
    exports.mountLockScreenWallpaper({querySelector: () => element});
    return {config, calls, messages, controls, preview, hidden, exports,
        setResponse: (code: number) => { responseCode = code; },
        failPatch: () => { patchFails = true; },
        change: async (size = 4) => {
            controls.get("[data-wallpaper-file]").files = [new Blob([new Uint8Array(size)], {type: "image/png"})];
            listeners.get("[data-wallpaper-file]change")();
            await new Promise(resolve => setImmediate(resolve));
        },
        reset: async () => {
            listeners.get("[data-wallpaper-reset]click")();
            await new Promise(resolve => setImmediate(resolve));
        },
    };
};

test("wallpaper uploads one file before enabling its preference and resets before removal", async () => {
    const f = fixture();
    await f.change();
    assert.deepEqual(f.calls, ["/api/system/uploadLockScreenWallpaper", "patch:lockScreenWallpaper:true"]);
    assert.equal(f.config.appearance.lockScreenWallpaper, true);
    assert.match(f.preview.src, /^\/api\/system\/getLockScreenWallpaper\?v=/);
    f.preview.onload();
    assert.equal(f.hidden.has("fn__none"), false);
    f.preview.onerror();
    assert.equal(f.hidden.has("fn__none"), true);
    await f.reset();
    assert.deepEqual(f.calls.slice(2), ["patch:lockScreenWallpaper:false", "/api/system/removeLockScreenWallpaper"]);
    assert.equal(f.preview.src, "");
    assert.equal(f.controls.get("[data-wallpaper-upload]").disabled, false);
});

test("failed uploads and oversized files do not enable the wallpaper", async () => {
    const f = fixture();
    f.setResponse(-1);
    await f.change();
    assert.deepEqual(f.calls, ["/api/system/uploadLockScreenWallpaper"]);
    assert.equal(f.config.appearance.lockScreenWallpaper, false);
    assert.deepEqual(f.messages, ["upload failed"]);
    await f.change(10 * 1024 * 1024 + 1);
    assert.equal(f.calls.length, 1);
    assert.equal(f.messages[1], "invalid image");
    assert.equal(f.controls.get("[data-wallpaper-reset]").disabled, false);
});

test("a failed preference reset preserves the existing image and readonly controls cannot write", async () => {
    const f = fixture();
    f.config.appearance.lockScreenWallpaper = true;
    f.failPatch();
    await f.reset();
    assert.deepEqual(f.calls, ["patch:lockScreenWallpaper:false"]);
    assert.equal(f.config.appearance.lockScreenWallpaper, true);
    f.config.readonly = true;
    await f.change();
    assert.equal(f.calls.length, 1);
});
