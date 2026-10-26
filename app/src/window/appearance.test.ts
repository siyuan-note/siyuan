import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const transpile = (file: string) => transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const load = (code: string, modules: Record<string, unknown>) => {
    const exports = {};
    new Function("exports", "require", code)(exports, (name: string) => modules[name] || {});
    return exports;
};

// 复用真实的紧凑模式判定，避免测试与实现各写一份规则。
const loadAppearance = (compactMode: unknown, frontend = "desktop-window") => {
    const src = join(__dirname, "..");
    const dependencies = {
        "../util/assets": {getThemeColor: (_name: string, fallback: string) => fallback, getThemeMode: () => "light"},
        "../config/tabs/compactMode": load(transpile(join(src, "config/tabs/compactMode.ts")), {
            "../../constants": {Constants: {ATTRIBUTE_UI_DENSITY: "data-ui-density"}},
            "../../util/functions": {getFrontend: () => frontend},
            "./appearanceRuntime": {appearanceConfigApi: {patch: async (): Promise<void> => undefined}},
        }),
    };
    const exports = load(transpile(join(src, "window/appearance.ts")), dependencies) as typeof import("./appearance");
    const saved = new Map(["window", "document"].map(key =>
        [key, Object.getOwnPropertyDescriptor(globalThis, key)] as [string, PropertyDescriptor | undefined]));
    Object.assign(globalThis, {
        window: {siyuan: {config: {appearance: {compactMode}}}},
        document: {documentElement: {getAttribute: (): string | null => null}},
    });
    return {
        getWindowAppearance: exports.getWindowAppearance,
        restore: () => saved.forEach((descriptor, key) => descriptor ?
            Object.defineProperty(globalThis, key, descriptor) : Reflect.deleteProperty(globalThis, key)),
    };
};

test("new windows carry the interface density for the first painted caption", () => {
    for (const [compactMode, expected] of [[true, true], [false, false], [undefined, false], ["true", false]] as const) {
        const f = loadAppearance(compactMode);
        try {
            const appearance = f.getWindowAppearance();
            assert.equal(appearance.compactMode, expected, `compactMode=${JSON.stringify(compactMode)}`);
            assert.equal(appearance.themeMode, "light");
            assert.equal(appearance.backgroundColor, "#ffffff");
            assert.equal(appearance.foregroundColor, "#222222");
        } finally {
            f.restore();
        }
    }
});

test("frontends without the density setting never report compact mode", () => {
    const f = loadAppearance(true, "mobile");
    try {
        assert.equal(f.getWindowAppearance().compactMode, false);
    } finally {
        f.restore();
    }
});
