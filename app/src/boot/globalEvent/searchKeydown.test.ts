import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, forEachChild, isCallExpression, isVariableStatement, ModuleKind, ScriptTarget, transpileModule} from "typescript";

const evaluate = (source: string, globals: Record<string, unknown>) => {
    runInNewContext(transpileModule(source, {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText, globals);
};

const inputHandlers = (method: number) => {
    const handlers: Record<string, (event: any) => void> = {};
    const source = createSourceFile("util.ts", readFileSync(__dirname + "/../../search/util.ts", "utf8"),
        ScriptTarget.ES2021, true);
    const visit = (node: import("typescript").Node) => {
        if (isCallExpression(node) && node.expression.getText(source) === "searchInputElement.addEventListener" &&
            ["\"keydown\"", "\"beforeinput\""].includes(node.arguments[0].getText(source))) {
            evaluate(node.getText(source), {config: {method}, electronUndo: (): void => undefined,
                searchInputElement: {addEventListener: (type: string, handler: (event: any) => void) => handlers[type] = handler}});
        }
        forEachChild(node, visit);
    };
    visit(source);
    return handlers;
};

const runEnter = (targetId: string, method: number, resultType: string | undefined, bubble = false, keyword = "missing") => {
    const calls: string[] = [];
    const hidden = {classList: {contains: () => true}};
    const current = resultType ? {getAttribute: () => resultType, dataset: {}} : null;
    const element = {querySelector: (selector: string) => {
        if (selector === "#searchAssets" || selector === "#searchUnRefPanel") return hidden;
        if (selector === "#searchInput") return {value: keyword};
        return {querySelector: () => current};
    }};
    const dialog = {element: {contains: () => true, querySelector: (selector: string) => selector === "#searchList" ? {} : element},
        data: {method}, editors: {edit: {protyle: {}}}};
    const dependencies = {matchHotKey: () => false, hasClosestByClassName: () => false, getKeysByLiElement: (): string[] => [], Constants: {KEYCODELIST: {}},
        replace: () => calls.push("replace"), newFile: () => calls.push("newFile"), openSearchEditor: () => calls.push("open")};
    const exports: Record<string, unknown> = {};
    runInNewContext(transpileModule(readFileSync(__dirname + "/searchKeydown.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText, {exports, require: () => dependencies, getSelection: () => ({rangeCount: 1, getRangeAt: () => ({startContainer: {}})}),
        window: {siyuan: {dialogs: [dialog], config: {keymap: {general: {}, editor: {general: {}}}}, storage: {}, menus: {menu: {element: hidden}}}}});
    const handle = exports.searchKeydown as typeof import("./searchKeydown").searchKeydown;
    const event = {key: "Enter", target: {id: targetId}, defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; }, stopPropagation(): void {}};
    let handled = false;
    if (bubble) {
        inputHandlers(method).keydown(event);
        const source = createSourceFile("keydown.ts", readFileSync(__dirname + "/keydown.ts", "utf8"),
            ScriptTarget.ES2021, true);
        const declaration = source.statements.find(statement => isVariableStatement(statement) &&
            statement.declarationList.declarations.some(item => item.name.getText(source) === "windowKeyDown"));
        assert.ok(declaration);
        evaluate(declaration.getText(source) + "\nwindowKeyDown({}, event);", {
            exports: {}, event, switchDialog: undefined, filterHotkey: () => false,
            searchKeydown: (app: Parameters<typeof handle>[0], event: KeyboardEvent) => handled = handle(app, event),
            isWindow: () => false, bindMenuKeydown: () => true,
        });
        assert.equal(event.defaultPrevented, true);
    } else {
        handled = handle({} as Parameters<typeof handle>[0], event as unknown as KeyboardEvent);
    }
    return {calls, handled};
};

test("replace Enter never creates a document for an empty result in any search method", () => {
    for (const method of [0, 1, 2, 3]) {
        for (const resultType of ["search-new", undefined, "search-result"]) {
            assert.deepEqual(runEnter("replaceInput", method, resultType), {calls: ["replace"], handled: true});
        }
    }
});

test("search input Enter retains keyword document creation and ordinary result opening", () => {
    assert.deepEqual(runEnter("searchInput", 0, "search-new"), {calls: ["newFile"], handled: true});
    assert.deepEqual(runEnter("searchInput", 1, "search-new"), {calls: [], handled: false});
    assert.deepEqual(runEnter("searchInput", 0, "search-result"), {calls: ["open"], handled: true});
    assert.deepEqual(runEnter("searchInput", 2, "search-result"), {calls: [], handled: false});
});

test("search input Enter reaches global result opening before newline prevention", () => {
    for (const method of [0, 1, 3]) {
        for (const keyword of ["", "missing"]) {
            assert.deepEqual(runEnter("searchInput", method, "search-result", true, keyword), {calls: ["open"], handled: true});
        }
    }
    assert.deepEqual(runEnter("searchInput", 0, "search-new", true), {calls: ["newFile"], handled: true});
});

test("search input rejects non-SQL line breaks and preserves SQL multiline editing", () => {
    for (const method of [0, 1, 2, 3]) {
        for (const inputType of ["insertLineBreak", "insertText", "insertCompositionText"]) {
            const event = {inputType, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }};
            inputHandlers(method).beforeinput(event);
            assert.equal(event.defaultPrevented, inputType === "insertLineBreak" && method !== 2);
        }
    }
});
