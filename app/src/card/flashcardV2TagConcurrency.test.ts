import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ScriptTarget, transpileModule} from "typescript";

test("review opens the shared tag editor for the current card, including an empty tag selection", async () => {
    const source = readFileSync("src/card/flashcardV2Session.ts", "utf8");
    const start = source.indexOf("const queryCurrentCardTags =");
    const end = source.indexOf("const openCurrentManagementMenu =", start);
    const script = source.slice(start, end).replace('import("./flashcardV2")', "loadTagEditor()");
    const card = {id: "card-a", sourceID: "source-a"};
    const element = {isConnected: true, dataset: {}};
    const calls: unknown[][] = [];
    let receive: (value: unknown) => void;
    runInNewContext(transpileModule(script + '\nqueryCurrentCardTags("card");', {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText, {
        queue: [{card}], index: 0, renderGeneration: 1, sessionFinished: false, dialog: {element},
        fetchPost: (_url: string, _query: unknown, callback: typeof receive) => { receive = callback; },
        loadTagEditor: async () => ({
            openFlashcardV2Tags: (...args: unknown[]) => calls.push(args),
        }),
    });
    receive({data: {cards: [{cardTagIDs: [], sourceTagIDs: ["inherited"]}]}});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].slice(0, 3), ["card", card.id, []]);
    assert.deepEqual(calls[0][5], ["inherited"]);
    const canOpen = calls[0][6] as () => boolean;
    assert.equal(canOpen(), true);
    element.isConnected = false;
    assert.equal(canOpen(), false);
});

test("tag creation and child editing serialize assignment saves and unknown close refreshes", async () => {
    const source = readFileSync("src/card/flashcardV2.ts", "utf8");
    const script = source.slice(source.indexOf("const openFlashcardV2Tags ="), source.indexOf("const openFlashcardV2FlagDefinitions ="));
    const handlers = new Map<string, (event?: unknown) => void>();
    const nodes = new Map<string, any>();
    const node = (key: string): any => {
        if (!nodes.has(key)) {
            nodes.set(key, {value: key === "input.b3-text-field" ? "new" : "", disabled: false, innerHTML: "",
                addEventListener: (type: string, handler: (event?: unknown) => void) => handlers.set(`${key}:${type}`, handler),
                focus() {}});
        }
        return nodes.get(key);
    };
    const attrs = new Map<string, string>();
    let options: any;
    let childClose: () => void;
    let refreshes = 0;
    let assignments = 0;
    let release: () => void;
    let creationCallback: (value: unknown) => void;
    let assignmentRelease: () => void;
    let plans = 0;
    const buttons = [node("cancel"), node("confirm")];
    const element = {isConnected: true,
        getAttribute: (key: string) => attrs.get(key), setAttribute: (key: string, value: string) => attrs.set(key, value),
        removeAttribute: (key: string) => attrs.delete(key),
        querySelector: node,
        querySelectorAll: (selector: string) => selector.includes(".b3-dialog__action") ? buttons :
            selector === "input, select, button" ? [...nodes.values()] : []};
    const state = {
        Dialog: class {element = element; constructor(value: unknown) {options = value;} destroy() {
            if (options.beforeClose()) {element.isConnected = false; options.destroyCallback();}
        }},
        fetchPost: (url: string, _payload: unknown, callback: (value: unknown) => void) => {
            if (url.endsWith("listEntities")) {callback({data: {entities: [{entityID: "old", payload: {id: "old"}}]}}); return Promise.resolve();}
            if (url.endsWith("saveTag")) {creationCallback = callback; return new Promise<void>(resolve => {release = resolve;});}
            assignments++;
            return new Promise<void>(resolve => {assignmentRelease = resolve;});
        },
        openFlashcardV2TagEditor: (_revision: unknown, _tags: unknown, _saved: unknown, close: () => void) => {childClose = close;},
        FlashcardV2TagSave: class {close() {} async run(groups: any[], save: any) {return save(groups[0], {operationID: "save", changedAt: 1});}},
        buildFlashcardV2TagAssignmentGroups: (_ids: unknown, _initial: unknown, changes: unknown) => {plans++; return [{changes}];},
        submitFlashcardV2Form: async (_element: unknown, save: () => Promise<boolean>) => {
            attrs.set("aria-busy", "true");
            try {await save();} finally {attrs.delete("aria-busy");}
        },
        createFlashcardV2Operation: () => () => ({operationID: "same", changedAt: 1}),
        readFlashcardV2Revision: (value: unknown) => value, isFlashcardTag() {},
        getFlashcardV2TagSelection: () => ({selected: [] as string[], mixed: [] as string[]}),
        flashcardTagParentOptions: () => "", renderFlashcardTagChoices: () => "", isMobile: () => false,
        window: {siyuan: {languages: {}}}, showMessage() {},
        callback: () => {refreshes++;},
    };
    runInNewContext(transpileModule(`${script}\nopenFlashcardV2Tags("card", "a", [], callback);`, {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText, state);
    const edit = () => handlers.get("[data-tag-list]:click")({target: {closest: (selector: string) =>
        selector.includes("editTag") ? {} : {dataset: {id: "old"}}}});
    edit();
    assert.equal(attrs.get("aria-busy"), "true");
    handlers.get("confirm:click")();
    assert.equal(element.isConnected, true);
    assert.equal(assignments, 0);
    childClose();
    assert.equal(attrs.has("aria-busy"), false);
    handlers.get('[data-type="createTag"]:click')();
    assert.equal(attrs.get("aria-busy"), "true");
    childClose = undefined;
    edit();
    assert.equal(childClose, undefined);
    handlers.get("confirm:click")();
    handlers.get("cancel:click")();
    assert.equal(element.isConnected, true);
    release(); // 服务端可能已提交，但响应丢失。
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(attrs.has("aria-busy"), false);
    let checkboxUpdates = 0;
    const change = () => handlers.get("[data-tag-list]:change")({target: {
        type: "checkbox", value: "old", checked: true, setAttribute() {checkboxUpdates++;}, closest: (): undefined => undefined,
    }});
    change();
    handlers.get("confirm:click")();
    assert.equal(assignments, 1);
    assert.equal(attrs.get("aria-busy"), "true");
    childClose = undefined;
    creationCallback = undefined;
    edit();
    handlers.get('[data-type="createTag"]:click')();
    change();
    handlers.get("confirm:click")();
    assert.equal(childClose, undefined);
    assert.equal(creationCallback, undefined);
    assert.equal(plans, 1);
    assert.equal(checkboxUpdates, 1);
    assignmentRelease();
    await new Promise(resolve => setImmediate(resolve));
    handlers.get('[data-type="createTag"]:click')();
    const before = node("[data-tag-list]").innerHTML;
    let lateRenders = 0;
    Object.defineProperty(node("[data-tag-list]"), "innerHTML", {
        get: () => before, set: () => {lateRenders++;},
    });
    element.isConnected = false; // 外部销毁绕过普通关闭守卫。
    options.destroyCallback();
    creationCallback({entityID: "late", payload: {id: "late"}});
    release();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(node("[data-tag-list]").innerHTML, before);
    assert.equal(lateRenders, 0);
    assert.equal(refreshes, 1);
    assert.equal(assignments, 1);
});
