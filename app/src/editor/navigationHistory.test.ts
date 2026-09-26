import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isVariableStatement, ScriptTarget, transpileModule} from "typescript";

const source = createSourceFile("util.ts", readFileSync("src/editor/util.ts", "utf8"), ScriptTarget.ES2021, true);
const declarations = source.statements.filter(statement => isVariableStatement(statement) &&
    statement.declarationList.declarations.some(item =>
        ["updatePanelByEditor", "pushBackByEditor", "switchEditor"].includes(item.name.getText(source))));
const compiled = transpileModule(declarations.map(item => item.getText(source).replace(/^export /, "")).join("\n") +
    "\nglobalThis.update = updatePanelByEditor; globalThis.openExisting = switchEditor;", {
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

test("tablet links to an already loaded block record the destination instead of a stale caret", () => {
    const {context, records, protyle, block} = setup();
    const target = {clientHeight: 20, contains: () => false};
    protyle.toolbar.range = {startContainer: block, endContainer: block};
    Object.assign(protyle.wysiwyg.element, {querySelectorAll: () => [target]});
    context.isPhablet = () => true;
    context.isInEmbedBlock = () => false;
    context.revealTabsForTarget = () => {};
    context.preventScroll = () => {};
    context.highlightById = () => {};
    context.Constants = {CB_GET_HL: "highlight", CB_GET_FOCUS: "focus"};
    context.openExisting({editor: {protyle}, parent: {headElement: {}, parent: {
        switchTab: () => {}, showHeading: () => {},
    }}}, {id: "target", rootID: "doc", action: ["highlight"]}, {});
    assert.equal(records.length, 1);
    assert.equal(records[0].range.startContainer, target);
    assert.equal(records[0].range.endContainer, target);
});

for (const fromFileTree of [false, true]) {
    test(`tablet ${fromFileTree ? "file tree opens" : "tab switches"} navigate A B C backward and forward without touching the editor`, async () => {
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
        context.isPhablet = () => true;
        context.preventScroll = () => {};
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
                toolbar: {}, wysiwyg: {element: {firstElementChild: block, querySelectorAll: () => []}},
                preview: {element: {classList: {contains: () => true}}},
            };
        });
        const open = (protyle: typeof tabs[number]) => {
            if (fromFileTree) {
                context.openExisting({
                    editor: {protyle},
                    parent: {headElement: {}, parent: {
                        switchTab: (_head: unknown, pushBackStack = false) => switchTab(protyle, pushBackStack),
                        showHeading: () => {},
                    }},
                }, {id: protyle.block.rootID, rootID: protyle.block.rootID, action: ["scroll"]}, {});
            } else {
                switchTab(protyle, true);
            }
        };
        tabs.forEach(open);
        open(tabs[2]);
        assert.deepEqual(stacks.map(stack => stack.protyle.block.rootID), ["A", "B", "C"]);
        await context.back({});
        await context.back({});
        await context.forward({});
        await context.forward({});
        assert.deepEqual(visited, ["B", "A", "B", "C"]);
    });
}

const restoreClosedHistoryEntry = async (disabled: boolean, readingPosition?: IScrollAttr, encrypted = false) => {
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
        isEncryptedBox: () => encrypted,
        isPhablet: () => !!readingPosition,
        readingPositions: new WeakMap(),
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
    if (readingPosition) {
        stack.id = "A-block";
        context.readingPositions.set(stack, readingPosition);
    }
    assert.equal(await context.restore({}, stack), true);
    return {calls, protyle, editorOptions, afterInit, storage: context.window.siyuan.storage.positions};
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

for (const encrypted of [false, true]) {
    test(`closed tablet history restores its own reading position for encrypted=${encrypted}`, async () => {
        const readingPosition = {rootId: "A", startId: "first", endId: "last", scrollTop: 1133};
        const {calls, editorOptions, afterInit, storage} = await restoreClosedHistoryEntry(false, readingPosition, encrypted);
        assert.equal(editorOptions.scrollAttr.scrollTop, 1133);
        assert.equal(editorOptions.scrollAttr.startId, "first");
        assert.equal(editorOptions.scrollAttr.endId, "last");
        assert.equal(editorOptions.scrollAttr.focusId, "A-block");
        assert.equal("focusId" in readingPosition, false);
        assert.equal(!!storage.A, !encrypted);
        afterInit();
        assert.deepEqual(calls, ["blur", "remove:current:false:false"]);
    });
}

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
