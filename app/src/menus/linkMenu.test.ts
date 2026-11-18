import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isVariableStatement, ScriptTarget, transpileModule} from "typescript";
import {escapeHtmlTextAndAttr} from "../util/escape";
import {getBlockLinkID} from "../util/nodeID";

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
                Lute, getBlockLinkID, protyle: {lute: {GetLinkDest: () => ""}, element: {}}, linkElement,
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

test("closing link menus preserves database parameters and edited literal attribute characters", () => {
    if (typeof Lute === "undefined") {
        require("../../stage/protyle/js/lute/lute.min.js");
    }
    for (const mobile of [false, true]) {
        const address = "siyuan://blocks/20261117232737-eoabkc3?avViewID=view&avItemID=item&avStandalone=1";
        const title = 'A & B <title> "quoted"';
        const attributes = new Map([["data-href", address], ["data-title", title], ["data-type", "a"]]);
        const linkElement = {getAttribute: (name: string) => attributes.get(name) || "",
            setAttribute: (name: string, value: string) => attributes.set(name, value),
            removeAttribute: (name: string) => attributes.delete(name),
            textContent: "anchor", getBoundingClientRect: () => ({left: 0, top: 0})};
        const inputs = Array.from({length: 3}, () => ({value: "", addEventListener() {}, select() {}}));
        const menu = {remove() {}, removeCB: (): void => {}, append() {}, fullscreen() {}, popup() {},
            element: {setAttribute() {}}};
        let updates = 0;
        runInNewContext(code, {
            Lute, getBlockLinkID, protyle: {lute: {GetLinkDest: () => ""}, element: {}}, linkElement,
            Constants: {MENU_INLINE_A: "a", ZWSP: "\u200b"},
            window: {siyuan: {languages: {}, menus: {menu}}},
            hasClosestBlock: () => ({get outerHTML() {return JSON.stringify([...attributes]);}, setAttribute() {}}),
            hasTopClosestByClassName: (): undefined => undefined,
            hideTooltip() {}, hideElements() {}, isMobile: () => mobile,
            isLocalHTMLAssetPath: () => false, emitOpenMenu() {}, openMenu() {},
            getSelection: () => ({rangeCount: 0}), escapeHtmlTextAndAttr,
            updateTransaction: () => updates++, dayjs: () => ({format: () => "20261118010000"}),
            MenuItem: class {
                element = {};
                constructor(options: {bind?: (element: unknown) => void}) {
                    options.bind?.({style: {}, querySelectorAll: () => inputs, addEventListener() {}});
                }
            },
        });
        menu.removeCB();
        assert.equal(attributes.get("data-href"), address);
        assert.equal(attributes.get("data-title"), title);
        assert.equal(updates, 0, "opening and closing a menu does not mutate the link");
        inputs[0].value = 'https://example.com/?a=1&b="two"<three>';
        inputs[2].value = title + " edited";
        menu.removeCB();
        assert.equal(attributes.get("data-href"), inputs[0].value);
        assert.equal(attributes.get("data-title"), inputs[2].value);
        assert.equal(updates, 1);
    }
});

test("only complete block links can become references, including after editing the destination", () => {
    if (typeof Lute === "undefined") {
        require("../../stage/protyle/js/lute/lute.min.js");
    }
    const id = "20261117232737-eoabkc3";
    for (const mobile of [false, true]) {
        for (const target of [`siyuan://blocks/${id}`, `siyuan://blocks/${id}?avViewID=view&avItemID=item`,
            `siyuan://blocks/${id}#fragment`, `siyuan://blocks/${id}/child`, "siyuan://blocks/invalid",
            `siyuan://blocks/${id}\n`]) {
            const items = new Map<string, {click?: () => void}>();
            const attributes = new Map([["data-href", target], ["data-type", "a"]]);
            const inputs = Array.from({length: 3}, () => ({value: "", addEventListener() {}, select() {}}));
            const menu = {remove() {}, append() {}, fullscreen() {}, popup() {}, element: {setAttribute() {}}};
            const linkElement = {getAttribute: (name: string) => attributes.get(name) || "",
                setAttribute: (name: string, value: string) => attributes.set(name, value),
                removeAttribute: (name: string) => attributes.delete(name),
                textContent: "anchor", getBoundingClientRect: () => ({left: 0, top: 0})};
            runInNewContext(code, {
                Lute, getBlockLinkID, protyle: {lute: {GetLinkDest: () => ""}, element: {},
                    toolbar: {range: {selectNode() {}, collapse() {}}}}, linkElement,
                Constants: {MENU_INLINE_A: "a", ZWSP: "\u200b"},
                window: {siyuan: {languages: {}, menus: {menu}}},
                hasClosestBlock: () => ({outerHTML: "", setAttribute() {}}),
                hasTopClosestByClassName: (): undefined => undefined,
                hideTooltip() {}, hideElements() {}, isMobile: () => mobile,
                isLocalHTMLAssetPath: () => false, emitOpenMenu() {}, openMenu() {},
                updateTransaction() {}, focusByRange() {}, dayjs: () => ({format: () => "20261118010000"}),
                MenuItem: class {
                    element = {};
                    constructor(options: {id: string, click?: () => void, bind?: (element: unknown) => void}) {
                        items.set(options.id, options);
                        options.bind?.({style: {}, querySelectorAll: () => inputs, addEventListener() {}});
                    }
                },
            });
            const convert = items.get("turnIntoRef");
            assert.equal(!!convert, target === `siyuan://blocks/${id}`);
            if (convert) {
                inputs[0].value += "?avItemID=item";
                convert.click();
                assert.equal(attributes.get("data-type"), "a");
                inputs[0].value = `siyuan://blocks/${id}`;
                convert.click();
                assert.equal(attributes.get("data-type"), "block-ref");
                assert.equal(attributes.get("data-id"), id);
                assert.equal(attributes.has("data-href"), false);
            }
        }
    }
});
