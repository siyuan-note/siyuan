import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import * as escape from "../../../util/escape";
import * as dateFormat from "./dateFormat";

// 列头动画只调用转义工具和菜单入口，其余依赖以抛错代理隔离，新增依赖或意外调用都应立即使测试失败。
const loadColModule = () => {
    const methods = {} as {addAttrViewColAnimation: (options: Record<string, unknown>) => void};
    const strictModule = (name: string) => new Proxy({}, {
        get: (_target, member) => {
            if (member === "__esModule") {
                return true;
            }
            throw new Error(`Unexpected dependency use in col.ts: ${name}.${String(member)}`);
        },
    });
    const modules: Record<string, unknown> = {
        "../../../util/escape": escape,
        "./dateFormat": dateFormat,
        "./openMenuPanel": {openMenuPanel: (): void => {}},
    };
    runInNewContext(transpileModule(readFileSync("src/protyle/render/av/col.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText, {
        exports: methods,
        document: {querySelector: (): null => null},
        window: {siyuan: {languages: {}, menus: {menu: {remove: (): void => {}}}}},
        require: (name: string) => modules[name] ?? strictModule(name),
    });
    return methods;
};

// 只模拟表格视图的表头行：复制列时动画通过锚点单元格的 afterend 插入新列。
const insertHeaderCellHTML = (name: string, overrides: Record<string, unknown> = {}) => {
    const inserted: string[] = [];
    const previousCell = {
        insertAdjacentHTML: (position: string, html: string) => {
            assert.equal(position, "afterend");
            inserted.push(html);
        },
    };
    const headerRow = {
        classList: {contains: (className: string) => className === "av__row--header"},
        getAttribute: () => "0",
        querySelector: () => previousCell,
    };
    const blockElement = {
        classList: {contains: (className: string) => className === "av"},
        getAttribute: (attribute: string) => attribute === "data-node-id" ? "20260101000000-doc" : null,
        querySelector: (): null => null,
        querySelectorAll: () => [headerRow],
    };
    loadColModule().addAttrViewColAnimation({
        blockElement,
        protyle: {},
        type: "text",
        name,
        id: "20260101000000-col",
        dateFormat: "full",
        previousID: "20260101000000-prev",
        ...overrides,
    });
    assert.equal(inserted.length, 1, "the header cell must be inserted once");
    return inserted[0];
};

test("addAttrViewColAnimation escapes stored column names in table headers", () => {
    const html = insertHeaderCellHTML('<img src=x onerror="globalThis.__siyuanAVHeaderXss=1">');
    assert.ok(!html.includes("<img"), "column names must not become elements");
    assert.ok(html.includes("&lt;img"), "column names must be escaped as text");
});

test("addAttrViewColAnimation keeps plain column names unchanged", () => {
    assert.ok(insertHeaderCellHTML("优先级").includes(">优先级</span>"));
});

test("addAttrViewColAnimation escapes column metadata in attributes", () => {
    const payload = '" onmouseover="globalThis.__siyuanAVHeaderXss=1';
    const html = insertHeaderCellHTML("Field", {
        id: "col" + payload,
        type: "text" + payload,
        dateFormat: "full" + payload,
    });
    assert.ok(!html.includes('onmouseover="'), "column metadata must not add attributes");
    assert.ok(html.includes("text&quot; onmouseover=&quot;"), "type must be escaped in the attribute value");
});
