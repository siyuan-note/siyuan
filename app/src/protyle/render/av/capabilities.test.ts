import * as assert from "node:assert/strict";
import {readFileSync, readdirSync} from "node:fs";
import * as path from "node:path";
import {test} from "node:test";
import * as ts from "typescript";
import {AV_KEY_CAPABILITIES, AV_KEY_TYPES} from "./capabilities.generated";
import {
    AV_DATE_TYPES, getAVDefaultFilterOperator, getAVKeyCapability, hasAVAttributePlaceholder, hasAVCapability,
    hasAVScalarContent, isAVDateType, isAVLinkType, isAVNewItemTemplateType, isAVReadonlyType, isAVRichTextType,
    isAVSelectType, isAVTextType, isAVTimestampType, usesAVRollupCellRenderer,
} from "./capabilities";

test("field capability groups preserve supported field behavior", () => {
    const groups: Array<[string, (type: string) => boolean, string[]]> = [
        ["date", isAVDateType, ["date", "created", "updated"]],
        ["select", isAVSelectType, ["select", "mSelect"]],
        ["text", isAVTextType, ["text", "block", "url", "email", "phone", "template"]],
        ["timestamp", isAVTimestampType, ["created", "updated"]],
        ["readonly", isAVReadonlyType, ["created", "updated", "template", "rollup", "lineNumber"]],
        ["rich text", isAVRichTextType, ["text", "block", "email", "phone", "template"]],
        ["link", isAVLinkType, ["block", "url", "email", "phone"]],
        ["scalar content", hasAVScalarContent, ["number", "text", "block", "url", "phone", "email", "template", "mAsset"]],
        ["attribute placeholder", hasAVAttributePlaceholder, ["text", "number", "date", "url", "phone", "template", "email", "location"]],
        ["rollup cell", usesAVRollupCellRenderer, ["template", "select", "mSelect", "mAsset", "relation", "location"]],
        ["template fields", isAVNewItemTemplateType, ["text", "number", "date", "select", "mSelect", "url", "email", "phone", "mAsset", "checkbox", "relation", "location"]],
    ];
    for (const [name, predicate, expected] of groups) {
        for (const type of [...AV_KEY_TYPES, "unknown", undefined, null]) {
            assert.equal(predicate(type), expected.includes(type), `${name}: ${type}`);
        }
    }
    assert.deepEqual(AV_DATE_TYPES, ["date", "created", "updated"]);
    for (const type of AV_KEY_TYPES) {
        const computed = ["created", "updated", "template", "rollup", "lineNumber"].includes(type);
        assert.equal(hasAVCapability(type, "editable"), !computed, type);
        assert.equal(hasAVCapability(type, "filterable"), type !== "lineNumber", type);
        assert.equal(hasAVCapability(type, "sortable"), type !== "lineNumber", type);
        assert.equal(hasAVCapability(type, "groupable"), type !== "lineNumber" && type !== "rollup" && type !== "location", type);
        const expected = type === "lineNumber" ? undefined : type === "relation" ? "Contains any item" :
            ["select", "number", "date", "created", "updated", "checkbox"].includes(type) ? "=" : "Contains";
        assert.equal(getAVDefaultFilterOperator(type), expected, type);
    }
    assert.equal(getAVDefaultFilterOperator("relation", true), "Contains");
    assert.equal(getAVKeyCapability("unknown"), undefined);
    assert.equal(hasAVCapability(undefined, "editable"), false);
    assert.equal(AV_KEY_TYPES.length, Object.keys(AV_KEY_CAPABILITIES).length);
});

test("field membership decisions use declared capabilities", () => {
    const root = __dirname;
    const fields = new Set<string>(AV_KEY_TYPES);
    const violations: string[] = [];
    const inspectDirectory = (dir: string) => {
        for (const entry of readdirSync(dir, {withFileTypes: true})) {
            const file = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                inspectDirectory(file);
                continue;
            }
            if (!file.endsWith(".ts") || file.endsWith(".test.ts") || file.endsWith(".generated.ts")) {
                continue;
            }
            const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
            const visit = (node: ts.Node) => {
                if (ts.isArrayLiteralExpression(node) && node.elements.length &&
                    node.elements.every(item => ts.isStringLiteral(item) && fields.has(item.text))) {
                    // 菜单面板标识与字段类型独立，允许其按面板名称判断布局。
                    const menuPanel = entry.name === "openMenuPanel.ts" && node.parent.parent.getText(source).includes("options.type");
                    if (!menuPanel) {
                        violations.push(`${path.relative(root, file)}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`);
                    }
                }
                ts.forEachChild(node, visit);
            };
            visit(source);
        }
    };
    inspectDirectory(root);
    assert.deepEqual(violations, []);
});
