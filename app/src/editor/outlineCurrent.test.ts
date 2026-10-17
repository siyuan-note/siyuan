import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isClassDeclaration, isVariableStatement, ScriptTarget, transpileModule} from "typescript";

const source = createSourceFile("util.ts", readFileSync("src/editor/util.ts", "utf8"), ScriptTarget.ES2021, true);
const declarations = source.statements.filter(statement => isVariableStatement(statement) &&
    statement.declarationList.declarations.some(item =>
        ["outlineRequests", "invalidateOutlineRequest", "syncOutlineCurrent", "updateOutline"].includes(item.name.getText(source))));
const compiled = transpileModule(declarations.map(item => item.getText(source).replace(/^export /, "")).join("\n") +
    "\nglobalThis.update = updateOutline; globalThis.invalidateOutlineRequest = invalidateOutlineRequest;",
    {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;

const makeProtyle = (rootID = "doc") => {
    const block = {id: rootID + "-heading"};
    const end = {id: "end"};
    const nodes = new Set([block, end]);
    const title = {id: "title"};
    const listeners = new Map<string, Set<() => void>>();
    return {
        block: {rootID},
        element: {isConnected: true, classList: {contains: () => false},
            contains: (node: unknown) => node === title || nodes.has(node as typeof block),
            addEventListener: (type: string, callback: () => void, options?: {signal?: AbortSignal}) => {
                if (!listeners.has(type)) {
                    listeners.set(type, new Set());
                }
                listeners.get(type).add(callback);
                options?.signal?.addEventListener("abort", () => listeners.get(type).delete(callback));
            }},
        interact: (type: string) => listeners.get(type)?.forEach(callback => callback()),
        activeListeners: () => Array.from(listeners.values()).reduce((count, callbacks) => count + callbacks.size, 0),
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
    const explicitCurrents: {id: string, scroll: boolean}[] = [];
    const updates: string[] = [];
    let invalidations = 0;
    let selected: {startContainer: unknown, endContainer: unknown};
    const outline = {
        blockId: "doc", isPreview: false, type: "pin",
        invalidateCurrent: () => { invalidations++; },
        setCurrent: (block: unknown) => currents.push(block),
        setCurrentById: (id: string, scroll: boolean) => explicitCurrents.push({id, scroll}),
        update: (_response: unknown, id: string) => { outline.blockId = id; updates.push(id); },
        updateDocTitle: () => {},
    };
    const context: any = {
        AbortController,
        getSelection: () => ({rangeCount: selected ? 1 : 0, getRangeAt: () => selected}),
        hasClosestByAttribute: (node: unknown) => node,
        isEncryptedBox: () => false,
        isCurrentEditor: () => true,
        fetchPost: (_url: string, params: unknown, callback: (response: unknown) => void) =>
            new Promise<void>(resolve => requests.push({params, callback: response => {
                callback(response);
                resolve();
            }})),
    };
    runInNewContext(compiled, context);
    return {outline, requests, currents, explicitCurrents, updates, context,
        getInvalidations: () => invalidations,
        select: (range: typeof selected) => { selected = range; },
        update: (protyle?: ReturnType<typeof makeProtyle>, reload = false, outlineId?: string) =>
            context.update({outline: [outline]}, protyle, reload, outlineId),
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

test("outline navigation selects an unloaded heading without following the old caret or scrolling", () => {
    const fixture = setup();
    const protyle = makeProtyle();
    fixture.select(protyle.toolbar.range);
    fixture.update(protyle, false, "unloaded-heading");
    assert.deepEqual(fixture.currents, []);
    assert.deepEqual(fixture.explicitCurrents, [{id: "unloaded-heading", scroll: false}]);
    assert.equal(fixture.requests.length, 0);
    assert.equal(fixture.getInvalidations(), 1);
});

test("a pinned outline reload retains the explicit navigation target instead of the restored caret", () => {
    const fixture = setup();
    const protyle = makeProtyle("other");
    fixture.update(protyle, false, "unloaded-heading");
    assert.equal(fixture.requests.length, 1);
    fixture.requests[0].callback({data: []});
    assert.deepEqual(fixture.updates, ["other"]);
    assert.deepEqual(fixture.currents, []);
    assert.deepEqual(fixture.explicitCurrents, [{id: "unloaded-heading", scroll: false}]);
});

for (const eventType of ["pointerdown", "keydown", "beforeinput"]) {
    test(`interacting with the editor during a pinned outline reload follows the latest caret (${eventType})`, () => {
        const fixture = setup();
        const protyle = makeProtyle("other");
        fixture.update(protyle, false, "clicked-heading");
        const latest = protyle.toolbar.range.endContainer;
        fixture.select({startContainer: latest, endContainer: latest});
        protyle.interact(eventType);
        fixture.requests[0].callback({data: []});
        assert.deepEqual(fixture.updates, ["other"]);
        assert.deepEqual(fixture.currents, [latest]);
        assert.deepEqual(fixture.explicitCurrents, []);
    });
}

test("restored focus preserves a pending outline target and completion removes input listeners", async () => {
    const fixture = setup();
    const protyle = makeProtyle("other");
    fixture.update(protyle, false, "clicked-heading");
    assert.equal(protyle.activeListeners(), 3);
    protyle.interact("focusin");
    assert.equal(protyle.activeListeners(), 3);
    fixture.requests[0].callback({data: []});
    await Promise.resolve();
    assert.deepEqual(fixture.currents, []);
    assert.deepEqual(fixture.explicitCurrents, [{id: "clicked-heading", scroll: false}]);
    assert.equal(protyle.activeListeners(), 0);
});

test("a superseded outline request removes its listeners without removing the replacement's listeners", async () => {
    const fixture = setup();
    const first = makeProtyle("other");
    const second = makeProtyle("other");
    fixture.update(first, false, "first-heading");
    fixture.update(second, false, "second-heading");
    assert.equal(first.activeListeners(), 0);
    assert.equal(second.activeListeners(), 3);
    fixture.requests[0].callback({data: []});
    await Promise.resolve();
    assert.equal(second.activeListeners(), 3);
    assert.deepEqual(fixture.explicitCurrents, []);
    fixture.requests[1].callback({data: []});
    await Promise.resolve();
    assert.equal(second.activeListeners(), 0);
    assert.deepEqual(fixture.explicitCurrents, [{id: "second-heading", scroll: false}]);
});

test("a newer outline navigation invalidates a pending reload's target", () => {
    const fixture = setup();
    const protyle = makeProtyle();
    fixture.update(protyle, true, "first-heading");
    fixture.update(protyle, false, "latest-heading");
    fixture.requests[0].callback({data: []});
    assert.deepEqual(fixture.updates, []);
    assert.deepEqual(fixture.currents, []);
    assert.deepEqual(fixture.explicitCurrents, [{id: "latest-heading", scroll: false}]);
});

test("invalidating a reload before navigation starts removes its listeners and rejects its response", () => {
    const fixture = setup();
    const protyle = makeProtyle("other");
    fixture.update(protyle, false, "previous-heading");
    assert.equal(protyle.activeListeners(), 3);
    fixture.context.invalidateOutlineRequest(fixture.outline);
    assert.equal(protyle.activeListeners(), 0);
    fixture.requests[0].callback({data: []});
    assert.deepEqual(fixture.updates, []);
    assert.deepEqual(fixture.currents, []);
    assert.deepEqual(fixture.explicitCurrents, []);
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
