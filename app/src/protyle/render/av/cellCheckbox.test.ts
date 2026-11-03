import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import * as capabilities from "./capabilities";
import * as cellValue from "./cellValue";
import * as locationValue from "./locationValue";
import * as escape from "../../../util/escape";

// checkbox 分支只依赖转义工具，其余依赖以严格代理隔离，新增依赖或意外调用都应立即使测试失败。
const unusedDependencies = [
    "./viewType", "./renderData", "../../wysiwyg/transaction", "../../util/hasClosest", "./openMenuPanel",
    "./action", "../../util/compatibility", "../../../util/fetch", "../../util/selection", "../../util/selectionOffsets",
    "dayjs", "../../../emoji", "./col", "./attributeValue", "../../../constants", "../../hint/extend",
    "../../../util/pathName", "./select", "../../undo", "./dateFormat", "./row", "./view", "../../../util/image",
    "../../../util/imageURL", "../../../mobile/util/mobileAppUtil", "../../../mobile/util/keyboardToolbar",
    "../../../util/setPosition", "./selectionState", "./color", "./richText", "./richTextEditor", "./virtualScroll",
    "./cellEditor", "./blockIcon", "../../../dialog/anchoredInputPosition", "./locationEditor", "../../../dialog/message",
    "../../../util/hostCapabilities", "../../../plugin/Menu", "../../../util/upDownHint", "./richTextValue",
    "../../../emoji/fileTreeIcon", "./lunarDate", "./batchValue", "./dragFillValue", "./host",
];

const loadModule = <T>(file: string) => {
    const methods = {} as T;
    const modules: Record<string, unknown> = {
        ...Object.fromEntries(unusedDependencies.map(name => [name, new Proxy({}, {
            get: (_target, member) => {
                if (member === "__esModule") return true;
                if (member === "default") return modules[name];
                throw new Error(`Unexpected dependency use in ${file}: ${name}.${String(member)}`);
            },
        })])),
        "./capabilities": capabilities,
        "./cellValue": cellValue,
        "./locationValue": locationValue,
        "../../../util/functions": {objEquals: (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)},
        "../../../util/escape": escape,
    };
    runInNewContext(transpileModule(readFileSync(`src/protyle/render/av/${file}.ts`, "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText, {
        exports: methods,
        window: {siyuan: {languages: {empty: "Empty", copy: "Copy"}}},
        require: (name: string) => {
            assert.ok(Object.prototype.hasOwnProperty.call(modules, name), `Unexpected dependency in ${file}: ${name}`);
            return modules[name];
        },
    });
    return methods;
};

const cell = loadModule<typeof import("./cell")>("cell");

test("Gallery 和 Kanban 的 checkbox 列名按文本转义", () => {
    const payload = "<img src=x onerror=\"alert(1)\">";
    const value = {type: "checkbox", checkbox: {checked: true, content: payload}} as IAVCellValue;
    for (const type of ["gallery", "kanban"] as TAVView[]) {
        const html = cell.renderCell(value, 0, false, type);
        assert.doesNotMatch(html, /<img/, `${type} 未转义 checkbox 内容`);
        assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/, `${type} 未输出转义后的内容`);
    }
});

test("表格类布局不输出 checkbox 内容", () => {
    const value = {type: "checkbox", checkbox: {checked: true, content: "<img src=x onerror=\"alert(1)\">"}} as IAVCellValue;
    for (const type of ["table", "list", "calendar"] as TAVView[]) {
        const html = cell.renderCell(value, 0, false, type);
        assert.doesNotMatch(html, /alert\(1\)/, `${type} 输出了 checkbox 内容`);
    }
});

test("checkbox 内容中的普通实体字符仍按文本显示", () => {
    const value = {type: "checkbox", checkbox: {checked: false, content: "A & B < C"}} as IAVCellValue;
    const html = cell.renderCell(value, 0, false, "gallery");
    assert.match(html, /A &amp; B &lt; C/);
});
