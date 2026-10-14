import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isClassDeclaration, isVariableStatement, ScriptTarget, transpileModule} from "typescript";

const source = createSourceFile("util.ts", readFileSync("src/editor/util.ts", "utf8"), ScriptTarget.ES2021, true);
const declarations = source.statements.filter(statement => isVariableStatement(statement) &&
    statement.declarationList.declarations.some(item =>
        ["outlineRequests", "syncOutlineCurrent", "updateOutline"].includes(item.name.getText(source))));
const compiled = transpileModule(declarations.map(item => item.getText(source).replace(/^export /, "")).join("\n") +
    "\nglobalThis.update = updateOutline;", {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;

const makeProtyle = (rootID = "doc") => {
    const block = {id: rootID + "-heading"};
    const end = {id: "end"};
    const nodes = new Set([block, end]);
    const title = {id: "title"};
    return {
        block: {rootID},
        element: {isConnected: true, classList: {contains: () => false},
            contains: (node: unknown) => node === title || nodes.has(node as typeof block)},
        title: {editElement: title},
        notebookId: "box",
        background: {ial: {}},
        toolbar: {range: {startContainer: block, endContainer: end}},
        wysiwyg: {element: {contains: (node: unknown) => nodes.has(node as typeof block)}},
        preview: {element: {classList: {contains: () => true}}},
    };
};

const setup = () => {
    const requests: {params: any, callback: (response: any) => void}[] = [];
    const currents: unknown[] = [];
    const updates: string[] = [];
    let invalidations = 0;
    let selected: {startContainer: unknown, endContainer: unknown};
    const outline = {
        blockId: "doc", isPreview: false, type: "pin",
        invalidateCurrent: () => { invalidations++; },
        setCurrent: (block: unknown) => currents.push(block),
        update: (_response: unknown, id: string) => { outline.blockId = id; updates.push(id); },
        updateDocTitle: () => {},
    };
    const context: any = {
        getSelection: () => ({rangeCount: selected ? 1 : 0, getRangeAt: () => selected}),
        hasClosestByAttribute: (node: unknown) => node,
        isEncryptedBox: () => false,
        isCurrentEditor: () => true,
        fetchPost: (_url: string, params: unknown, callback: (response: unknown) => void) => requests.push({params, callback}),
    };
    runInNewContext(compiled, context);
    return {outline, requests, currents, updates, context,
        getInvalidations: () => invalidations,
        select: (range: typeof selected) => { selected = range; },
        update: (protyle?: ReturnType<typeof makeProtyle>, reload = false) => context.update({outline: [outline]}, protyle, reload),
    };
};

test("same-document tab switches sync each restored caret without refetching the outline", () => {
    const fixture = setup();
    const first = makeProtyle();
    const second = makeProtyle();
    for (const protyle of [first, second, first]) {
        fixture.select(protyle.toolbar.range);
        fixture.update(protyle);
    }
    assert.deepEqual(fixture.currents, [first.toolbar.range.startContainer, second.toolbar.range.startContainer,
        first.toolbar.range.startContainer]);
    assert.equal(fixture.requests.length, 0);
    assert.equal(fixture.getInvalidations(), 3);
});

test("a selection in another editor falls back to the target editor's saved range", () => {
    const fixture = setup();
    const target = makeProtyle();
    fixture.select(makeProtyle().toolbar.range);
    fixture.update(target);
    assert.equal(fixture.currents[0], target.toolbar.range.startContainer);
});

test("a cross-editor selection is rejected even when its start is inside the target", () => {
    const fixture = setup();
    const target = makeProtyle();
    fixture.select({startContainer: target.toolbar.range.startContainer, endContainer: {}});
    fixture.update(target);
    assert.equal(fixture.currents[0], target.toolbar.range.startContainer);
});

test("live target selection takes precedence over a different saved caret", () => {
    const fixture = setup();
    const target = makeProtyle();
    const end = target.toolbar.range.endContainer;
    fixture.select({startContainer: end, endContainer: end});
    fixture.update(target);
    assert.equal(fixture.currents[0], end);
});

test("an invalid saved range clears the current heading rather than using another editor", () => {
    const fixture = setup();
    const target = makeProtyle();
    target.toolbar.range = makeProtyle().toolbar.range;
    fixture.update(target);
    assert.deepEqual(fixture.currents, [undefined]);
    assert.equal(fixture.requests.length, 0);
});

test("a live selection in the document title clears the saved body heading", () => {
    const fixture = setup();
    const target = makeProtyle();
    fixture.select({startContainer: target.title.editElement, endContainer: target.title.editElement});
    fixture.update(target);
    assert.deepEqual(fixture.currents, [undefined]);
});

test("a new document refresh synchronizes its current heading after loading", () => {
    const fixture = setup();
    const target = makeProtyle("other");
    fixture.update(target);
    assert.equal(fixture.requests.length, 1);
    fixture.requests[0].callback({data: []});
    assert.deepEqual(fixture.updates, ["other"]);
    assert.equal(fixture.currents[0], target.toolbar.range.startContainer);
});

test("same-document switches invalidate a pending reload from another duplicate tab", () => {
    const fixture = setup();
    const first = makeProtyle();
    const second = makeProtyle();
    fixture.update(first, true);
    fixture.update(second);
    fixture.requests[0].callback({data: []});
    assert.equal(fixture.requests.length, 1);
    assert.deepEqual(fixture.updates, []);
    assert.deepEqual(fixture.currents, [second.toolbar.range.startContainer]);
});

test("returning to the original document rejects the intervening document's response", () => {
    const fixture = setup();
    fixture.update(makeProtyle("other"));
    const original = makeProtyle();
    fixture.update(original);
    fixture.requests[0].callback({data: []});
    assert.deepEqual(fixture.updates, []);
    assert.deepEqual(fixture.currents, [original.toolbar.range.startContainer]);
});

test("switching to preview invalidates pending editing responses without applying a caret highlight", () => {
    const fixture = setup();
    const target = makeProtyle();
    fixture.update(target, true);
    target.preview.element.classList.contains = () => false;
    fixture.update(target);
    fixture.requests[1].callback({data: []});
    fixture.requests[0].callback({data: []});
    assert.equal(fixture.outline.isPreview, true);
    assert.equal(fixture.updates.length, 1);
    assert.deepEqual(fixture.currents, []);
});

test("matching local outlines synchronize without requesting data for unrelated documents", () => {
    const fixture = setup();
    fixture.outline.type = "local";
    const target = makeProtyle();
    fixture.update(target);
    fixture.update(makeProtyle("other"));
    assert.deepEqual(fixture.currents, [target.toolbar.range.startContainer]);
    assert.equal(fixture.requests.length, 0);
    assert.equal(fixture.getInvalidations(), 1);
});

test("local editing outlines do not synchronize a preview tab's hidden saved body range", () => {
    const fixture = setup();
    fixture.outline.type = "local";
    const target = makeProtyle();
    target.preview.element.classList.contains = () => false;
    fixture.update(target);
    assert.deepEqual(fixture.currents, []);
    assert.equal(fixture.requests.length, 0);
});

for (const change of ["hidden", "detached", "non-editor", "mode"]) {
    test(`a pending pinned outline reload rejects a target that became ${change}`, () => {
        const fixture = setup();
        const target = makeProtyle();
        fixture.update(target, true);
        if (change === "hidden") {
            target.element.classList.contains = () => true;
        } else if (change === "detached") {
            target.element.isConnected = false;
        } else if (change === "non-editor") {
            fixture.context.isCurrentEditor = () => false;
        } else {
            target.preview.element.classList.contains = () => false;
        }
        fixture.requests[0].callback({data: []});
        assert.deepEqual(fixture.updates, []);
        assert.deepEqual(fixture.currents, []);
    });
}

test("closing the last editor clears outline data without accessing a missing editor", () => {
    const fixture = setup();
    fixture.update();
    fixture.context.isCurrentEditor = () => false;
    fixture.requests[0].callback({data: []});
    assert.deepEqual(fixture.updates, [""]);
});

const switchDeclaration = source.statements.find(statement => isVariableStatement(statement) &&
    statement.declarationList.declarations.some(item => item.name.getText(source) === "switchEditor"));
const switchCompiled = transpileModule(switchDeclaration.getText(source) + "\nglobalThis.switchEditor = switchEditor;", {
    compilerOptions: {target: ScriptTarget.ES2021},
}).outputText;

for (const action of ["focus", "highlight"]) {
    test(`outline navigation preserves the clicked heading after restoring the old caret (${action})`, () => {
        const fixture = setup();
        const protyle: any = makeProtyle();
        const clicked = {id: "clicked", clientHeight: 20};
        protyle.wysiwyg.element.querySelectorAll = () => [clicked];
        protyle.contentElement = {addEventListener() {}};
        protyle.element.addEventListener = () => {};
        const editor = {editor: {protyle}, parent: {headElement: {}, parent: {
            switchTab: () => fixture.update(protyle), showHeading() {},
        }}};
        Object.assign(fixture.context, {
            Constants: {CB_GET_FOCUS: "focus", CB_GET_HL: "highlight", CB_GET_OUTLINE: "outline"},
            isInEmbedBlock: () => false, revealTabsForTarget() {}, preventScroll() {}, highlightById() {},
            focusBlock: () => ({startContainer: clicked, endContainer: clicked}),
            scrollCenter() {}, ResizeObserver: class {observe() {} disconnect() {}}, AbortController,
            setTimeout() {}, isPhablet: () => action === "highlight", pushBackByEditor() {}, pushBack() {},
            hideElements() {}, updateOutlineCurrentBlock: (_protyle: unknown, node: unknown) => fixture.outline.setCurrent(node),
        });
        runInNewContext(switchCompiled, fixture.context);
        fixture.context.switchEditor(editor, {id: "clicked", rootID: "doc", action: [action, "outline"]}, {});
        assert.equal(fixture.currents.length, 2);
        assert.equal(fixture.currents[1], clicked);
        assert.equal(fixture.requests.length, 0);
    });
}

const outlineSource = createSourceFile("Outline.ts", readFileSync("src/layout/dock/Outline.ts", "utf8"), ScriptTarget.ES2021, true);
const outlineClass = outlineSource.statements.find(isClassDeclaration);
const methods = outlineClass.members.filter(member => ["setCurrent", "invalidateCurrent"].includes(member.name?.getText(outlineSource)));
const outlineCompiled = transpileModule(`class Harness {
    currentRequestID = 0; blockId = "doc"; highlights = [];
    getNotebookId() { return ""; }
    setCurrentById(id) { this.highlights.push(id); }
    ${methods.map(member => member.getText(outlineSource)).join("\n")}
}
globalThis.Harness = Harness;`, {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;

const outlineFixture = () => {
    const callbacks: ((response: any) => void)[] = [];
    const context: any = {
        hasClosestByClassName: () => false,
        getPreviousBlock: (): undefined => undefined,
        getAllModels: (): {editor: unknown[]} => ({editor: []}),
        fetchPost: (_url: string, _params: unknown, callback: (response: unknown) => void) => callbacks.push(callback),
    };
    runInNewContext(outlineCompiled, context);
    const node = (heading = false) => ({isConnected: true,
        getAttribute: (name: string) => name === "data-type" ? (heading ? "NodeHeading" : "NodeParagraph") : "heading"});
    return {outline: new context.Harness(), callbacks, node, context};
};

test("a new caret invalidates delayed breadcrumbs from a hidden but connected duplicate editor", async () => {
    const {outline, callbacks, node} = outlineFixture();
    await outline.setCurrent(node());
    outline.invalidateCurrent();
    await outline.setCurrent(node(true));
    callbacks[0]({data: [{type: "NodeHeading", id: "stale"}]});
    assert.deepEqual(Array.from(outline.highlights), ["heading"]);
});

test("clearing the caret cancels pending breadcrumbs and clears the old highlight", async () => {
    const {outline, callbacks, node} = outlineFixture();
    await outline.setCurrent(node());
    await outline.setCurrent(undefined);
    callbacks[0]({data: [{type: "NodeHeading", id: "stale"}]});
    assert.deepEqual(Array.from(outline.highlights), [""]);
});

test("a paragraph before any heading clears the previous heading highlight", async () => {
    const {outline, callbacks, node} = outlineFixture();
    await outline.setCurrent(node());
    callbacks[0]({data: [{type: "NodeDocument", id: "doc"}]});
    assert.deepEqual(Array.from(outline.highlights), [""]);
});

test("switching tabs while transactions settle cancels the old breadcrumb request before sending", async () => {
    const {outline, callbacks, node, context} = outlineFixture();
    let release: () => void;
    context.getAllModels = () => ({editor: [{editor: {protyle: {
        block: {rootID: "doc"}, wysiwyg: {element: {contains: () => true}},
    }}}]});
    context.waitForPendingTransactions = () => new Promise<void>(resolve => { release = resolve; });
    const pending = outline.setCurrent(node());
    outline.invalidateCurrent();
    await outline.setCurrent(node(true));
    release();
    await pending;
    assert.equal(callbacks.length, 0);
    assert.deepEqual(Array.from(outline.highlights), ["heading"]);
});
