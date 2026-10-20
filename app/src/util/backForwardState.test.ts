import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isVariableStatement, ScriptTarget, transpileModule} from "typescript";

const source = createSourceFile("backForward.ts", readFileSync("src/util/backForward.ts", "utf8"), ScriptTarget.ES2021, true);
const names = ["pushBack", "goBack", "goForward", "hasBackHistory", "forwardStack", "previousIsBack"];
const declarations = source.statements.filter(statement => isVariableStatement(statement) &&
    statement.declarationList.declarations.some(item => names.includes(item.name.getText(source))));
const compiled = transpileModule(declarations.map(item => item.getText(source).replace(/^export /, "")).join("\n") +
    "\nglobalThis.history = {pushBack, goBack, goForward, hasBackHistory};", {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;

const setup = () => {
    const stacks: any[] = [];
    const visited: any[] = [];
    const buttons = new Map<string, Set<string>>();
    const context: any = {
        window: {siyuan: {backStack: stacks}},
        document: {
            contains: () => true,
            querySelector: (id: string) => {
                if (!buttons.has(id)) {
                    buttons.set(id, new Set());
                }
                return {classList: {
                    add: (value: string) => buttons.get(id).add(value),
                    remove: (value: string) => buttons.get(id).delete(value),
                }};
            },
        },
        Constants: {SIZE_UNDO: 128},
        readingPositions: new WeakMap(),
        saveBackScroll: () => {},
        getContenteditableElement: (block: unknown) => block,
        getSelectionOffset: (_block: unknown, _editor: unknown, range: any) => ({start: range?.offset || 0, end: range?.offset || 0}),
        focusStack: async (_app: unknown, stack: any) => { visited.push(stack); return true; },
    };
    runInNewContext(compiled, context);
    const tabs = ["A", "B", "C"].map(id => ({model: {}, element: {}, block: {rootID: id}}));
    const push = (protyle: any, offset = 0) => context.history.pushBack(protyle, {offset}, {
        classList: {contains: () => false}, getAttribute: () => protyle.block.rootID,
    });
    return {stacks, visited, tabs, push, buttons, context, history: context.history};
};

test("opening a previous document after back creates a new branch and discards forward history", async () => {
    const {stacks, visited, tabs: [a, b, c], push, buttons, history} = setup();
    [a, b, c].forEach(tab => push(tab));
    await history.goBack({});
    push(a);
    assert.deepEqual(stacks.map(stack => stack.protyle), [a, b, a]);
    assert.equal(buttons.get("#barForward").has("toolbar__item--disabled"), true);
    await history.goForward({});
    assert.equal(visited.at(-1).protyle, a);
    await history.goBack({});
    assert.equal(visited.at(-1).protyle, b);
    await history.goForward({});
    assert.equal(visited.at(-1).protyle, a);
});

test("updating the current block after back does not insert a duplicate history entry", async () => {
    const {stacks, tabs: [a, b, c], push, history} = setup();
    [a, b, c].forEach(tab => push(tab));
    await history.goBack({});
    push(b, 7);
    assert.deepEqual(stacks.map(stack => stack.protyle), [a, b]);
    assert.equal(stacks.at(-1).position.start, 7);
});

test("the same document in different editors remains two navigation destinations", async () => {
    const {stacks, visited, tabs: [a], push, history} = setup();
    const split = {...a, element: {}};
    push(a);
    push(split);
    assert.equal(stacks.length, 2);
    await history.goBack({});
    assert.equal(visited.at(-1).protyle, a);
    await history.goForward({});
    assert.equal(visited.at(-1).protyle, split);
});

test("an invalid navigation record does not discard forward history", async () => {
    const {visited, tabs: [a, b, c], push, history} = setup();
    [a, b, c].forEach(tab => push(tab));
    await history.goBack({});
    history.pushBack(a);
    await history.goForward({});
    assert.equal(visited.at(-1).protyle, c);
});

test("back availability follows document history through back, forward and new navigation", async () => {
    const {tabs: [a, b, c], push, history} = setup();
    assert.equal(history.hasBackHistory(), false);
    push(a);
    assert.equal(history.hasBackHistory(), false);
    push(b);
    assert.equal(history.hasBackHistory(), true);
    push(c);
    await history.goBack({});
    assert.equal(history.hasBackHistory(), true);
    await history.goBack({});
    assert.equal(history.hasBackHistory(), false);
    await history.goForward({});
    assert.equal(history.hasBackHistory(), true);
    await history.goBack({});
    push(c);
    assert.equal(history.hasBackHistory(), true);
    await history.goBack({});
    assert.equal(history.hasBackHistory(), false);
});

test("a closed current tab remains a back destination and deleted records can exhaust history", async () => {
    const {tabs: [a, b], context, push, history} = setup();
    push(a);
    context.document.contains = () => false;
    assert.equal(history.hasBackHistory(), true);
    await history.goBack({});
    assert.equal(history.hasBackHistory(), false);
    push(b);
    context.focusStack = async () => false;
    await history.goBack({});
    assert.equal(history.hasBackHistory(), false);
});
