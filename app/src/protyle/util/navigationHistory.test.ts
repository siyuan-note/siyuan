import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isVariableStatement, ScriptTarget, transpileModule} from "typescript";

const source = createSourceFile("onGet.ts", readFileSync("src/protyle/util/onGet.ts", "utf8"), ScriptTarget.ES2021, true);
const declaration = source.statements.find(statement => isVariableStatement(statement) &&
    statement.declarationList.declarations.some(item => item.name.getText(source) === "focusElementById"));
const compiled = transpileModule(declaration.getText(source) + "\nglobalThis.navigate = focusElementById;", {
    compilerOptions: {target: ScriptTarget.ES2021},
}).outputText;

const navigate = (action: string[], tablet = true, suppressFocus = false) => {
    const records: unknown[] = [];
    let focused = 0;
    const element = {
        classList: {contains: () => false},
        getAttribute: () => "NodeParagraph",
    };
    const range = {selectNodeContents: (target: unknown) => assert.equal(target, element), collapse: () => {}};
    const context: any = {
        Constants: Object.fromEntries(["FOCUS", "FOCUSFIRST", "SCROLL", "HL", "UNUNDO", "UNCHANGEID", "OUTLINE"]
            .map(key => ["CB_GET_" + key, key])),
        isPhablet: () => tablet,
        hasFocusOffsets: () => false,
        isInEmbedBlock: () => false,
        hasClosestByAttribute: () => false,
        getContenteditableElement: () => element,
        document: {createRange: () => range},
        pushBack: (_protyle: unknown, savedRange: unknown, target: unknown) => {
            assert.equal(target, element);
            records.push(savedRange);
        },
        focusBlock: () => { focused++; return range; },
        preventScroll: () => {},
        bgFade: () => {},
        scrollCenter: () => {},
        setTimeout: (callback: () => void, delay: number) => { if (!delay) { callback(); } },
        AbortController,
        ResizeObserver: class { observe() {} disconnect() {} },
    };
    runInNewContext(compiled, context);
    context.navigate({
        block: {id: "block", rootID: "root"},
        wysiwyg: {element: {querySelectorAll: () => [element], firstElementChild: element}},
        contentElement: {addEventListener: () => {}},
        observer: {unobserve: () => {}},
    }, action, undefined, undefined, false, suppressFocus);
    return {records, focused};
};

test("tablet browsing records navigation without focusing the editor", () => {
    for (const action of ["SCROLL", "HL", "FOCUS"]) {
        const result = navigate([action], true, true);
        assert.equal(result.records.length, 1);
        assert.equal(result.focused, 0);
    }
});

test("history restoration and dynamic scrolling do not add tablet navigation records", () => {
    assert.equal(navigate(["SCROLL", "UNUNDO"]).records.length, 0);
    assert.equal(navigate(["FOCUSFIRST", "UNCHANGEID"], true, true).records.length, 0);
    assert.equal(navigate([]).records.length, 0);
});

test("desktop browsing and explicit focus retain their history behavior", () => {
    assert.equal(navigate(["SCROLL"], false).records.length, 0);
    const result = navigate(["FOCUS"], false);
    assert.equal(result.records.length, 1);
    assert.equal(result.focused, 1);
});
