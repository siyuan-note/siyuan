import * as assert from "node:assert/strict";
import {test} from "node:test";
import {filterMarkdownFonts, markdownFontVariants, reorderMarkdownFonts} from "./fontPicker";
import * as fontCore from "../util/systemFontCore";
import {loadModule} from "../testSupport/loadModule";

const fonts = [
    {family: "Sans", displayName: "Sans Bold", weight: 700, aliases: ["Alternate"]},
    {family: "Sans", displayName: "Sans Regular", weight: 400},
    {family: "Mono", displayName: "Mono", weight: 400, spacing: "monospace"},
    {family: "Dual", displayName: "Dual", weight: 500, spacing: "dual"},
];

test("Markdown font search combines aliases, deduplicates families and prefers regular preview", () => {
    const result = filterMarkdownFonts(fonts, " alternate ", false, []);
    assert.equal(result.length, 1);
    assert.equal(result[0].family, "Sans");
    assert.equal(result[0].weight, 400);
    assert.equal(filterMarkdownFonts(fonts, "missing", false, []).length, 0);
});

test("Markdown monospace filtering includes dual width and preserves selected proportional fonts", () => {
    assert.deepEqual(filterMarkdownFonts(fonts, "", true, []).map(font => font.family), ["Dual", "Mono"]);
    assert.equal(filterMarkdownFonts(fonts, "", true, [{family: "Sans", weight: 700}]).length, 3);
    assert.equal(filterMarkdownFonts(fonts, "", false, []).length, 3);
});

test("Markdown weights come only from actual family variants and chip ordering is bounded", () => {
    assert.deepEqual(markdownFontVariants(fonts, "Sans").map(font => font.weight), [400, 700]);
    assert.deepEqual(markdownFontVariants(fonts, "Missing"), []);
    const selection = [{family: "Sans", weight: 700}, {family: "Mono", weight: 400}];
    assert.deepEqual(reorderMarkdownFonts(selection, 0, 1).map(font => font.family), ["Mono", "Sans"]);
    assert.deepEqual(selection.map(font => font.family), ["Sans", "Mono"]);
    assert.equal(reorderMarkdownFonts(selection, -1, 0), selection);
    assert.equal(reorderMarkdownFonts(selection, 0, 2), selection);
});

class PickerElement {
    children: PickerElement[] = [];
    hidden = false;
    className = "";
    value = "";
    style: Record<string, string> = {};
    dataset: Record<string, string> = {};
    attributes = new Map<string, string>();
    onclick: () => void;
    oninput: () => void;
    private text = "";
    constructor(public tag: string) {}
    set textContent(value: string) {this.text = value; this.children = [];}
    get textContent() {return this.text;}
    set innerHTML(_value: string) {this.children = [new PickerElement("svg")];}
    get firstChild() {return this.children[0];}
    append(...children: PickerElement[]) {this.children.push(...children);}
    replaceChildren(...children: PickerElement[]) {this.children = children; this.text = "";}
    setAttribute(key: string, value: string) {this.attributes.set(key, value);}
    removeAttribute(key: string) {this.attributes.delete(key);}
    focus() {}
    querySelectorAll(selector: string): PickerElement[] {
        return this.children.flatMap(child => [...(child.tag === selector || selector === ".b3-chip" && child.className.includes("b3-chip") ? [child] : []), ...child.querySelectorAll(selector)]);
    }
}

test("font picker hides empty spacing, keeps its spinner during search, and exposes failed loads for retry", async () => {
    const module = loadModule<typeof import("./fontPicker")>("src/markdown/fontPicker.ts", {
        document: {createElement: (tag: string) => new PickerElement(tag)},
        require: (name: string) => name.endsWith("systemFontCore") ? fontCore : {observeFontPreview: () => () => {}},
    });
    const root = new PickerElement("section");
    let resolve: (items: typeof fonts) => void;
    let reject: (error: Error) => void;
    const picker = module.createMarkdownFontPicker(root as unknown as HTMLElement, [], false,
        () => new Promise((ok, fail) => {resolve = ok; reject = fail;}), key => key);
    const [chips, controls, notice, retry, list] = root.children;
    const search = controls.children[0];
    assert.equal(chips.hidden, true);
    assert.equal(list.hidden, true);
    assert.equal(root.attributes.get("aria-busy"), "true");
    assert.equal(notice.attributes.get("aria-label"), "loading");
    assert.equal(notice.children[0].className, "b3-loading b3-loading--small");
    assert.equal(notice.children[0].textContent, "");
    search.value = "nothing"; search.oninput();
    assert.equal(notice.children[0].className, "b3-loading b3-loading--small");
    reject(new Error("offline")); await new Promise(resolve => setImmediate(resolve));
    assert.equal(root.attributes.get("aria-busy"), "false");
    assert.equal(notice.textContent, "markdownSystemFontsUnavailable");
    assert.equal(notice.hidden, false); assert.equal(retry.hidden, false);
    search.oninput();
    assert.equal(notice.textContent, "markdownSystemFontsUnavailable");
    retry.onclick();
    assert.equal(retry.hidden, true);
    assert.equal(notice.children[0].className, "b3-loading b3-loading--small");
    resolve(fonts); await new Promise(resolve => setImmediate(resolve));
    assert.equal(root.attributes.get("aria-busy"), "false");
    assert.equal(notice.attributes.has("aria-label"), false);
    assert.equal(notice.textContent, "emptyContent");
    assert.equal(list.hidden, true);
    search.value = "Sans"; search.oninput();
    assert.equal(notice.hidden, true); assert.equal(list.hidden, false);
    list.children[0].onclick();
    assert.equal(chips.hidden, false);
    list.children[0].onclick();
    assert.equal(chips.hidden, true);
    picker.destroy();
});
