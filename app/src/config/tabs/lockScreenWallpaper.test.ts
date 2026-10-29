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
    for (const selector of ["[data-wallpaper-file]", "[data-wallpaper-upload]", "[data-wallpaper-reset]", "[data-wallpaper-built-in]"]) {
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
    let readFails = false;
    let readSize = 4;
    let finishRead: () => void;
    let pickerOptions: {select: (name: string) => void; destroyCallback: () => void};
    const files: File[] = [];
    const exports = {} as {mountLockScreenWallpaper: (root: unknown) => void; syncLockScreenWallpaper: () => void};
    const compiled = transpileModule(readFileSync("src/config/tabs/lockScreenWallpaper.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    runInNewContext(compiled, {
        exports, Error, Date, File,
        fetch: async (path: string) => {
            calls.push(`read:${path}`);
            await new Promise<void>(resolve => { finishRead = resolve; });
            return {ok: !readFails, blob: async () => new Blob([new Uint8Array(readSize)], {type: "image/webp"})};
        },
        document: {querySelectorAll: () => [element]},
        window: {siyuan: {config, languages: {_kernel: {438: "invalid image", 258: "operation failed"}}}},
        require: (name: string) => {
            if (name.endsWith("contractFormData")) return {ContractFormData};
            if (name.endsWith("message")) return {showMessage: (text: string) => messages.push(text)};
            if (name.endsWith("coverPicker")) return {openCoverPicker: (options: typeof pickerOptions) => {
                calls.push("picker");
                pickerOptions = options;
                return {};
            }};
            if (name.endsWith("appearanceRuntime")) return {appearanceConfigApi: {
                patch: async (key: string, value: boolean) => {
                    calls.push(`patch:${key}:${value}`);
                    if (patchFails) throw new Error("save failed");
                    config.appearance.lockScreenWallpaper = value;
                },
            }};
            return {fetchSyncPost: async (path: string, form?: ContractFormData<{file: Blob}>) => {
                calls.push(path);
                if (form) {
                    assert.ok(form.get("file") instanceof Blob);
                    files.push(form.get("file") as File);
                }
                return {code: responseCode, msg: "upload failed"};
            }};
        },
    });
    exports.mountLockScreenWallpaper({querySelector: () => element});
    const settle = () => new Promise(resolve => setImmediate(resolve));
    return {config, calls, messages, controls, preview, hidden, exports, files,
        openBuiltIn: () => listeners.get("[data-wallpaper-built-in]click")(),
        select: (name = "cover_001.webp") => pickerOptions.select(name),
        closePicker: () => pickerOptions.destroyCallback(),
        finishRead: async (fail = false, size = 4) => {
            readFails = fail;
            readSize = size;
            finishRead();
            await settle();
        },
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

test("built-in covers use the same single-file save path and block concurrent changes", async () => {
    const f = fixture();
    f.openBuiltIn();
    f.openBuiltIn();
    assert.deepEqual(f.calls, ["picker"], "repeated clicks share one picker");
    f.select();
    for (const selector of ["[data-wallpaper-upload]", "[data-wallpaper-reset]", "[data-wallpaper-built-in]"]) {
        assert.equal(f.controls.get(selector).disabled, true);
    }
    await f.reset();
    f.openBuiltIn();
    assert.deepEqual(f.calls, ["picker", "read:/appearance/covers/cover_001.webp"]);
    await f.finishRead();
    assert.deepEqual(f.calls.slice(2), ["/api/system/uploadLockScreenWallpaper", "patch:lockScreenWallpaper:true"]);
    assert.equal(f.files[0].name, "cover_001.webp");
    assert.equal(f.files[0].type, "image/webp");
    assert.equal(f.config.appearance.lockScreenWallpaper, true);
    assert.match(f.preview.src, /^\/api\/system\/getLockScreenWallpaper\?v=/);
    assert.equal(f.controls.get("[data-wallpaper-built-in]").disabled, false);
    f.closePicker();
    f.openBuiltIn();
    assert.equal(f.calls.at(-1), "picker");
});

test("failed built-in reads, oversized covers and rejected uploads do not enable a wallpaper", async () => {
    for (const failure of ["read", "size", "upload"]) {
        const f = fixture();
        f.openBuiltIn();
        if (failure === "upload") f.setResponse(-1);
        f.select("cover 2.webp");
        await f.finishRead(failure === "read", failure === "size" ? 10 * 1024 * 1024 + 1 : 4);
        assert.equal(f.calls[1], "read:/appearance/covers/cover%202.webp");
        assert.equal(f.calls.includes("patch:lockScreenWallpaper:true"), false);
        assert.equal(f.config.appearance.lockScreenWallpaper, false);
        assert.deepEqual(f.messages, [failure === "read" ? "operation failed" :
            failure === "size" ? "invalid image" : "upload failed"]);
        assert.equal(f.controls.get("[data-wallpaper-built-in]").disabled, false);
    }
});

test("cancelled built-in selection and readonly settings preserve the wallpaper", () => {
    const f = fixture();
    f.config.appearance.lockScreenWallpaper = true;
    f.openBuiltIn();
    f.closePicker();
    assert.deepEqual(f.calls, ["picker"]);
    assert.equal(f.config.appearance.lockScreenWallpaper, true);
    f.config.readonly = true;
    f.openBuiltIn();
    assert.deepEqual(f.calls, ["picker"]);
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
