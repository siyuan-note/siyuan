import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ScriptTarget, transpileModule} from "typescript";
import {escapeAttr, escapeHtml} from "../util/escape";

const controls = (flag: number, value: string) => {
    const buttonClasses = new Set<string>();
    const inputClasses = new Set(["fn__none"]);
    const eventHandlers = new Map<string, (event?: KeyboardEvent) => void>();
    const buttonHandlers = new Map<string, () => void>();
    const button = {
        classList: {add: (name: string) => buttonClasses.add(name), remove: (name: string) => buttonClasses.delete(name)},
        firstElementChild: {textContent: value || String(flag)},
        addEventListener: (name: string, handler: () => void) => buttonHandlers.set(name, handler),
        setAttribute: () => {},
        focus: () => eventHandlers.get("blur")(),
    };
    const input = {
        dataset: {flag: String(flag)}, placeholder: String(flag), value,
        previousElementSibling: button,
        classList: {add: (name: string) => inputClasses.add(name), remove: (name: string) => inputClasses.delete(name)},
        addEventListener: (name: string, handler: (event?: KeyboardEvent) => void) => eventHandlers.set(name, handler),
        getAttribute: () => `Flag - ${flag}`,
        focus: () => {},
        select: () => {},
    };
    const key = (value: string, isComposing = false) => {
        let intercepted = false;
        eventHandlers.get("keydown")({key: value, isComposing, stopPropagation() {},
            preventDefault() { intercepted = true; }} as KeyboardEvent);
        return intercepted;
    };
    return {input, button, buttonClasses, inputClasses, key, edit: () => buttonHandlers.get("click")()};
};

test("flag names are inline actions and stage edits, cancellation and clearing before confirmation", () => {
    const source = readFileSync("src/card/flashcardV2.ts", "utf8");
    const snippet = source.slice(source.indexOf("const openFlashcardV2FlagDefinitions ="),
        source.indexOf("const openFlashcardV2ManagementFilter ="));
    const first = controls(1, "<old>");
    const second = controls(2, "Remove me");
    const unset = controls(3, "");
    const revisions = [{payload: {flag: 1, name: "<old>"}, revisionID: "first"},
        {payload: {flag: 2, name: "Remove me"}, revisionID: "second"}];
    const actions: Array<() => void> = [];
    const submitted: Array<{url: string, payload: unknown}> = [];
    let html = "";
    let reloaded = false;
    runInNewContext(transpileModule(`${snippet}\nopenFlashcardV2FlagDefinitions(revisions, reload);`, {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText, {
        revisions, reload: () => { reloaded = true; },
        window: {siyuan: {languages: {flashcardFlag: "Flag", confirm: "OK", cancel: "Cancel"}}},
        Dialog: class {
            element = {
                querySelectorAll: (selector: string) => selector === "[data-flag]" ? [first.input, second.input, unset.input] :
                    Array.from({length: 2}, () => ({addEventListener: (_name: string, handler: () => void) => actions.push(handler)})),
            };
            constructor(options: {content: string}) { html = options.content; }
            destroy() {}
        },
        isMobile: () => false, flashcardFlagStyle: () => "", escapeAttr, escapeHtml, genUUID: () => "operation",
        fetchPost: (url: string, payload: unknown, done: () => void) => {
            submitted.push({url, payload: JSON.parse(JSON.stringify(payload))});
            done();
        },
    });
    assert.ok(html.includes('<span class="fn__ellipsis">&lt;old></span></button>'));
    assert.equal((html.match(/class="b3-text-field fn__none"/g) || []).length, 7);
    first.edit();
    assert.equal(first.inputClasses.has("fn__none"), false);
    assert.equal(first.buttonClasses.has("fn__none"), true);
    first.input.value = "Discard";
    assert.equal(first.key("Enter", true), false);
    assert.equal(first.key("Escape"), true);
    assert.equal(first.input.value, "<old>");
    assert.equal(first.inputClasses.has("fn__none"), true);
    first.edit();
    first.input.value = " Renamed ";
    assert.equal(first.key("Enter"), true);
    assert.equal(first.button.firstElementChild.textContent, "Renamed");
    second.edit();
    second.input.value = "";
    second.key("Enter");
    assert.equal(second.button.firstElementChild.textContent, "2");
    assert.equal(submitted.length, 0);
    actions[1]();
    assert.equal(reloaded, true);
    assert.equal(submitted.length, 1);
    const request = submitted[0] as {url: string, payload: {mutations: Array<{entityID: string, expectedRevisionID: string,
        deleted: boolean, payload?: {name: string}}> }};
    assert.equal(request.url, "/api/flashcard/mutateEntities");
    assert.deepEqual(request.payload.mutations.map(mutation =>
        [mutation.entityID, mutation.expectedRevisionID, mutation.deleted, mutation.payload?.name]), [
        ["flag-definition-1", "first", false, "Renamed"],
        ["flag-definition-2", "second", true, undefined],
    ]);
});
