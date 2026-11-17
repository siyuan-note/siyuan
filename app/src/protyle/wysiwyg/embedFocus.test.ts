import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isIfStatement, ModuleKind, ScriptTarget, transpileModule} from "typescript";

const {parse} = require("ifdef-loader/preprocessor");

test("embedded list markers retain task actions without focusing another document", () => {
    const source = createSourceFile("index.ts", readFileSync("src/protyle/wysiwyg/index.ts", "utf8"), ScriptTarget.Latest, true);
    let branch = "";
    const visit = (node: import("typescript").Node) => {
        if (isIfStatement(node) && node.expression.getText(source) === 'actionElement.parentElement.classList.contains("li")') {
            branch = node.thenStatement.getText(source);
        }
        node.forEachChild(visit);
    };
    visit(source);
    assert.ok(branch);
    for (const embedded of [false, true]) {
        for (const ctrlIsPressed of [false, true]) {
            for (const task of [false, true]) {
                const calls: string[] = [];
                const actionElement = {parentElement: {getAttribute: () => "item"},
                    classList: {contains: () => task}};
                const protyle = {disabled: false, block: {},
                    config: {}, wysiwyg: {element: {}}};
                runInNewContext(transpileModule(`(() => ${branch})()`, {compilerOptions: {target: ScriptTarget.ES2021}}).outputText, {
                    event: {altKey: false, shiftKey: false, stopPropagation() {}, preventDefault() {}},
                    actionElement, ctrlIsPressed, protyle,
                    window: {siyuan: {config: {editor: {listItemDotNumberClickFocus: true}}}},
                    document: {getElementById: (): undefined => undefined},
                    isInEmbedBlock: () => embedded, shouldOpenListItemAttr: () => false,
                    zoomOut: () => calls.push("focus"), enterBack: () => calls.push("back"),
                    toggleTaskListItem: () => calls.push("task"),
                });
                assert.deepEqual(calls, ctrlIsPressed ? embedded ? [] : ["focus"] : task ? ["task"] : embedded ? [] : ["focus"]);
            }
        }
    }
});

test("focus commands ignore embedded children while the embed block remains focusable", () => {
    const source = readFileSync("src/boot/globalEvent/command/protyle.ts", "utf8");
    for (const mobile of [false, true]) {
        for (const embedded of [false, true]) {
            const calls: string[] = [];
            const block = {getAttribute: () => "block", parentElement: {classList: {contains: () => false}}, contains: () => true};
            const api = {} as typeof import("../../boot/globalEvent/command/protyle");
            const dependencies = {hasClosestBlock: () => block, isInEmbedBlock: () => embedded,
                getTopAloneElement: () => block, getContenteditableElement: () => block, getSelectionOffset: () => ({}),
                zoomOut: () => calls.push("focus"), enterBack: () => calls.push("back")};
            runInNewContext(transpileModule(parse(source, {MOBILE: mobile}, false, true), {
                compilerOptions: {module: ModuleKind.CommonJS},
            }).outputText, {exports: api, require: () => dependencies});
            for (const command of ["enter", "enterBack"]) {
                assert.equal(api.onlyProtyleCommand({command, previousRange: {} as Range, protyle: {options: {}} as IProtyle}), true);
            }
            assert.deepEqual(calls, embedded ? [] : ["focus", "back"]);
        }
    }
});
