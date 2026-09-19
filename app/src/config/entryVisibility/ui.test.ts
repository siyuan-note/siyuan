import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";
import {entryCatalog, TOP_BAR_ROOT_PATH} from "./catalog";

test("entry settings show exit only on native tablets without changing the persisted catalog", () => {
    const source = readFileSync(resolve(process.cwd(), "src/config/entryVisibility/ui.ts"), "utf8");
    const compiled = transpileModule(source + "\nexports.catalog = getVisibleEntryCatalog;", {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText;
    let nativeTablet = false;
    const exports = {} as {catalog: () => typeof entryCatalog};
    runInNewContext(compiled, {
        exports,
        require: () => ({
            entryCatalog, TOP_BAR_ROOT_PATH,
            isMobile: () => false,
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
});
