import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";
import type {Constants as AppConstants} from "../../constants";

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

const loadZoom = (value: unknown) => {
    const storage: Record<string, unknown> = {};
    const siyuan = {storage};
    const exports: {getLocalStorage?: (cb: () => void) => void} = {};
    runInNewContext(loader, {
        exports,
        Constants,
        window: {siyuan},
        fetchPost: (_url: string, _payload: unknown, cb: (response: {data: Record<string, unknown>}) => void) => {
            cb({data: {[Constants.LOCAL_ZOOM]: value}});
        },
        getDefaultType: () => ({}),
        getDefaultSubType: () => ({}),
        normalizeSearchTypes: (types: unknown) => types,
        sanitizeClosedTabs: (tabs: unknown[]) => tabs,
        setStorageVal: () => assert.fail("Loading zoom must not overwrite persisted data"),
    });
    let loaded = false;
    exports.getLocalStorage(() => {
        loaded = true;
    });
    assert.equal(loaded, true);
    const zoom = siyuan.storage[Constants.LOCAL_ZOOM];
    assert.ok(Constants.SIZE_ZOOM.find(item => item.zoom === zoom)?.position);
    return zoom;
};

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
