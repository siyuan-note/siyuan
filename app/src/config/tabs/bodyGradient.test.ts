import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";
import {IBodyGradient, normalizeBodyGradient} from "../../util/bodyGradient";

test("gradient pushes update existing controls and subsequent edits retain synchronized values", async () => {
    const source = readFileSync(resolve(process.cwd(), "src/config/tabs/bodyGradient.ts"), "utf8");
    const code = transpileModule(source, {compilerOptions: {module: ModuleKind.CommonJS}}).outputText;
    const control = (value: string, type = "select") => ({
        value, type,
        listeners: {} as Record<string, (event?: unknown) => void>,
        addEventListener(event: string, listener: (event?: unknown) => void) {
            this.listeners[event] = listener;
        },
    });
    const mode = control("auto");
    let hidden = true;
    const colors = {classList: {toggle: (_name: string, value: boolean) => { hidden = value; }}};
    const rows = (["light", "dark"] as const).map(theme => {
        const color = control("#9d12e2", "color");
        const opacity = control("12", "range");
        const output = {textContent: "12%"};
        const row = {
            dataset: {gradientTheme: theme}, color, opacity, output,
            querySelector: (selector: string) => selector === "output" ? output : selector.includes("color") ? color : opacity,
        };
        Object.assign(color, {closest: () => row});
        Object.assign(opacity, {closest: () => row});
        return row;
    });
    const element = {
        querySelector: (selector: string) => selector === "[data-gradient-mode]" ? mode : colors,
        querySelectorAll: (selector: string) => selector === "input" ? rows.flatMap(row => [row.color, row.opacity]) : rows,
    };
    const root = {querySelector: () => element};
    const siyuan = {config: {readonly: false, appearance: {bodyGradient: normalizeBodyGradient()}}};
    const saved: IBodyGradient[] = [];
    const acknowledgements: Array<(data: {bodyGradient: IBodyGradient}) => void> = [];
    const completions: Array<() => void> = [];
    const previews: IBodyGradient[] = [];
    const moduleExports: {mountBodyGradient?: (root: unknown) => void; syncBodyGradient?: (config?: IBodyGradient) => void} = {};
    runInNewContext(code, {
        exports: moduleExports,
        window: {siyuan},
        document: {querySelectorAll: () => [element]},
        require: (name: string) => {
            if (name === "../../util/bodyGradient") {
                return {normalizeBodyGradient};
            }
            if (name === "../../util/assets") {
                return {setBodyHighlight: (config: IBodyGradient) => previews.push(structuredClone(config))};
            }
            return {appearanceConfigApi: {patch: (_key: string, config: IBodyGradient,
                                                 onApplied: typeof acknowledgements[number]) => {
                saved.push(config);
                acknowledgements.push(onApplied);
                return new Promise<void>(resolve => completions.push(resolve));
            }}};
        },
    });
    moduleExports.mountBodyGradient(root);
    const modeListener = mode.listeners.change;
    for (const nextMode of ["custom", "off", "auto", "custom"] as const) {
        siyuan.config.appearance.bodyGradient = {
            mode: nextMode,
            light: {color: "#123456", opacity: 25},
            dark: {color: "#abcdef", opacity: 40},
        };
        moduleExports.syncBodyGradient();
        assert.equal(mode.value, nextMode);
        assert.equal(hidden, nextMode !== "custom");
        assert.equal(mode.listeners.change, modeListener);
        assert.equal(rows[0].color.value, "#123456");
        assert.equal(rows[1].opacity.value, "40");
        assert.equal(rows[1].output.textContent, "40%");
    }
    rows[0].opacity.value = "55";
    rows[0].opacity.listeners.input();
    rows[0].opacity.listeners.change();
    assert.equal(previews.at(-1).light.opacity, 55);
    assert.equal(saved.at(-1).light.opacity, 55);
    assert.equal(saved.at(-1).dark.color, "#abcdef");
    mode.value = "off";
    mode.listeners.change({target: mode});
    assert.equal(hidden, true);
    assert.equal(saved.at(-1).mode, "off");
    assert.equal(saved.at(-1).light.opacity, 55);
    assert.equal(saved[0].mode, "custom");

    moduleExports.syncBodyGradient(saved[0]);
    acknowledgements[0]({bodyGradient: saved[0]});
    assert.equal(mode.value, "off");
    assert.equal(hidden, true);
    assert.equal(previews.at(-1).mode, "off");

    acknowledgements[1]({bodyGradient: saved[1]});
    moduleExports.syncBodyGradient({...saved[1], mode: "custom"});
    assert.equal(mode.value, "custom");
    assert.equal(hidden, false);

    rows[0].opacity.value = "75";
    rows[0].opacity.listeners.input();
    moduleExports.syncBodyGradient(saved[0]);
    assert.equal(rows[0].opacity.value, "75");
    assert.equal(previews.at(-1).light.opacity, 75);
    assert.equal(saved[0].light.opacity, 55);
    rows[0].opacity.listeners.change();
    acknowledgements[2]({bodyGradient: saved[2]});
    assert.equal(rows[0].opacity.value, "75");

    rows[0].opacity.value = "90";
    rows[0].opacity.listeners.input();
    rows[0].opacity.listeners.change();
    completions[3]();
    await Promise.resolve();
    assert.equal(rows[0].opacity.value, "25");
    moduleExports.syncBodyGradient({...saved[2], mode: "off"});
    assert.equal(mode.value, "off");
});
