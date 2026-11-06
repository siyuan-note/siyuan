import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {createSourceFile, isVariableStatement, ScriptTarget, transpileModule} from "typescript";
import {getProtyleTransactionOwner, registerProtyleRuntimeCapabilities} from "../runtimeCapabilities";

const source = createSourceFile("transaction.ts", readFileSync(__dirname + "/transaction.ts", "utf8"), ScriptTarget.Latest, true);
const declarations = source.statements.filter(isVariableStatement).flatMap(statement => Array.from(statement.declarationList.declarations));
const compiled = transpileModule(["pendingCollectionRemovals", "transaction"].map(name => {
    const declaration = declarations.find(item => item.name.getText(source) === name);
    return `const ${name} = ${declaration.initializer.getText(source)};`;
}).join("\n"), {compilerOptions: {target: ScriptTarget.ES2022}}).outputText;
const onGetSource = createSourceFile("onGet.ts", readFileSync(__dirname + "/../util/onGet.ts", "utf8"), ScriptTarget.Latest, true);
const readonlyDeclaration = onGetSource.statements.filter(isVariableStatement)
    .flatMap(statement => Array.from(statement.declarationList.declarations))
    .find(item => item.name.getText(onGetSource) === "disabledProtyle");
const compiledReadonly = transpileModule(`const disabledProtyle = ${readonlyDeclaration.initializer.getText(onGetSource)};`,
    {compilerOptions: {target: ScriptTarget.ES2022}}).outputText;

const fixture = (kind: "tags" | "references" | "mixed", mode = "") => {
    let finishPreview: (value: unknown) => void;
    let finishSave: () => void;
    let failSave: (error: Error) => void;
    const preview = new Promise(resolve => finishPreview = resolve);
    const save = new Promise<void>((resolve, reject) => { finishSave = resolve; failSave = reject; });
    const writes: {doOperations: IOperation[], undoOperations: IOperation[], awaitResponse: boolean,
        collectionRemovalSourceVersions?: Record<string, string>, callback?: (...args: unknown[]) => void}[] = [];
    const sourceVersions = {root: "source-version"};
    const callbackResponse = [{code: 0, data: {saved: true}}, "response-context"];
    const nextPreviews: Promise<unknown>[] = [];
    const previewed: IOperation[][] = [];
    let restored = 0;
    let history = 0;
    let focusRestored = 0;
    let previews = 0;
    const synced: IProtyle[] = [];
    const messages: string[] = [];
    const styles = new Map([["overflow-anchor", "auto"]]);
    const protyle = {lite: false, disabled: false, element: {inert: false, isConnected: true}, block: {rootID: "root", id: "root"},
        undo: {add: () => history++}, contentElement: {scrollTop: 120, style: {
            getPropertyValue: (name: string) => styles.get(name) || "",
            getPropertyPriority: () => "important",
            setProperty: (name: string, value: string) => { styles.set(name, value); },
            removeProperty: (name: string) => { styles.delete(name); },
        }}, scroll: {lastScrollTop: 120},
        wysiwyg: {element: {focus() {}, querySelectorAll: (): Element[] => []}}};
    const cleanup: IOperation = {action: "cleanupAttrViewBlocks", avID: "database", data: {ruleVersion: "version", items: []}};
    const changes = kind === "references" ? [] : [{id: "block", tags: ["todo"]}];
    const dependencies = {
        prepareAVHostTransaction: (_protyle: unknown, operations?: IOperation[]) => operations,
        getProtyleTransactionOwner,
        syncTrackedRanges: (editor: IProtyle) => synced.push(editor),
        window: {siyuan: {config: {fileTree: {openFilesUseCurrentTab: false}}, languages: {cancel: "Cancel", sourceRemovalPending: "Finish the current deletion confirmation"}}},
        document: {
            createElement: () => ({innerHTML: "", querySelector: () => ({})}),
            createRange: () => ({setStartBefore() {}, collapse() {}}),
        },
        getSelection: () => ({rangeCount: 1, getRangeAt: () => ({}), removeAllRanges() {}}),
        getEditorFocusRange: () => ({}),
        getUndoFocusContext: (element: unknown) => mode === "cancelWithoutRange" && element === protyle.wysiwyg.element ? undefined :
            {undoFocusId: "block", undoFocusStart: element === protyle.wysiwyg.element ? "4" : "5"},
        restoreEditorFocusRange: () => { assert.equal(protyle.disabled, false); focusRestored++; return true; },
        restoreUndoFocus: (_protyle: unknown, operations: IOperation[]) => {
            assert.equal(operations[0].context.undoFocusStart, restored ? "5" : "4");
            focusRestored++;
        },
        prepareViewFoldTransaction: (_protyle: unknown, doOperations: IOperation[], undoOperations: IOperation[]) => ({doOperations, undoOperations}),
        cleanBlockSelectionModeOperations() {}, cleanHeadingNumberOperations() {}, restoreInlineElementBoundaryHTML: (html: string) => html,
        retainTableCellRichMetadata: (html: string) => html,
        getTagRemovalChanges: () => changes,
        hasReferenceRemoval: () => kind !== "tags",
        waitForPendingTransactions: async () => {},
        previewCollectionRemoval: async (operations: IOperation[], tagChanges: unknown[], referencesRemoved: boolean) => {
            previews++;
            previewed.push(operations);
            assert.deepEqual(operations, [{action: "update", id: "block", data: previews === 1 ? "after" : operations[0].data}]);
            assert.deepEqual(tagChanges, changes);
            assert.equal(referencesRemoved, kind !== "tags");
            const result = await (previews > 1 && nextPreviews.length ? nextPreviews.shift() : preview);
            if (mode === "previewError") throw new Error("preview failed");
            return result === null ? null : {collections: result, sourceVersions};
        },
        collectionRemovalOperations: (groups: unknown[]) => groups.length ? [cleanup] : [],
        reloadProtyle: (_protyle: unknown, focus: boolean, updateReadonly: boolean, done: () => void) => {
            assert.equal(focus, false);
            assert.equal(updateReadonly, false);
            restored++;
            done();
        },
        showMessage: (message: string) => messages.push(message),
        promiseTransaction: (options: typeof writes[number]) => {
            writes.push(options);
            return save.then(() => options.callback?.(...callbackResponse));
        },
    };
    const transaction = new Function(...Object.keys(dependencies), compiled + "\nreturn transaction;")(...Object.values(dependencies));
    const operations: IOperation[] = [{action: "update", id: "block", data: "after"}];
    const undo: IOperation[] = [{action: "update", id: "block", data: "before<wbr>"}];
    return {protyle, writes, messages, styles, operations, undo, cleanup, sourceVersions, synced, callbackResponse, previewed,
        runFrom: (editor: IProtyle) => transaction(editor, operations, undo, {awaitResponse: true}) as Promise<void>,
        run: (data = "after", awaitResponse = true, collectionRemovalSourceVersions?: Record<string, string>,
              callback?: (...args: unknown[]) => void) => transaction(protyle,
            data === "after" ? operations : [{action: "update", id: "block", data}], undo,
            {awaitResponse, collectionRemovalSourceVersions, callback}) as Promise<void>,
        deferNextPreview: () => {
            let finish: (value: unknown) => void;
            nextPreviews.push(new Promise(resolve => finish = resolve));
            return (value: unknown) => finish(value);
        },
        finishPreview: (value: unknown) => finishPreview(value),
        finishSave: () => finishSave(), failSave: () => failSave(new Error("save failed")),
        counts: () => ({restored, history, focusRestored, previews})};
};

const tick = () => new Promise(resolve => setImmediate(resolve));

for (const kind of ["tags", "references", "mixed"] as const) {
    for (const mode of ["cancel", "cancelWithoutRange", "sourcesOnly", "withEntries", "previewError", "noMatches", "saveError"]) {
        test(`${kind} removal ${mode} waits, writes atomically and restores the editor`, async () => {
            const f = fixture(kind, mode);
            const pending = f.run();
            let completed = false;
            void pending.then(() => { completed = true; }, () => { completed = true; });
            assert.equal(f.run(), pending);
            assert.equal(f.protyle.disabled, false);
            assert.equal(f.protyle.element.inert, true);
            assert.equal(f.styles.get("overflow-anchor"), "none");
            assert.equal(f.counts().history, 0);
            assert.equal(f.writes.length, 0);
            await tick();
            assert.equal(completed, false);
            assert.equal(f.counts().previews, 1);
            f.protyle.contentElement.scrollTop = 80;
            f.finishPreview(mode.startsWith("cancel") ? null : mode === "withEntries" ? [{}] : []);
            await tick();
            if (!mode.startsWith("cancel") && mode !== "previewError") {
                assert.equal(completed, false);
                assert.equal(f.protyle.element.inert, true);
                assert.equal(f.counts().history, 0);
                assert.equal(f.writes.length, 1);
                assert.equal(f.writes[0].awaitResponse, true);
                assert.deepEqual(f.writes[0].collectionRemovalSourceVersions, f.sourceVersions);
                assert.equal(f.run(), pending);
                if (mode === "saveError") f.failSave();
                else f.finishSave();
            }
            const failure = mode.startsWith("cancel") || mode.endsWith("Error");
            if (failure) await assert.rejects(pending, mode.startsWith("cancel") ? {name: "AbortError"} : /failed/);
            else await pending;
            assert.equal(f.protyle.element.inert, false);
            assert.equal(f.protyle.contentElement.scrollTop, 120);
            assert.equal(f.protyle.scroll.lastScrollTop, 120);
            assert.equal(f.styles.get("overflow-anchor"), "auto");
            assert.equal(f.counts().focusRestored, 1);
            if (mode.startsWith("cancel") || mode.endsWith("Error")) {
                assert.equal(f.counts().history, 0);
                assert.equal(f.counts().restored, 1);
                assert.equal(f.messages.length, mode.endsWith("Error") ? 1 : 0);
            } else {
                assert.equal(f.counts().history, 1);
                assert.deepEqual(f.writes[0].doOperations, mode === "withEntries" ? [...f.operations, f.cleanup] : f.operations);
                assert.deepEqual(f.writes[0].undoOperations, mode === "withEntries" ? [...f.undo, f.cleanup] : f.undo);
            }
            const retry = f.run();
            assert.notEqual(retry, pending);
            if (mode !== "saveError") f.finishSave();
            if (failure) await assert.rejects(retry);
            else await retry;
        });
    }
}

for (const timing of ["beforePreview", "afterPreview"] as const) {
    for (const action of ["detach", "navigate", "replaceEditor", "replaceContainer"] as const) {
        test(`late ${timing} completion after ${action} cannot write or move focus`, async () => {
            const f = fixture("references");
            const pending = f.run();
            if (timing === "afterPreview") await tick();
            if (action === "detach") f.protyle.element.isConnected = false;
            else if (action === "navigate") f.protyle.block.id = "other";
            else if (action === "replaceContainer") f.protyle.element = {...f.protyle.element};
            else f.protyle.wysiwyg.element = {...f.protyle.wysiwyg.element};
            f.protyle.disabled = true;
            f.protyle.contentElement.scrollTop = 30;
            f.finishPreview([{}]);
            await assert.rejects(pending, {name: "AbortError"});
            assert.equal(f.writes.length, 0);
            assert.equal(f.counts().restored, 0);
            assert.equal(f.counts().history, 0);
            assert.equal(f.counts().focusRestored, 0);
            assert.equal(f.counts().previews, timing === "beforePreview" ? 0 : 1);
            assert.equal(f.protyle.contentElement.scrollTop, 30);
            assert.equal(f.protyle.element.inert, action === "replaceEditor" || action === "replaceContainer");
            assert.equal(f.protyle.disabled, true);
            assert.equal(f.styles.get("overflow-anchor"), "auto");
        });
    }
}

test("different programmatic edits are explicitly rejected while source confirmation is pending", async () => {
    const f = fixture("mixed");
    const pending = f.run();
    await assert.rejects(f.run("different"), {name: "InvalidStateError"});
    await assert.rejects(f.run("after", true, {root: "other-version"}), {name: "InvalidStateError"});
    assert.deepEqual(f.messages, ["Finish the current deletion confirmation", "Finish the current deletion confirmation"]);
    assert.equal(f.writes.length, 0);
    f.finishPreview([]);
    await tick();
    f.finishSave();
    await pending;
    assert.equal(f.writes.length, 1);
});

test("fire-and-forget cancellation and save failures are handled without hiding their rejection", async () => {
    for (const failure of [false, true]) {
        const f = fixture("references");
        const pending = f.run("after", false);
        f.finishPreview(failure ? [] : null);
        await tick();
        if (failure) f.failSave();
        await tick();
        await assert.rejects(pending, failure ? /save failed/ : {name: "AbortError"});
        assert.equal(f.protyle.element.inert, false);
    }
});

test("a read-only or previously inert editor is not focused when confirmation finishes", async () => {
    for (const state of ["disabled", "inert", "disabledWhileSaving"] as const) {
        const f = fixture("references");
        if (state === "disabled") f.protyle.disabled = true;
        if (state === "inert") f.protyle.element.inert = true;
        const pending = f.run();
        f.finishPreview([]);
        await tick();
        if (state === "disabledWhileSaving") f.protyle.disabled = true;
        f.finishSave();
        await pending;
        assert.equal(f.counts().focusRestored, 0);
        assert.equal(f.protyle.element.inert, state === "inert");
        assert.equal(f.protyle.disabled, state !== "inert");
    }
});

for (const mode of ["success", "cancel", "previewError", "saveError"]) {
    test(`locking a search preview while confirmation is pending preserves readonly and external focus after ${mode}`, async () => {
        for (const focused of ["confirmation", "otherPanel"]) {
            const f = fixture("references", mode);
            const pending = f.run();
            await tick();
            assert.equal(f.counts().previews, 1);
            assert.equal(f.protyle.element.inert, true);
            const activeElement = {name: focused};
            const document: {activeElement: unknown} = {activeElement};
            let containerFocusCalls = 0;
            Object.assign(f.protyle.element, {
                contains: (node: unknown) => node === f.protyle.element || node === f.protyle.wysiwyg.element,
                hasAttribute: (name: string) => name === "tabindex",
                focus: () => { containerFocusCalls++; document.activeElement = f.protyle.element; },
            });
            const dependencies = {
                protyle: f.protyle,
                document,
                window: {siyuan: {mobile: {}, menus: {menu: {remove() {}}}}},
                hideElements() {}, syncRelatedAVEditor() {}, refreshCalendarReadonly() {}, hideTooltip() {},
                updateMobileTitleReadonly() {},
                disabledWYSIWYG: () => {
                    if (document.activeElement === f.protyle.wysiwyg.element) document.activeElement = {};
                },
            };
            new Function(...Object.keys(dependencies), compiledReadonly + "\ndisabledProtyle(protyle);")(...Object.values(dependencies));
            assert.equal(f.protyle.disabled, true);
            assert.equal(document.activeElement, activeElement);
            assert.equal(containerFocusCalls, 0);
            f.finishPreview(mode === "cancel" ? null : []);
            await tick();
            if (mode === "saveError") f.failSave();
            else if (mode === "success") f.finishSave();
            if (mode === "success") await pending;
            else await assert.rejects(pending, mode === "cancel" ? {name: "AbortError"} : /failed/);
            assert.equal(f.protyle.disabled, true);
            assert.equal(f.protyle.element.inert, false);
            assert.equal(f.counts().focusRestored, 0);
            assert.equal(containerFocusCalls, 0);
            assert.equal(document.activeElement, activeElement);
            assert.equal(f.counts().history, mode === "success" ? 1 : 0);
            assert.equal(f.counts().restored, mode === "success" ? 0 : 1);
        }
    });
}

for (const kind of ["tags", "references", "mixed"] as const) {
    for (const awaitResponse of [false, true]) {
        test(`local lite ${kind} removal keeps undo and skips collection preview with awaitResponse=${awaitResponse}`, async () => {
            const f = fixture(kind);
            f.protyle.lite = true;
            assert.equal(f.run("after", awaitResponse), undefined);
            await tick();
            assert.equal(f.counts().previews, 0);
            assert.equal(f.counts().history, 1);
            assert.equal(f.counts().restored, 0);
            assert.equal(f.counts().focusRestored, 0);
            assert.equal(f.writes.length, 0);
            assert.deepEqual(f.synced, [f.protyle]);
            assert.equal(f.protyle.element.inert, false);
            assert.equal(f.styles.get("overflow-anchor"), "auto");
        });
    }
}

test("lite edits routed to a persistent host still confirm once and await the host commit", async () => {
    const f = fixture("references");
    let localHistory = 0;
    const fragment = {lite: true, undo: {add: () => localHistory++}} as unknown as IProtyle;
    registerProtyleRuntimeCapabilities(fragment, {getTransactionOwner: () => f.protyle as unknown as IProtyle});
    const pending = f.runFrom(fragment);
    assert.equal(f.protyle.element.inert, true);
    assert.equal(f.counts().history, 0);
    assert.equal(localHistory, 0);
    await tick();
    assert.equal(f.counts().previews, 1);
    f.finishPreview([{}]);
    await tick();
    assert.equal(f.writes.length, 1);
    assert.equal(f.counts().history, 0);
    assert.deepEqual(f.writes[0].collectionRemovalSourceVersions, f.sourceVersions);
    assert.equal(f.protyle.element.inert, true);
    f.finishSave();
    await pending;
    assert.equal(f.counts().history, 1);
    assert.equal(localHistory, 0);
    assert.equal(f.protyle.element.inert, false);
    assert.deepEqual(f.synced, []);
});

test("a successful callback retains its arguments and starts the next edit after restoration", async () => {
    const f = fixture("references");
    const finishNextPreview = f.deferNextPreview();
    let callbacks = 0;
    let next: Promise<void>;
    const callback = (...args: unknown[]) => {
        callbacks++;
        assert.deepEqual(args, f.callbackResponse);
        assert.equal(args[0], f.callbackResponse[0]);
        assert.equal(f.protyle.element.inert, false);
        assert.equal(f.styles.get("overflow-anchor"), "auto");
        assert.equal(f.counts().history, 1);
        assert.equal(f.counts().focusRestored, 1);
        next = f.run("next");
        assert.equal(f.protyle.element.inert, true);
    };
    const pending = f.run("after", true, undefined, callback);
    assert.equal(f.run("after", true, undefined, callback), pending);
    f.finishPreview([]);
    await tick();
    assert.equal(callbacks, 0);
    f.finishSave();
    await pending;
    await tick();
    assert.equal(callbacks, 1);
    assert.equal(f.counts().previews, 2);
    assert.equal(f.writes.length, 1);
    assert.equal(f.run("next"), next);
    await assert.rejects(f.run(), {name: "InvalidStateError"});
    finishNextPreview([]);
    await next;
    assert.equal(f.writes.length, 2);
    assert.equal(f.counts().history, 2);
    assert.equal(f.protyle.element.inert, false);
    assert.deepEqual(f.previewed[1], [{action: "update", id: "block", data: "next"}]);
    assert.equal(callbacks, 1);
});

test("callback exceptions reject the original promise without reloading a committed edit", async () => {
    const f = fixture("references");
    const error = new Error("callback failed");
    let callbacks = 0;
    const pending = f.run("after", true, undefined, () => { callbacks++; throw error; });
    f.finishPreview([]);
    await tick();
    f.finishSave();
    await assert.rejects(pending, value => value === error);
    assert.equal(callbacks, 1);
    assert.equal(f.counts().history, 1);
    assert.equal(f.counts().restored, 0);
    assert.equal(f.protyle.element.inert, false);
    assert.equal(f.messages.length, 0);
    await f.run();
    assert.equal(f.counts().history, 2);
});

for (const mode of ["cancel", "previewError", "saveError"]) {
    test(`source removal ${mode} never invokes the success callback`, async () => {
        const f = fixture("references", mode);
        let callbacks = 0;
        const pending = f.run("after", true, undefined, () => callbacks++);
        f.finishPreview(mode === "cancel" ? null : []);
        await tick();
        if (mode === "saveError") f.failSave();
        await assert.rejects(pending);
        assert.equal(callbacks, 0);
        assert.equal(f.counts().history, 0);
        assert.equal(f.counts().restored, 1);
    });
}
