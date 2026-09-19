import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isVariableStatement, ScriptTarget, transpileModule} from "typescript";

const source = createSourceFile("util.ts", readFileSync("src/editor/util.ts", "utf8"), ScriptTarget.ES2021, true);
const declaration = source.statements.find(statement => isVariableStatement(statement) &&
    statement.declarationList.declarations.some(item => item.name.getText(source) === "updatePanelByEditor"));
const compiled = transpileModule(declaration.getText(source).replace(/^export /, "") + "\nglobalThis.update = updatePanelByEditor;", {
    compilerOptions: {target: ScriptTarget.ES2021},
}).outputText;

const setup = () => {
    const records: {protyle: any, range: any}[] = [];
    const context: any = {
        hasClosestByClassName: () => true,
        window: {siyuan: {config: {fileTree: {alwaysSelectOpenedFile: false}}}},
        document: {
            createRange: () => ({
                selectNodeContents(target: unknown) { this.startContainer = target; this.endContainer = target; },
                collapse(start: boolean) { assert.equal(start, true); },
            }),
        },
        getContenteditableElement: (block: unknown) => block,
        pushBack: (protyle: unknown, range: unknown) => records.push({protyle, range}),
        forEachPluginSubscriber: () => {},
        getAllModels: () => ({}),
        updateOutline: () => {},
        updateBacklinkGraph: () => {},
    };
    runInNewContext(compiled, context);
    const block = {};
    const protyle = {
        path: "/document.sy",
        element: {classList: {contains: () => false}, contains: (node: unknown) => node === block},
        toolbar: {range: undefined as any},
        wysiwyg: {element: {firstElementChild: block}},
        preview: {element: {classList: {contains: () => true}}},
    };
    const update = (pushBackStack = true) => context.update({protyle, focus: false, pushBackStack, resize: false, reload: false});
    return {records, protyle, block, update, context};
};

test("switching tabs without focus records the destination rather than another document's selection", () => {
    const {records, protyle, block, update} = setup();
    protyle.toolbar.range = {startContainer: {}, endContainer: {}};
    update();
    assert.equal(records.length, 1);
    assert.equal(records[0].protyle, protyle);
    assert.equal(records[0].range.startContainer, block);
});

test("switching tabs without focus preserves the saved caret range", () => {
    const {records, protyle, block, update} = setup();
    const range = {startContainer: block, endContainer: block, startOffset: 8, endOffset: 8};
    protyle.toolbar.range = range;
    update();
    assert.equal(records[0].range, range);
});

test("history restoration and preview tab switches do not create history entries", () => {
    const {records, protyle, update} = setup();
    update(false);
    protyle.preview.element.classList.contains = () => false;
    update();
    assert.equal(records.length, 0);
});

test("tablet tab switches navigate A B C backward and forward without touching the editor", async () => {
    const {context} = setup();
    const historySource = createSourceFile("backForward.ts", readFileSync("src/util/backForward.ts", "utf8"), ScriptTarget.ES2021, true);
    const names = ["pushBack", "goBack", "goForward", "forwardStack", "previousIsBack"];
    const declarations = historySource.statements.filter(statement => isVariableStatement(statement) &&
        statement.declarationList.declarations.some(item => names.includes(item.name.getText(historySource))));
    const history = declarations.map(item => item.getText(historySource).replace(/^export /, "")).join("\n");
    const stacks: any[] = [];
    const visited: string[] = [];
    context.window.siyuan.backStack = stacks;
    context.document.contains = () => true;
    context.document.querySelector = (): undefined => undefined;
    context.Constants = {SIZE_UNDO: 128};
    context.readingPositions = new WeakMap();
    context.saveBackScroll = () => {};
    context.hasClosestBlock = (node: unknown) => node;
    context.getSelectionOffset = () => ({start: 0, end: 0});
    const switchTab = (protyle: unknown, pushBackStack: boolean) => context.update({
        protyle, focus: false, pushBackStack, resize: false, reload: false,
    });
    context.focusStack = async (_app: unknown, stack: any) => {
        visited.push(stack.protyle.block.rootID);
        switchTab(stack.protyle, false);
        return true;
    };
    runInNewContext(transpileModule(history + "\nglobalThis.back = goBack; globalThis.forward = goForward;", {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText, context);
    const tabs = ["A", "B", "C"].map(id => {
        const block = {getAttribute: () => id + "-block", classList: {contains: () => false}};
        return {
            model: {}, block: {rootID: id}, path: "/" + id + ".sy",
            element: {classList: {contains: () => false}, contains: (node: unknown) => node === block},
            toolbar: {}, wysiwyg: {element: {firstElementChild: block}},
            preview: {element: {classList: {contains: () => true}}},
        };
    });
    tabs.forEach(tab => switchTab(tab, true));
    switchTab(tabs[2], true);
    assert.deepEqual(stacks.map(stack => stack.protyle.block.rootID), ["A", "B", "C"]);
    await context.back({});
    await context.back({});
    await context.forward({});
    await context.forward({});
    assert.deepEqual(visited, ["B", "A", "B", "C"]);
});
