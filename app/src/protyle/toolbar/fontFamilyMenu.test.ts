import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isVariableStatement, ScriptTarget, transpileModule} from "typescript";

const source = createSourceFile("fontFamilyMenu.ts", readFileSync(join(__dirname, "fontFamilyMenu.ts"), "utf8"),
    ScriptTarget.Latest);
const declaration = source.statements.find(node => isVariableStatement(node) &&
    node.declarationList.declarations.some(item => item.name.getText(source) === "renderMobileFontFamilyMenu"));
assert.ok(declaration);
const code = transpileModule(declaration.getText(source).replace("export ", "") +
    "\nrenderMobileFontFamilyMenu;", {compilerOptions: {target: ScriptTarget.ES2020}}).outputText;

test("mobile font loading keeps the picker visible without automatically opening the keyboard", async () => {
    let complete: (fonts: unknown[]) => void;
    const pending = new Promise(resolve => { complete = resolve; });
    let focusCount = 0;
    let bound = 0;
    const input = {focus: () => focusCount++};
    const element = {isConnected: true, innerHTML: "", querySelector: (selector: string) =>
        selector.includes("data-font-family-request") ? element.innerHTML.includes("data-font-family-request") : input};
    const render = runInNewContext(code, {
        mobileRequestID: 0,
        window: {siyuan: {languages: {loading: "Loading"}}},
        loadFontFamilies: () => pending,
        genFontPickerHTML: () => "Search and default font option",
        bindFontPicker: () => bound++,
    });
    const result = render(element, {isOpenValid: () => true});
    assert.match(element.innerHTML, /Loading/);
    complete([]);
    await result;
    assert.equal(element.innerHTML, "Search and default font option");
    assert.equal(bound, 1);
    assert.equal(focusCount, 0);
});

test("font responses cannot replace a mobile picker that has been closed", async () => {
    let complete: (fonts: unknown[]) => void;
    const pending = new Promise(resolve => { complete = resolve; });
    const element = {isConnected: true, innerHTML: "", querySelector: () => true};
    let open = true;
    const render = runInNewContext(code, {
        mobileRequestID: 0,
        window: {siyuan: {languages: {loading: "Loading"}}},
        loadFontFamilies: () => pending,
        genFontPickerHTML: () => assert.fail("closed picker must not render"),
        bindFontPicker: () => assert.fail("closed picker must not bind"),
    });
    const result = render(element, {isOpenValid: () => open});
    open = false;
    element.innerHTML = "Other panel";
    complete([]);
    await result;
    assert.equal(element.innerHTML, "Other panel");
});
