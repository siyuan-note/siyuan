import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";
import type {Constants as AppConstants} from "../../constants";
import {createDefaultMobileBottomBarConfig, normalizeMobileBottomBarConfig} from "../../mobile/util/mobileBottomBarConfig";
import {createDefaultMobileBarsConfig, MOBILE_BARS_CONFIG_KEY, resolveMobileSidebarConfig} from "../../mobile/util/mobileBarsConfig";

const constantsExports: {Constants?: typeof AppConstants} = {};
runInNewContext(transpileModule(readFileSync(resolve("src/constants.ts"), "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS},
}).outputText, {exports: constantsExports, SIYUAN_VERSION: "test", NODE_ENV: "test"});
const Constants = constantsExports.Constants;

// 单独执行真实的存储加载函数，隔离编辑器和原生窗口依赖。
const source = readFileSync(resolve("src/protyle/util/compatibility.ts"), "utf8");
const loader = transpileModule(source.slice(source.indexOf("export const getLocalStorage ="),
    source.indexOf("export const isSensitiveSearchConfig =")), {
    compilerOptions: {module: ModuleKind.CommonJS},
}).outputText;

const loadStorage = (values: Record<string, unknown>) => {
    const storage: Record<string, unknown> = {};
    const siyuan = {storage};
    const exports: {getLocalStorage?: (cb: () => void) => void} = {};
    runInNewContext(loader, {
        exports,
        Constants,
        window: {siyuan},
        fetchPost: (_url: string, _payload: unknown, cb: (response: {data: Record<string, unknown>}) => void) => {
            cb({data: values});
        },
        getDefaultType: () => ({}),
        getDefaultSubType: () => ({}),
        createDefaultMobileBottomBarConfig,
        createDefaultMobileBarsConfig,
        MOBILE_BARS_CONFIG_KEY,
        normalizeSearchTypes: (types: unknown) => types,
        sanitizeClosedTabs: (tabs: unknown[]) => tabs,
        setStorageVal: () => assert.fail("Loading storage must not overwrite persisted data"),
    });
    let loaded = false;
    exports.getLocalStorage(() => {
        loaded = true;
    });
    assert.equal(loaded, true);
    return siyuan.storage;
};

const loadZoom = (value: unknown) => {
    const storage = loadStorage({[Constants.LOCAL_ZOOM]: value});
    const zoom = storage[Constants.LOCAL_ZOOM];
    assert.ok(Constants.SIZE_ZOOM.find(item => item.zoom === zoom)?.position);
    return zoom;
};

test("fresh or reset mobile preferences enable sidebar buttons alongside swipe", () => {
    const first = loadStorage({})[MOBILE_BARS_CONFIG_KEY];
    const second = loadStorage({})[MOBILE_BARS_CONFIG_KEY];
    assert.deepEqual(first, createDefaultMobileBarsConfig());
    assert.deepEqual(resolveMobileSidebarConfig(first as ReturnType<typeof createDefaultMobileBarsConfig>), {sidebarSwipe: true, sidebarButtons: true});
    assert.notEqual(first, second);
});

test("startup preserves legacy and explicit sidebar choices in object and serialized storage", () => {
    for (const persisted of [
        {autoHide: false},
        {autoHide: false, sidebarSwipe: true, sidebarButtons: false},
        {autoHide: false, sidebarSwipe: true, sidebarButtons: true},
        {autoHide: false, sidebarSwipe: false, sidebarButtons: true},
    ]) {
        for (const value of [persisted, JSON.stringify(persisted)]) {
            const loaded = loadStorage({[MOBILE_BARS_CONFIG_KEY]: value})[MOBILE_BARS_CONFIG_KEY];
            assert.equal(JSON.stringify(loaded), JSON.stringify(persisted));
            assert.deepEqual(resolveMobileSidebarConfig(loaded as typeof persisted), resolveMobileSidebarConfig(persisted));
        }
    }
});

test("malformed legacy mobile preferences retain safe swipe access", () => {
    for (const value of [null, "null", "invalid", "false", "{}", "[]"]) {
        const loaded = loadStorage({[MOBILE_BARS_CONFIG_KEY]: value})[MOBILE_BARS_CONFIG_KEY];
        assert.deepEqual(resolveMobileSidebarConfig(loaded as Parameters<typeof resolveMobileSidebarConfig>[0]), {sidebarSwipe: true, sidebarButtons: false});
    }
});

test("startup storage uses the current mobile bottom bar default without sharing mutable slots", () => {
    const first = loadStorage({})[Constants.LOCAL_MOBILE_BOTTOM_BAR];
    const second = loadStorage({})[Constants.LOCAL_MOBILE_BOTTOM_BAR];
    assert.deepEqual(first, createDefaultMobileBottomBarConfig());
    assert.deepEqual(normalizeMobileBottomBarConfig(first), createDefaultMobileBottomBarConfig());
    assert.notEqual(first, second);
    assert.notEqual((first as {actions: readonly unknown[]}).actions, (second as {actions: readonly unknown[]}).actions);
});

test("startup storage preserves legacy mobile bottom bar preferences for migration", () => {
    for (const actions of [["documents", "search", "newDoc", "tabs"], ["recent", "outline", "bookmark", "tag"]]) {
        const persisted = {version: 1, actions};
        const loaded = loadStorage({[Constants.LOCAL_MOBILE_BOTTOM_BAR]: JSON.stringify(persisted)})[Constants.LOCAL_MOBILE_BOTTOM_BAR];
        assert.equal(JSON.stringify(loaded), JSON.stringify(persisted));
        assert.deepEqual(normalizeMobileBottomBarConfig(loaded), normalizeMobileBottomBarConfig(persisted));
    }
});

test("startup storage preserves every supported zoom level", () => {
    for (const {zoom} of Constants.SIZE_ZOOM) {
        assert.equal(loadZoom(JSON.stringify(zoom)), zoom);
    }
});

test("startup storage restores default zoom for retired zoom levels", () => {
    // 旧版缩放档位包括 25%、33% 和 50%，窗口按钮位置表只覆盖当前档位。
    for (const zoom of [0.25, 0.33, 0.5]) {
        assert.equal(loadZoom(JSON.stringify(zoom)), 1);
    }
});

test("startup storage restores default zoom for absent or malformed values", () => {
    for (const value of [undefined, null, "null", "false", "{}", "[]", '"1"', "invalid", "0", "-1", "4"]) {
        assert.equal(loadZoom(value), 1);
    }
});
