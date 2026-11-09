import * as assert from "node:assert/strict";
import {test} from "node:test";
import {createMarkdownAppearanceForm} from "./appearance";

class Element {
    children: Element[] = [];
    hidden = false;
    disabled = false;
    textContent = "";
    type = "";
    className = "";
    value = "";
    closed = 0;
    onclick: (event: Event) => void;
    onkeydown: (event: KeyboardEvent) => void;
    onsubmit: (event: Event) => void;
    listeners = new Map<string, (event: Event) => void>();
    constructor(public tag: string) {}
    append(...children: Element[]) {this.children.push(...children);}
    replaceChildren(...children: Element[]) {this.children = children;}
    setAttribute() {}
    addEventListener(name: string, callback: (event: Event) => void) {this.listeners.set(name, callback);}
    removeEventListener(name: string) {this.listeners.delete(name);}
    reportValidity() {return true;}
    focus() {}
    close() {this.closed++;}
    querySelector() {return {focus() {}};}
    all(): Element[] {return [this, ...this.children.flatMap(child => child.all())];}
}

test("independent dialog blocks cancellation while saving and keeps failed input available for retry", async t => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
    Object.defineProperty(globalThis, "document", {configurable: true, value: {createElement: (tag: string) => new Element(tag)}});
    t.after(() => {if (previous) Object.defineProperty(globalThis, "document", previous); else delete globalThis.document;});
    const dialog = new Element("dialog");
    let resolve: () => void;
    let reject: () => void;
    let dismissed = 0;
    let saves = 0;
    createMarkdownAppearanceForm(dialog as unknown as HTMLDialogElement, "theme", {theme: "dark"}, key => key,
        () => {saves++; return new Promise<void>((ok, fail) => {resolve = ok; reject = () => fail(new Error("apply failed"));});}, () => {dismissed++;});
    const form = dialog.all().find(item => item.tag === "form");
    const submit = dialog.all().find(item => item.type === "submit");
    const cancel = dialog.all().find(item => item.textContent === "cancel");
    form.onsubmit(new Event("submit", {cancelable: true}));
    assert.equal(saves, 1);
    assert.equal(cancel.disabled, true);
    const escape = {key: "Escape", preventDefault() {}, stopPropagation() {}} as KeyboardEvent;
    form.onkeydown(escape);
    dialog.listeners.get("cancel")(new Event("cancel", {cancelable: true}));
    assert.equal(dismissed, 0);
    reject(); await Promise.resolve(); await Promise.resolve();
    assert.equal(submit.disabled, false);
    assert.equal(cancel.disabled, false);
    assert.equal(dialog.all().find(item => item.tag === "select").value, "dark");
    assert.equal(dialog.all().find(item => item.textContent === "markdownAppearanceError").hidden, false);
    form.onsubmit(new Event("submit", {cancelable: true}));
    resolve(); await Promise.resolve();
    assert.equal(dismissed, 1);
    assert.equal(dialog.closed, 1);
});

test("closing or destroying the dialog preserves cancellation and ignores obsolete save completions", async t => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
    Object.defineProperty(globalThis, "document", {configurable: true, value: {createElement: (tag: string) => new Element(tag)}});
    t.after(() => {if (previous) Object.defineProperty(globalThis, "document", previous); else delete globalThis.document;});
    let saves = 0;
    let dismissed = 0;
    let resolve: () => void;
    const dialog = new Element("dialog");
    const create = () => createMarkdownAppearanceForm(dialog as unknown as HTMLDialogElement, "theme", {}, key => key,
        () => {saves++; return new Promise<void>(ok => {resolve = ok;});}, () => {dismissed++;});
    create();
    dialog.listeners.get("cancel")(new Event("cancel", {cancelable: true}));
    assert.equal(saves, 0);
    assert.equal(dismissed, 1);
    const destroy = create();
    dialog.all().find(item => item.tag === "form").onsubmit(new Event("submit", {cancelable: true}));
    destroy();
    resolve(); await Promise.resolve();
    assert.equal(dismissed, 1);
    assert.equal(dialog.listeners.has("cancel"), false);
});
