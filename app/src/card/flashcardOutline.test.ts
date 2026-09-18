import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compiled = transpileModule(readFileSync("src/card/flashcardOutline.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const fixture = () => {
    interface IElement {
        dataset: Record<string, string>;
        style: Record<string, string>;
        textContent: string;
        children: IElement[];
        scrollTop: number;
        top: number;
        classList: {contains: (key: string) => boolean; toggle: (key: string, force?: boolean) => boolean};
        addEventListener: (key: string, callback: () => void) => void;
        removeEventListener: (key: string) => void;
        click: () => void;
        setAttribute: () => void;
        hasAttribute: () => boolean;
        closest: () => null;
        querySelector: () => null;
        appendChild: (child: IElement) => void;
        replaceChildren: () => void;
        querySelectorAll: () => IElement[];
        getBoundingClientRect: () => {top: number};
        getClientRects: () => object[];
    }
    const element = (): IElement => {
        const classes = new Set<string>();
        const listeners = new Map<string, () => void>();
        return {
            dataset: {} as Record<string, string>, style: {}, textContent: "", children: [] as ReturnType<typeof element>[],
            scrollTop: 0, top: 0,
            classList: {
                contains: (key: string) => classes.has(key),
                toggle: (key: string, force = !classes.has(key)) => {
                    if (force) { classes.add(key); } else { classes.delete(key); }
                    return force;
                },
            },
            addEventListener: (key: string, callback: () => void) => listeners.set(key, callback),
            removeEventListener: (key: string) => listeners.delete(key),
            click: () => listeners.get("click")?.(),
            setAttribute: () => {},
            hasAttribute: () => false,
            closest: () => null,
            querySelector: () => null,
            appendChild(child: ReturnType<typeof element>) { this.children.push(child); },
            replaceChildren() { this.children = []; this.textContent = ""; },
            querySelectorAll() { return this.children; },
            getBoundingClientRect() { return {top: this.top}; },
            getClientRects: () => [{}],
        };
    };
    const panel = element();
    panel.classList.toggle("fn__none", true);
    const content = element();
    const toggle = element();
    const requests: Array<{url: string, data: unknown, callback: (response: unknown) => void, fail: () => void}> = [];
    const opened: string[] = [];
    const exports: {createFlashcardOutline?: (app: unknown, surface: unknown) => {
        update: (id?: string) => void;
        toggle: () => void;
        destroy: () => void;
    }} = {};
    runInNewContext(compiled, {
        exports,
        window: {siyuan: {languages: {outline: "Outline", emptyContent: "Empty"}}},
        document: {createElement: element},
        getComputedStyle: () => ({visibility: "visible"}),
        require: () => ({
            fetchPost: (url: string, data: unknown, callback: (response: unknown) => void,
                _headers: unknown, fail: () => void) => requests.push({url, data, callback, fail}),
            openFileById: ({id}: {id: string}) => opened.push(id),
            Constants: {},
        }),
    });
    const controller = exports.createFlashcardOutline({}, {
        querySelector: (selector: string) => selector === ".card__block" ? content :
            selector === "[data-flashcard-outline]" ? panel : toggle,
    });
    return {controller, panel, requests, opened, content, element};
};

test("outline loads lazily and rejects responses after switching cards or closing", () => {
    const f = fixture();
    f.controller.update("first");
    assert.equal(f.requests.length, 0);
    f.controller.toggle();
    f.controller.update("second");
    f.requests[0].callback({data: {rootID: "old", box: "box"}});
    assert.equal(f.requests.length, 2);
    f.requests[1].callback({data: {rootID: "new", box: "box"}});
    assert.equal(JSON.stringify(f.requests[2].data), JSON.stringify({id: "new", notebook: "box"}));
    f.controller.destroy();
    f.requests[2].callback({data: [{id: "heading", name: "Answer"}]});
    assert.equal(f.panel.children.length, 0);
});

test("outline does not expose hidden heading text and opens its source explicitly", () => {
    const f = fixture();
    f.controller.update("source");
    f.controller.toggle();
    f.requests[0].callback({data: {rootID: "doc", box: "box"}});
    f.requests[1].callback({data: [{id: "heading", name: "Secret answer"}]});
    assert.equal(f.panel.children[0].children[0].textContent, "Outline 1");
    f.panel.children[0].click();
    assert.deepEqual(f.opened, ["heading"]);
    f.controller.update();
    assert.equal(f.panel.children.length, 0);
});

test("outline can retry a failed request by reopening the panel", () => {
    const f = fixture();
    f.controller.update("source");
    f.controller.toggle();
    f.requests[0].fail();
    f.controller.toggle();
    f.controller.toggle();
    assert.equal(f.requests.length, 2);
});

test("visible headings scroll within the card without opening another document", () => {
    const f = fixture();
    const heading = f.element();
    heading.dataset.nodeId = "heading";
    heading.textContent = "Chapter";
    heading.top = 300;
    f.content.children.push(heading);
    f.controller.update("source");
    f.controller.toggle();
    f.requests[0].callback({data: {rootID: "doc", box: "box"}});
    f.requests[1].callback({data: [{id: "heading", name: "Chapter"}]});
    assert.equal(f.panel.children[0].children[0].textContent, "Chapter");
    f.panel.children[0].click();
    assert.equal(f.content.scrollTop, 300);
    assert.equal(f.opened.length, 0);
});
