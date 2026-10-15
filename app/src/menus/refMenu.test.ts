import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isVariableStatement, ScriptTarget, transpileModule} from "typescript";

const {parse} = require("ifdef-loader/preprocessor");

const setup = (mobile: boolean, disabled = false) => {
    const source = createSourceFile("protyle.ts", parse(readFileSync(join(__dirname, "protyle.ts"), "utf8"),
        {MOBILE: mobile, BROWSER: true}, false, true, "protyle.ts"), ScriptTarget.Latest, true);
    const declaration = source.statements.filter(isVariableStatement).flatMap(statement =>
        Array.from(statement.declarationList.declarations)).find(item => item.name.getText(source) === "refMenu");
    const code = transpileModule("const refMenu = " + declaration.initializer.getText(source) + "; refMenu(protyle, element);",
        {compilerOptions: {target: ScriptTarget.ES2022}}).outputText;
    const events: string[] = [];
    const items: IMenu[] = [];
    const transactions: string[] = [];
    const listeners = new Map<string, () => void>();
    const input = {value: "", select: () => events.push("select"),
        addEventListener: (type: string, listener: () => void) => listeners.set(type, listener)};
    const attributes = new Map([["data-id", "target"], ["data-subtype", "d"]]);
    const element = {innerHTML: "Reference", textContent: "Reference",
        parentElement: {textContent: "Text before Reference", tagName: "DIV"},
        getAttribute: (name: string) => attributes.get(name),
        setAttribute: (name: string, value: string) => attributes.set(name, value),
        getBoundingClientRect: () => ({left: 10, top: 20})};
    const block = {get outerHTML() { return `<div>${element.innerHTML}</div>`; },
        getAttribute: () => "source", setAttribute() {}};
    const menu = {element: {setAttribute() {}, querySelector: () => {
        assert.ok(!disabled, "Readonly menus have no anchor input");
        return input;
    }}, remove() {}, append: (item: IMenu) => items.push(item),
    fullscreen: () => events.push("fullscreen"), popup: () => events.push("popup"), removeCB: undefined as (() => void)};
    const protyle = {disabled, lite: true, app: {}, element: {}, toolbar: {range: {}}};
    const keymap = Object.fromEntries(["openBy", "refTab", "insertRight", "insertBottom", "backlinks", "graphView"]
        .map(name => [name, {custom: ""}]));
    runInNewContext(code, {
        protyle, element, isMobile: () => mobile,
        Constants: {MENU_INLINE_REF: "ref", ATTRIBUTE_MENU_KEYMAP: "data-keymap"},
        window: {siyuan: {languages: {}, menus: {menu}, config: {keymap: {editor: {general: keymap}}}}},
        hasClosestBlock: () => block, hasTopClosestByClassName: (): undefined => undefined,
        hideElements() {}, emitOpenMenu() {}, updateHotkeyTip: (value: string) => value,
        escapeHtmlTextAndAttr: (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"),
        updateTransaction: (_protyle: unknown, _block: unknown, previous: string) => transactions.push(previous),
        getSelection: () => ({rangeCount: 0}), dayjs: () => ({format: () => "20261007100000"}),
        openMobileReference: (source: unknown, id: string) => {
            assert.equal(source, protyle);
            assert.equal(id, "target");
            events.push("reference");
        },
        MenuItem: class {
            element: IMenu;
            constructor(options: IMenu) {
                this.element = options;
                options.bind?.({querySelector: () => input} as unknown as HTMLElement);
            }
        },
    });
    return {events, items, input, listeners, menu, transactions, element, attributes};
};

for (const mobile of [false, true]) {
    for (const disabled of [false, true]) {
        test(`reference menu preserves keyboard intent (${mobile ? "mobile" : "desktop"}, ${disabled ? "readonly" : "editable"})`, () => {
            const fixture = setup(mobile, disabled);
            assert.deepEqual(fixture.events, [mobile ? "fullscreen" : "popup", ...!mobile && !disabled ? ["select"] : []]);
            assert.equal(fixture.items.some(item => item.id === "anchor"), !disabled);
            assert.equal(typeof fixture.menu.removeCB, disabled ? "undefined" : "function");
            if (mobile) {
                fixture.items.find(item => item.id === "viewRefContent").click(null, null);
                assert.equal(fixture.events.at(-1), "reference");
            }
        });
    }
}

test("mobile anchor edits still commit when the reference menu closes", () => {
    const fixture = setup(true);
    fixture.input.value = "Edited <anchor>";
    fixture.listeners.get("input")();
    assert.equal(fixture.element.innerHTML, "Edited &lt;anchor&gt;");
    assert.equal(fixture.attributes.get("data-subtype"), "s");
    assert.deepEqual(fixture.transactions, []);
    fixture.menu.removeCB();
    assert.deepEqual(fixture.transactions, ["<div>Reference</div>"]);
    assert.ok(!fixture.events.includes("select"));
});
