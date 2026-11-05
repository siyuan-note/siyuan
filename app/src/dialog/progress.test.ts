import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";

const setup = () => {
    const elements = new Map<string, Element>();
    class Element {
        id = "";
        className = "";
        style = {zIndex: "", width: ""};
        attributes = new Map<string, string>();
        children: Element[] = [];
        fields = new Map<string, Element>();
        textContent = "";
        focused = false;
        click: () => void;
        classList = {toggle() {}};
        set innerHTML(_value: string) {
            this.children = [new Element(), new Element()];
            for (const selector of [".b3-dialog__progress-label", ".b3-dialog__progress", '[data-type="message"]']) {
                this.fields.set(selector, new Element());
            }
            this.fields.get(".b3-dialog__progress").fields.set(".b3-dialog__progressbar", new Element());
            this.children[1].fields = this.fields;
        }
        get lastElementChild() { return this.children.at(-1); }
        setAttribute(name: string, value: string) { this.attributes.set(name, value); }
        removeAttribute(name: string) { this.attributes.delete(name); }
        toggleAttribute(name: string, value: boolean) {
            if (value) this.setAttribute(name, "");
            else this.removeAttribute(name);
        }
        querySelector(selector: string): Element | undefined {
            if (this.fields.has(selector)) return this.fields.get(selector);
            for (const child of this.children) {
                const match = child.querySelector(selector);
                if (match) return match;
            }
        }
        appendChild(element: Element) { this.children.push(element); }
        addEventListener(_type: string, callback: () => void) { this.click = callback; }
        focus() { this.focused = true; }
        remove() { elements.delete(this.id); }
    }
    const api = {} as typeof import("./progress");
    const document = {getElementById: (id: string) => elements.get(id),
        createElement: (tag: string) => {
            const element = new Element();
            if (tag === "button") element.fields.set("button", element);
            return element;
        }, body: {appendChild: (element: Element) => elements.set(element.id, element)}};
    runInNewContext(transpileModule(readFileSync("src/dialog/progress.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText, {exports: api, document, window: {siyuan: {zIndex: 100, languages: {_kernel: {35: "Reindexing"}}}}});
    return {api, elements};
};

test("progress roots participate in dialog layering and isolate mobile swipe gestures", () => {
    const f = setup();
    f.api.progressLoading({code: 1, msg: "Reindexing"} as IWebSocketData);
    const progress = f.elements.get("progress");
    assert.equal(progress.className, "b3-dialog");
    assert.equal(progress.attributes.get("data-prevent-swipe"), "true");
    assert.equal(progress.style.zIndex, "101");
    assert.equal(progress.attributes.has("data-reindex-progress"), true);
    f.api.progressLoading({code: 1, msg: "Indexing 10/20"} as IWebSocketData);
    assert.equal(f.elements.get("progress"), progress);
    assert.equal(progress.querySelector('[data-type="message"]').textContent, "Indexing 10/20");
});

test("progress tasks retain explicit actions and close independently", () => {
    const f = setup();
    f.api.progressLoading({code: 0, msg: "Working", data: {current: 1, total: 4}} as IWebSocketData);
    assert.equal(f.elements.get("progress").querySelector(".b3-dialog__progress").attributes.get("aria-valuenow"), "25");
    let clicks = 0;
    const action = {label: "Cancel", callback: () => clicks++};
    f.api.progressLoading({code: 1, msg: "Exiting"} as IWebSocketData, "exitProgress", action);
    const exit = f.elements.get("exitProgress");
    const button = exit.querySelector("button");
    assert.equal(button.focused, true);
    button.click();
    assert.equal(clicks, 1);
    f.api.progressLoading({code: 1, msg: "Still exiting"} as IWebSocketData, "exitProgress", action);
    assert.equal(exit.querySelector("button"), button);
    f.api.progressLoading({code: 2} as IWebSocketData);
    assert.equal(f.elements.has("progress"), false);
    assert.equal(f.elements.get("exitProgress"), exit);
    f.api.progressLoading({code: 2} as IWebSocketData, "exitProgress");
    assert.equal(f.elements.size, 0);
});
