import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isVariableStatement, ScriptTarget, transpileModule} from "typescript";

const source = createSourceFile("protyle.ts", readFileSync(join(__dirname, "protyle.ts"), "utf8"), ScriptTarget.Latest, true);
const declaration = source.statements.filter(isVariableStatement).flatMap(statement =>
    Array.from(statement.declarationList.declarations)).find(item => item.name.getText(source) === "linkMenu");
const code = transpileModule("const linkMenu = " + declaration.initializer.getText(source) + "; linkMenu(protyle, linkElement);",
    {compilerOptions: {target: ScriptTarget.ES2022}}).outputText;

test("link menus show missing targets as empty on desktop and mobile", () => {
    if (typeof Lute === "undefined") {
        require("../../stage/protyle/js/lute/lute.min.js");
    }
    for (const mobile of [false, true]) {
        for (const target of [null, "", "D:\\基线测试\\文档.docx", "file:///D:/baseline/document.txt"]) {
            const inputs = Array.from({length: 3}, () => ({value: "", addEventListener() {}, select() {}}));
            const menu = {remove() {}, append() {}, fullscreen() {}, popup() {}, element: {setAttribute() {}}};
            const linkElement = {getAttribute: (name: string) => name === "data-href" ? target : "",
                textContent: "anchor", getBoundingClientRect: () => ({left: 0, top: 0})};
            runInNewContext(code, {
                Lute, protyle: {lute: {GetLinkDest: () => ""}, element: {}}, linkElement,
                Constants: {MENU_INLINE_A: "a", ZWSP: "\u200b"},
                window: {siyuan: {languages: {}, menus: {menu}}},
                hasClosestBlock: () => ({outerHTML: ""}), hasTopClosestByClassName: (): undefined => undefined,
                hideTooltip() {}, hideElements() {}, isMobile: () => mobile,
                isLocalHTMLAssetPath: () => false, emitOpenMenu() {}, openMenu() {},
                MenuItem: class {
                    element = {};
                    constructor(options: {bind?: (element: unknown) => void}) {
                        options.bind?.({style: {}, querySelectorAll: () => inputs, addEventListener() {}});
                    }
                },
            });
            assert.equal(inputs[0].value, target || "");
            assert.equal(inputs[1].value, "anchor");
        }
    }
});
