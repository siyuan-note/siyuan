import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {escapeAttr, escapeHtml} from "../util/escape";

const languages = JSON.parse(readFileSync("appearance/langs/en.json", "utf8"));
const colorNames = ["No flag", "Red", "Orange", "Green", "Blue", "Purple", "Cyan", "Pink"];

test("flag menus use localized colors and a neutral icon for clearing the flag", () => {
    const exports: {flashcardV2FlagMenuItems?: (current: number, definitions: {flag: number, name: string}[],
        select: (flag: number) => void) => IMenu[]} = {};
    runInNewContext(transpileModule(readFileSync("src/card/flashcardV2Flag.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText, {exports, require: () => ({escapeHtml}), window: {siyuan: {languages}}});
    const changes: number[] = [];
    const items = exports.flashcardV2FlagMenuItems(1, [{flag: 4, name: "<Study>"}], flag => changes.push(flag));
    assert.deepEqual(Array.from(items, item => item.label), colorNames.map((name, flag) => flag === 4 ? "&lt;Study>" : name));
    assert.equal(items[0].icon, "iconFlag");
    assert.ok(items.slice(1).every(item => item.icon === "iconFlagFilled"));
    const svg = {style: {color: ""}};
    items[0].bind({querySelector: () => svg} as unknown as HTMLElement);
    assert.equal(svg.style.color, "var(--b3-theme-on-surface)");
    assert.equal(items[1].checked, true);
    items[1].click(null, null);
    items[0].click(null, null);
    assert.deepEqual(changes, [0]);
});

const controls = (flag: number, value: string) => {
    const buttonClasses = new Set<string>();
    const inputClasses = new Set(["fn__none"]);
    const eventHandlers = new Map<string, (event?: KeyboardEvent) => void>();
    const buttonHandlers = new Map<string, () => void>();
    const button = {
        classList: {add: (name: string) => buttonClasses.add(name), remove: (name: string) => buttonClasses.delete(name)},
        firstElementChild: {textContent: value || colorNames[flag]},
        addEventListener: (name: string, handler: () => void) => buttonHandlers.set(name, handler),
        setAttribute: () => {},
        focus: () => eventHandlers.get("blur")(),
    };
    const input = {
        dataset: {flag: String(flag)}, placeholder: colorNames[flag], value,
        previousElementSibling: button,
        classList: {add: (name: string) => inputClasses.add(name), remove: (name: string) => inputClasses.delete(name)},
        addEventListener: (name: string, handler: (event?: KeyboardEvent) => void) => eventHandlers.set(name, handler),
        getAttribute: () => `Flag - ${colorNames[flag]}`,
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
        isMobile: () => false, flashcardFlagStyle: () => "", flashcardV2FlagLabel: (flag: number) => colorNames[flag],
        flashcardV2FlagIcon: (flag: number) => flag > 0 ? "iconFlagFilled" : "iconFlag",
        escapeAttr, escapeHtml, genUUID: () => "operation",
        fetchPost: (url: string, payload: unknown, done: () => void) => {
            submitted.push({url, payload: JSON.parse(JSON.stringify(payload))});
            done();
        },
    });
    assert.ok(html.includes('<span class="fn__ellipsis">&lt;old></span></button>'));
    assert.ok(html.includes('placeholder="Green"'));
    assert.equal((html.match(/xlink:href="#iconFlagFilled"/g) || []).length, 7);
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
    assert.equal(second.button.firstElementChild.textContent, "Orange");
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
