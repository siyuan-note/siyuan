import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {createSourceFile, isVariableStatement, ScriptTarget, transpileModule} from "typescript";
import {loadModule} from "../../testSupport/loadModule";
import {TABLE_CELL_SLASH_IDS} from "../util/tableCellRichMenu";
import {resolveSlashMenuItems} from "./slashMenu";
import {rankFrequentSlashItems} from "./frequentSlash";
import {TITLE_INLINE_SLASH_IDS} from "./titleSlash";

class TestElement {
    constructor(public selector: string, public parentElement?: TestElement) {}

    public closest(selector: string): TestElement | undefined {
        return this.selector === selector ? this : this.parentElement?.closest(selector);
    }
}

const inlineIDs = ["ref", "emoji", "link", "bold", "italic", "underline", "strike", "mark", "sup", "sub",
    "inlineCode", "kbd", "tag", "inlineMath"];

const setup = () => {
    let focusNode: TestElement | {parentElement: TestElement};
    const getSelection = () => ({focusNode});
    const {isTitleSlashContext} = loadModule<typeof import("./titleSlash")>("src/protyle/hint/titleSlash.ts", {
        getSelection, Element: TestElement,
    });
    const source = createSourceFile("extend.ts", readFileSync("src/protyle/hint/extend.ts", "utf8"), ScriptTarget.Latest, true);
    const declaration = (name: string) => source.statements.find(statement => isVariableStatement(statement) &&
        statement.declarationList.declarations.some(item => item.name.getText(source) === name)).getText(source);
    const candidates = Array.from(declaration("getBuiltinSlashMenuItems").matchAll(/id: "([^"]+)"/g), match => ({
        id: match[1], value: match[1], filter: [match[1]], html: match[1].startsWith("separator_") ? "separator" : match[1],
    }));
    const dependencies = {
        registerBuiltinSlashHint: (callback: unknown) => callback,
        SLASH_MENU_ROOT_PATH: "editor.slash.menu", getConfiguredEntryVisibility: () => true,
        getBuiltinSlashMenuItems: () => candidates, areProtylePluginExtensionsEnabled: () => true,
        getPluginSlashEntryKey: (name: string, id: string) => `plugin:${name}:${id}`,
        Constants: {ZWSP: "\u200b"}, refreshSlashMenuCatalog: () => {},
        getSelection, Element: TestElement, isTitleSlashContext, TITLE_INLINE_SLASH_IDS, TABLE_CELL_SLASH_IDS,
        slashBuiltinStyleIDs: {}, getEntryCatalogNode: () => true, getSlashMenuEntryPath: (id: string) => id,
        resolveSlashMenuItems, getEntryOrder: (): string[] => [],
    };
    const hintSlash = new Function(...Object.keys(dependencies), transpileModule(declaration("hintSlash")
        .replace(/^export /, ""), {compilerOptions: {target: ScriptTarget.ES2021}}).outputText + "\nreturn hintSlash;")(
        ...Object.values(dependencies)) as (key: string, protyle: unknown, hide?: boolean, options?: object) =>
        Array<IHintData & {entryKey: string; frequentEligible: boolean}>;
    const root = new TestElement(".protyle-wysiwyg");
    const protyle = {wysiwyg: {element: root}, hint: {element: {closest: (): null => null}}, options: {upload: {}},
        app: {plugins: [{name: "test", protyleSlash: [{id: "bold", filter: ["bold"], html: "Plugin bold"},
            {id: "custom", filter: ["custom"], html: "Plugin custom"}]}]}};
    return {hintSlash, protyle, root, setFocus: (node: typeof focusNode) => { focusNode = node; }};
};

test("title slash menus retain only built-in inline items for text and element selections", () => {
    const {hintSlash, protyle, root, setFocus} = setup();
    const title = new TestElement(".callout-title", root);
    const nested = new TestElement("span", title);
    for (const focus of [title, nested, {parentElement: nested}]) {
        setFocus(focus);
        for (const options of [{}, {visibilityRoot: "editor.slash.menu"}]) {
            const items = hintSlash("", protyle, false, options);
            assert.deepEqual(items.map(item => item.entryKey), inlineIDs);
            assert.ok(items.every(item => item.frequentEligible));
            assert.deepEqual(rankFrequentSlashItems(items, item => item.entryKey,
                {heading1: 100, "plugin:test:bold": 99, bold: 2, ref: 1}).map(item => item.entryKey), ["bold", "ref"]);
        }
        assert.deepEqual(hintSlash("bold", protyle).map(item => item.entryKey), ["bold"]);
        assert.equal(hintSlash("bold", protyle)[0].frequentEligible, false);
        assert.deepEqual(hintSlash("table", protyle), []);
    }
});

test("body and other editors retain block, style and plugin choices while table limits stay unchanged", () => {
    const {hintSlash, protyle, root, setFocus} = setup();
    for (const focus of [undefined, new TestElement("p", root),
        new TestElement(".callout-title", new TestElement(".protyle-wysiwyg"))]) {
        setFocus(focus);
        const keys = hintSlash("", protyle).map(item => item.entryKey);
        for (const id of ["heading1", "table", "tabs", "calloutNote", "infoStyle", "template", "plugin:test:bold"]) {
            assert.ok(keys.includes(id), id);
        }
    }
    setFocus({parentElement: new TestElement("td, th", root)});
    const items = hintSlash("", protyle);
    assert.ok(items.some(item => item.entryKey === "heading1"));
    assert.ok(items.every(item => TABLE_CELL_SLASH_IDS.has(item.id)));
    assert.equal(items.some(item => item.id === "table"), false);
});
