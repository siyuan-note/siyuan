import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isClassDeclaration, ScriptTarget, transpileModule} from "typescript";
import {getSlashEntryKey, TSlashMenuItem} from "./slashMenu";
import {rankFrequentSlashItems} from "./frequentSlash";
import {escapeAttr} from "../../util/escape";

const text = readFileSync("src/protyle/hint/index.ts", "utf8");
const source = createSourceFile("index.ts", text, ScriptTarget.Latest);
const declaration = source.statements.find(node => isClassDeclaration(node) && node.name.text === "Hint");
assert.ok(declaration && isClassDeclaration(declaration));
const methods = declaration.members.filter(member => ["fillCommand", "fill", "getHTMLByData"].includes(member.name?.getText(source)))
    .map(member => member.getText(source)).join("\n");
const code = transpileModule(`class Hint { ${methods} } new Hint();`, {
    compilerOptions: {target: ScriptTarget.ES2020},
}).outputText;

const fixture = () => {
    const counts: string[] = [];
    let available = true;
    const block = {outerHTML: "paragraph", getAttribute: () => "NodeParagraph", setAttribute() {}};
    const range = {startContainer: block, deleteContents() {}};
    const hint = runInNewContext(code, {
        Constants: {ZWSP: "\u200b", BLOCK_HINT_KEYS: [], INLINE_TYPE: []},
        Lute: {Caret: "caret"}, hideElements() {}, isProtyleListItemFragment: () => false,
        hasClosestBlock: () => available ? block : undefined,
        getEditorRange: () => range, shouldCaptureHintUndoFocus: () => false,
        updateTransaction() {}, recordSlashExecution: (key: string) => counts.push(key),
        getSlashEntryKey, escapeAttr,
        getFrequentSlashItems: (items: TSlashMenuItem[]) => rankFrequentSlashItems(items, getSlashEntryKey,
            {code: 4, table: 2, "plugin:one:same": 3, "plugin:two:same": 1}),
    });
    Object.assign(hint, {source: "hint", splitChar: "/", lastIndex: -1, fixImageCursor() {},
        element: {closest: () => undefined}});
    const protyle = {toolbar: {range}, wysiwyg: {element: {}}};
    return {hint, protyle, counts, unavailable: () => { available = false; }};
};

test("explicit slash selections count once, while ordinary commands and upload-picker opening do not", () => {
    const {hint, protyle, counts} = fixture();
    hint.fill("style\u200b", protyle, false, false, "clearFontStyle");
    assert.deepEqual(counts, ["clearFontStyle"]);
    hint.fillCommand("style\u200b", protyle, false, "clearFontStyle");
    assert.deepEqual(counts, ["clearFontStyle", "clearFontStyle"]);
    hint.fillCommand("style\u200b", protyle, false);
    hint.fill("\u200b3", protyle, false, false, "insertAsset");
    assert.equal(counts.length, 2);
});

test("invalid insertion target cannot record a slash selection", () => {
    const f = fixture();
    f.unavailable();
    f.hint.fillCommand("style\u200b", f.protyle, false, "clearFontStyle");
    assert.deepEqual(f.counts, []);
});

test("rendering preserves original rows, selects favorites after context filtering, and never records", () => {
    const {hint, counts} = fixture();
    const items = ["table", "plugin:one:same", "plugin:two:same"].map(entryKey => ({
        id: entryKey.startsWith("plugin:") ? "same" : entryKey,
        entryKey, value: entryKey, html: entryKey, frequentEligible: true,
    }));
    const html: string = hint.getHTMLByData(items);
    assert.equal((html.match(/data-slash-entry-key=/g) || []).length, 6);
    assert.equal((html.match(/b3-menu__separator/g) || []).length, 1);
    assert.ok(html.indexOf('data-value="plugin%3Aone%3Asame"') < html.indexOf('data-value="table"'));
    assert.ok(!html.includes('data-value="code"'));
    const original = html.slice(html.indexOf('class="b3-menu__separator"'));
    assert.ok(original.indexOf('data-value="table"') < original.indexOf('data-value="plugin%3Aone%3Asame"'));
    assert.deepEqual(counts, []);
});

test("query results retain their order without duplicates or divider and keep execution identities", () => {
    const {hint} = fixture();
    const items = ["table", "code"].map(entryKey => ({id: entryKey, entryKey, value: entryKey,
        html: entryKey, frequentEligible: false}));
    const html: string = hint.getHTMLByData(items);
    assert.equal((html.match(/data-slash-entry-key=/g) || []).length, 2);
    assert.ok(!html.includes("b3-menu__separator"));
    assert.ok(html.indexOf('data-value="table"') < html.indexOf('data-value="code"'));
});

test("click and keyboard execution paths forward stable keys and divider buttons cannot execute", () => {
    assert.match(text, /btnElement && btnElement\.hasAttribute\("data-value"\)/);
    assert.match(text, /isOnlyMeta\(event\), btnElement\.dataset\.slashEntryKey/);
    assert.match(text, /this\.fill\(mark,[\s\S]*?dataset\.slashEntryKey/);
    const upload = text.slice(text.indexOf('item.addEventListener("change"'), text.indexOf("private getHTMLByData"));
    assert.ok(upload.indexOf("event.target.files.length === 0") < upload.indexOf("recordSlashExecution"));
    assert.ok(upload.indexOf("if (!range)") < upload.indexOf("recordSlashExecution"));
    assert.equal((upload.match(/recordSlashExecution/g) || []).length, 1);
});
