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

const restoreClosedHistoryEntry = async (disabled: boolean) => {
    const historySource = createSourceFile("backForward.ts", readFileSync("src/util/backForward.ts", "utf8"), ScriptTarget.ES2021, true);
    const declaration = historySource.statements.find(statement => isVariableStatement(statement) &&
        statement.declarationList.declarations.some(item => item.name.getText(historySource) === "focusStack"));
    const calls: string[] = [];
    const oldElement = {};
    const newElement = {};
    const protyle = {element: newElement, block: {rootID: "A"}, disabled, title: {editElement: {}}};
    let afterInit: () => void;
    let editorOptions: any;
    class ActiveElement {
        blur() { calls.push("blur"); }
    }
    const previewTab = (id: string, focused: boolean) => ({
        id,
        headElement: {classList: {contains: (name: string) =>
            name === "item--unupdate" || (name === "item--focus" && focused)}},
    });
    const wnd = {
        children: [previewTab("current", true), previewTab("other", false)],
        addTab(tab: any) { tab.callback(tab); },
        removeTab(id: string, batch: boolean, animate: boolean) { calls.push(`remove:${id}:${batch}:${animate}`); },
        showHeading() {},
    };
    const context: any = {
        window: {siyuan: {
            config: {fileTree: {openFilesUseCurrentTab: true}},
            layout: {}, storage: {positions: {}}, backStack: [],
        }},
        document: {
            activeElement: new ActiveElement(),
            contains: (element: unknown) => element === newElement,
            querySelector: () => ({getAttribute: () => "wnd"}),
        },
        HTMLElement: ActiveElement,
        Constants: {LOCAL_FILEPOSITION: "positions", CB_GET_SCROLL: "scroll", CB_GET_ALL: "all", CB_GET_UNUNDO: "unundo"},
        hideElements: () => {},
        fetchSyncPost: async (path: string) => path.endsWith("checkBlockExist") ?
            {code: 0, data: true} : {code: 0, data: {rootID: "A", rootTitle: "A", rootIcon: ""}},
        getInstanceById: () => wnd,
        isEncryptedBox: () => false,
        isPhablet: () => false,
        saveScroll: (): undefined => undefined,
        forwardStack: [],
        focusByOffset: () => calls.push("focus"),
        Tab: class {
            callback: (tab: any) => void;
            headElement = {classList: {contains: (name: string) => name === "item--focus"}};
            model: any;
            constructor(options: any) { this.callback = options.callback; }
            addModel(model: any) { this.model = model; }
        },
        Editor: class {
            editor = {protyle};
            constructor(options: any) {
                editorOptions = options;
                afterInit = () => options.afterInitProtyle(this.editor);
            }
        },
    };
    runInNewContext(transpileModule(declaration.getText(historySource).replace(/^export /, "") +
        "\nglobalThis.restore = focusStack;", {compilerOptions: {target: ScriptTarget.ES2021}}).outputText, context);
    const stack = {id: "A", position: {start: 2, end: 2}, protyle: {element: oldElement, block: {rootID: "A"}, notebookId: "notebook"}};
    assert.equal(await context.restore({}, stack), true);
    return {calls, protyle, editorOptions, afterInit};
};

test("history restores a closed document through the focused preview tab without early focus", async () => {
    const {calls, editorOptions, afterInit} = await restoreClosedHistoryEntry(false);
    assert.deepEqual(calls, ["blur", "remove:current:false:false"]);
    assert.equal(editorOptions.notebookId, "notebook");
    assert.deepEqual(Array.from(editorOptions.action), ["scroll", "unundo"]);
    afterInit();
    assert.deepEqual(calls, ["blur", "remove:current:false:false", "focus"]);
});

test("history does not focus a read-only document after it loads", async () => {
    const {calls, afterInit} = await restoreClosedHistoryEntry(true);
    afterInit();
    assert.deepEqual(calls, ["blur", "remove:current:false:false"]);
});

test("history switches to an open read-only tab without focusing its editor", async () => {
    const historySource = createSourceFile("backForward.ts", readFileSync("src/util/backForward.ts", "utf8"), ScriptTarget.ES2021, true);
    const declaration = historySource.statements.find(statement => isVariableStatement(statement) &&
        statement.declarationList.declarations.some(item => item.name.getText(historySource) === "focusStack"));
    const calls: unknown[][] = [];
    const protyle = {
        element: {}, block: {rootID: "A", showAll: false}, toolbar: {range: undefined as Range | undefined}, disabled: true,
        title: {editElement: {getBoundingClientRect: () => ({height: 0})}},
        model: {parent: {headElement: {}, parent: {switchTab: (...args: unknown[]) => calls.push(args)}}},
    };
    const context: any = {
        document: {contains: () => true},
        hideElements: () => {},
        isPhablet: () => false,
        readingPositions: new WeakMap(),
        focusByOffset: () => calls.push(["focus"]),
    };
    runInNewContext(transpileModule(declaration.getText(historySource).replace(/^export /, "") +
        "\nglobalThis.restore = focusStack;", {compilerOptions: {target: ScriptTarget.ES2021}}).outputText, context);
    assert.equal(await context.restore({}, {id: "A", position: {start: 0, end: 0}, protyle}), true);
    assert.deepEqual(Array.from(calls[0]), [{}, false, true, true, true, false]);
    assert.equal(calls.length, 1);
});
