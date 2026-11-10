import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import test from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";
import {IBodyGradient, normalizeBodyGradient} from "../../util/bodyGradient";

const setup = () => {
    const control = (value = "") => ({value, textContent: "", listeners: {} as Record<string, (event?: unknown) => void>,
        addEventListener(event: string, listener: (event?: unknown) => void) { this.listeners[event] = listener; }});
    const mode = control();
    let hidden = false;
    const colors = {classList: {toggle: (_name: string, value: boolean) => { hidden = value; }}};
    const rows = (["light", "dark"] as const).map(theme => {
        const color = control(); const opacity = control(); const output = {textContent: ""};
        return {dataset: {gradientTheme: theme}, color, opacity, output,
            querySelector: (selector: string) => selector === "[data-gradient-color]" ? color : selector === "output" ? output : opacity};
    });
    const element = {isConnected: true, querySelector: (selector: string) => selector === "[data-gradient-mode]" ? mode : colors,
        querySelectorAll: () => rows};
    const siyuan = {config: {readonly: false, appearance: {bodyGradient: normalizeBodyGradient()}}, languages: {color: "Color"}};
    const saved: {path: string; value: string | number; complete: (ok?: boolean) => void}[] = [];
    const previews: IBodyGradient[] = [];
    const pickers: {options: any; finish: (result: unknown) => void}[] = [];
    const exports = {} as typeof import("./bodyGradient");
    runInNewContext(transpileModule(readFileSync(resolve("src/config/tabs/bodyGradient.ts"), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText, {exports, window: {siyuan}, document: {querySelectorAll: () => [element]},
        require: (name: string) => {
            if (name.endsWith("/bodyGradient")) return {normalizeBodyGradient};
            if (name.endsWith("/assets")) return {setBodyHighlight: (value: IBodyGradient) => previews.push(structuredClone(value))};
            if (name.endsWith("/colorPicker")) return {openInternalColorPicker: (options: unknown) => ({
                result: new Promise(finish => pickers.push({options, finish})),
            })};
            return {appearanceConfigApi: {patch: (path: string, value: string | number) => new Promise<void>((done, failed) => {
                saved.push({path, value, complete: (ok = true) => {
                    if (!ok) { failed(new Error("Save failed")); return; }
                    const parts = path.split(".").slice(1);
                    const config = siyuan.config.appearance.bodyGradient;
                    if (parts.length === 1) config.mode = value as IBodyGradient["mode"];
                    else if (parts[1] === "color") config[parts[0] as "light" | "dark"].color = value as string;
                    else config[parts[0] as "light" | "dark"].opacity = value as number;
                    done();
                }});
            })}};
        }});
    exports.mountBodyGradient({querySelector: () => element} as any);
    const push = (value: IBodyGradient) => { siyuan.config.appearance.bodyGradient = value; exports.syncBodyGradient(); };
    return {mode, rows, element, siyuan, saved, previews, pickers, push,
        sync: () => exports.syncBodyGradient(), get hidden() { return hidden; },
        flush: () => new Promise<void>(done => setImmediate(done))};
};

test("gradient pushes keep controls current and color cancellation restores the latest confirmed configuration", async () => {
    const h = setup();
    for (const mode of ["auto", "custom", "off"] as const) {
        h.push({...normalizeBodyGradient(), mode, dark: {color: "#abcdef", opacity: 40}});
        assert.equal(h.mode.value, mode); assert.equal(h.hidden, mode !== "custom");
        assert.equal(h.rows[1].color.textContent, "#abcdef"); assert.equal(h.rows[1].opacity.value, "40");
    }
    h.rows[0].color.listeners.click();
    const picker = h.pickers[0];
    picker.options.onPreview({hex: "#123456"});
    assert.equal(h.previews.at(-1).light.color, "#123456");
    assert.equal(h.siyuan.config.appearance.bodyGradient.light.color, "#9d12e2");
    assert.equal(h.saved.length, 0);
    h.push({mode: "custom", light: {color: "#654321", opacity: 25}, dark: {color: "#112233", opacity: 60}});
    assert.equal(h.previews.at(-1).light.color, "#123456");
    assert.equal(h.previews.at(-1).dark.color, "#112233");
    picker.options.onPreviewEnd(); picker.finish({type: "cancel"}); await h.flush();
    assert.equal(h.previews.at(-1).light.color, "#654321");
    assert.equal(h.saved.length, 0);
});

test("gradient color, strength and mode save only their own fields and stale completions preserve newer drafts", async () => {
    const h = setup();
    h.push({...normalizeBodyGradient(), mode: "custom"});
    h.rows[0].opacity.value = "55"; h.rows[0].opacity.listeners.input(); h.rows[0].opacity.listeners.change();
    h.rows[0].color.listeners.click();
    h.pickers[0].finish({type: "confirm", changed: true, value: {hex: "#123456"}}); await h.flush();
    h.mode.value = "off"; h.mode.listeners.change({target: h.mode});
    assert.deepEqual(h.saved.map(item => [item.path, item.value]), [
        ["bodyGradient.light.opacity", 55], ["bodyGradient.light.color", "#123456"], ["bodyGradient.mode", "off"],
    ]);
    h.rows[0].opacity.value = "75"; h.rows[0].opacity.listeners.input();
    h.saved[0].complete(); await h.flush();
    assert.equal(h.rows[0].opacity.value, "75");
    assert.equal(h.previews.at(-1).mode, "off");
    h.rows[0].opacity.listeners.change(); h.saved[3].complete(); await h.flush();
    assert.equal(h.rows[0].opacity.value, "75");
    h.saved[1].complete(false); h.saved[2].complete(); await h.flush();
    assert.equal(h.previews.at(-1).light.color, "#9d12e2");
    assert.equal(h.previews.at(-1).light.opacity, 75);
    assert.equal(h.previews.at(-1).mode, "off");
});

test("unchanged colors, readonly transitions and removed settings targets do not persist picker results", async () => {
    for (const invalidation of ["unchanged", "readonly", "removed"]) {
        const h = setup(); h.rows[0].color.listeners.click();
        if (invalidation === "readonly") h.siyuan.config.readonly = true;
        if (invalidation === "removed") h.element.isConnected = false;
        h.pickers[0].finish({type: "confirm", changed: invalidation !== "unchanged", value: {hex: "#123456"}});
        await h.flush(); assert.equal(h.saved.length, 0);
    }
});
