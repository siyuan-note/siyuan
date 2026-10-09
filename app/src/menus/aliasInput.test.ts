import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {bindAliasInput, parseAliases, updateAliases} from "./aliasInput";

describe("alias input", () => {
    it("splits ASCII commas, trims whitespace and keeps distinct aliases in order", () => {
        assert.deepEqual(parseAliases(" first, ,second,first, First,中文，别名 "),
            ["first", "second", "First", "中文，别名"]);
        assert.deepEqual(parseAliases(" , , "), []);
    });

    it("adds batches without overwriting existing aliases", () => {
        const original = ["first", "second"];
        assert.deepEqual(updateAliases(original, " second, third,third,fourth "),
            ["first", "second", "third", "fourth"]);
        assert.deepEqual(original, ["first", "second"]);
    });

    it("replaces one alias in place with a batch and merges duplicates", () => {
        assert.deepEqual(updateAliases(["first", "second", "third"], "third,fourth", 1),
            ["first", "third", "fourth"]);
    });

    it("removes an edited alias when cleared, including the last alias", () => {
        assert.deepEqual(updateAliases(["first", "second"], " , ", 0), ["second"]);
        assert.deepEqual(updateAliases(["first"], "", 0), []);
    });

    it("preserves literal markup and quotes as alias text", () => {
        const value = '<img src=x onerror="alert(1)"> & "quoted"';
        assert.deepEqual(updateAliases([], value), [value]);
    });
});

it("readonly aliases preserve text without editing, deletion, focus or drag handlers taking action", async () => {
    const calls: string[] = [];
    interface IFakeAliasElement {
        children: IFakeAliasElement[];
        textContent: string;
        className: string;
        events: Record<string, (event: unknown) => void>;
        classList: {toggle: () => void, contains: () => boolean};
        append: (child: IFakeAliasElement) => void;
        replaceChildren: () => void;
        setAttribute: () => void;
        addEventListener: (type: string, callback: (event: unknown) => void) => void;
        focus: () => void;
    }
    const makeElement = (): IFakeAliasElement => ({
        children: [],
        textContent: "",
        className: "",
        events: {} as Record<string, (event: unknown) => void>,
        classList: {toggle() {}, contains: () => true},
        append(child: IFakeAliasElement) { this.children.push(child); },
        replaceChildren() { this.children = []; },
        setAttribute() {},
        addEventListener(type: string, callback: (event: unknown) => void) { this.events[type] = callback; },
        focus: () => calls.push("focus"),
    });
    const list = makeElement();
    const input = makeElement();
    const add = {...makeElement(), querySelector: () => ({textContent: ""})};
    const element = {innerHTML: "", querySelector: (selector: string) => selector === ".b3-chips" ? list :
        selector === "button" ? add : input};
    const previousDocument = globalThis.document;
    globalThis.document = {createElement: makeElement} as unknown as Document;
    try {
        const aliases = bindAliasInput(element as unknown as HTMLElement, "first,<literal>", {
            readonly: true, addLabel: "add", removeLabel: "remove", placeholder: "alias", spellcheck: false,
            save: async () => { calls.push("save"); return true; },
        });
        assert.deepEqual(list.children.map(chip => chip.children.map(text => text.textContent)), [["first"], ["<literal>"]]);
        assert.ok(list.children.every(chip => Object.keys(chip.events).length === 0));
        list.events.pointerdown({});
        add.events.click({});
        aliases.focus();
        assert.equal(await aliases.commit(), true);
        assert.deepEqual(calls, []);
    } finally {
        globalThis.document = previousDocument;
    }
});
