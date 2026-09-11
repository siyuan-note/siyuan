import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";
import {getBodyGradientImage, normalizeBodyGradient} from "./bodyGradient";

test("未配置的工作空间保留自动渐变", () => {
    assert.equal(getBodyGradientImage(undefined, "light"), "");
    assert.equal(normalizeBodyGradient().mode, "auto");
});

test("明亮与暗黑配色独立保存，零强度不会被替换为默认值", () => {
    const config = normalizeBodyGradient();
    config.mode = "custom";
    config.light = {color: "#ff0000", opacity: 0};
    config.dark = {color: "#0000ff", opacity: 30};
    assert.match(getBodyGradientImage(config, "light"), /rgba\(255, 0, 0, 0\)/);
    assert.match(getBodyGradientImage(config, "dark"), /rgba\(0, 0, 255, 0.3\)/);
    config.mode = "off";
    assert.equal(getBodyGradientImage(config, "light"), "none");
    assert.equal(getBodyGradientImage(config, "dark"), "none");
    config.mode = "custom";
    assert.equal(config.dark.color, "#0000ff");
});

test("非法颜色和强度不会进入背景样式", () => {
    const config = normalizeBodyGradient();
    config.light = {color: "url(example)", opacity: NaN};
    config.dark.opacity = 120;
    const normalized = normalizeBodyGradient(config);
    assert.equal(normalized.light.color, "#9d12e2");
    assert.equal(normalized.light.opacity, 12);
    assert.equal(normalized.dark.opacity, 100);
    config.light.opacity = -10;
    assert.equal(normalizeBodyGradient(config).light.opacity, 0);
});

test("关闭和自定义模式切回自动时恢复工作空间配色", () => {
    const source = readFileSync(resolve(process.cwd(), "src/util/assets.ts"), "utf8");
    const code = transpileModule(source.slice(source.indexOf("export const setBodyHighlight =")), {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText;
    const properties = new Map<string, string>();
    const config = normalizeBodyGradient();
    const moduleExports: {setBodyHighlight?: () => void} = {};
    let theme = "light";
    runInNewContext(code, {
        exports: moduleExports,
        window: {siyuan: {config: {appearance: {bodyGradient: config}}}},
        document: {documentElement: {style: {
            setProperty: (key: string, value: string) => properties.set(key, value),
            removeProperty: (key: string) => properties.delete(key),
        }}},
        getBodyGradientImage,
        getThemeMode: () => theme,
        getWorkspaceName: () => "SiYuan",
    });
    moduleExports.setBodyHighlight();
    assert.equal(properties.get("--b3-body-background-hl"), "280, 85%, 48%");
    config.mode = "off";
    moduleExports.setBodyHighlight();
    assert.equal(properties.get("--b3-body-background-gradient"), "none");
    config.mode = "custom";
    config.dark = {color: "#ffffff", opacity: 20};
    theme = "dark";
    moduleExports.setBodyHighlight();
    assert.match(properties.get("--b3-body-background-gradient"), /rgba\(255, 255, 255, 0.2\)/);
    config.mode = "auto";
    moduleExports.setBodyHighlight();
    assert.equal(properties.has("--b3-body-background-gradient"), false);
    assert.equal(properties.get("--b3-body-background-hl"), "280, 85%, 48%");
});
