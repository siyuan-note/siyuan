import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";
import {entryCatalog, TOP_BAR_ROOT_PATH} from "./catalog";
import {MOBILE_TOOLBAR_NAMES, TOOLBAR_ENTRY_ROOT_PATH} from "../../protyle/toolbar/defaults";

test("entry settings show exit only on native tablets without changing the persisted catalog", () => {
    const source = readFileSync(resolve(process.cwd(), "src/config/entryVisibility/ui.ts"), "utf8");
    const compiled = transpileModule(source + "\nexports.catalog = getVisibleEntryCatalog;", {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText;
    let nativeTablet = false;
    let mobile = false;
    const exports = {} as {catalog: () => typeof entryCatalog};
    runInNewContext(compiled, {
        exports,
        require: () => ({
            entryCatalog, TOP_BAR_ROOT_PATH, MOBILE_TOOLBAR_NAMES, TOOLBAR_ENTRY_ROOT_PATH,
            isMobile: () => mobile,
            isInMobileApp: () => nativeTablet,
            DOCK_ORDER_SCOPES_BY_SIDE: {},
        }),
    });
    const hasExit = (catalog: typeof entryCatalog) => catalog.find(item => item.key === TOP_BAR_ROOT_PATH)
        .children.some(item => item.key === "barExit");
    assert.equal(hasExit(exports.catalog()), false);
    assert.equal(hasExit(entryCatalog), true);
    nativeTablet = true;
    assert.equal(hasExit(exports.catalog()), true);
    mobile = true;
    const catalog = exports.catalog();
    assert.deepEqual(Array.from(catalog, item => item.key), [TOOLBAR_ENTRY_ROOT_PATH, "editor.slash"]);
    assert.equal(catalog[1], entryCatalog.find(item => item.key === "editor.slash"));
    assert.ok(catalog[0].children.every(item => item.type === "separator" || MOBILE_TOOLBAR_NAMES.includes(item.key)));
});
