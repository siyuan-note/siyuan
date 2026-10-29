import * as assert from "node:assert/strict";
import {test} from "node:test";
import {ScriptTarget} from "typescript";
import {loadModule} from "../../testSupport/loadModule";
import {isUndoViewportPreserved} from "../undo/viewport";

type ElementSpec = {attrs?: Record<string, string>; children?: ElementSpec[]; tag?: string};
type InsertAnchor = "previousID" | "nextID" | "parentID";
type ContainerType = "editor" | "blockquote" | "list" | "callout" | "tab" | "superblock";

class TestElement {
    parentElement: TestElement | null = null;
    children: TestElement[] = [];
    readonly nodeType = 1;
    readonly tagName: string;
    private attrs: Record<string, string>;
    classList = {
        contains: (name: string) => (this.attrs.class || "").split(" ").includes(name),
        remove: (name: string) => {
            this.attrs.class = (this.attrs.class || "").split(" ").filter(item => item !== name).join(" ");
        },
    };

    constructor(spec: ElementSpec = {}, private parseHTML: (html: string) => TestElement[] = () => []) {
        this.tagName = spec.tag || "DIV";
        this.attrs = {...spec.attrs};
        this.append(...(spec.children || []).map(child => new TestElement(child, parseHTML)));
    }

    get firstElementChild() { return this.children[0] || null; }
    get lastElementChild() { return this.children[this.children.length - 1] || null; }
    get childElementCount() { return this.children.length; }
    get nextElementSibling() {
        return this.parentElement?.children[this.parentElement.children.indexOf(this) + 1] || null;
    }
    get previousElementSibling() {
        return this.parentElement?.children[this.parentElement.children.indexOf(this) - 1] || null;
    }
    get isConnected(): boolean {
        return this.classList.contains("protyle-wysiwyg") || !!this.parentElement?.isConnected;
    }

    getAttribute(name: string) { return this.attrs[name] ?? null; }
    getAttributeNames() { return Object.keys(this.attrs); }
    hasAttribute(name: string) { return name in this.attrs; }
    setAttribute(name: string, value: string) { this.attrs[name] = value; }
    removeAttribute(name: string) { delete this.attrs[name]; }

    append(...elements: TestElement[]) {
        elements.forEach(element => {
            element.remove();
            element.parentElement = this;
            this.children.push(element);
        });
    }

    remove() {
        if (this.parentElement) {
            this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
            this.parentElement = null;
        }
    }

    contains(element: TestElement) {
        for (let current = element; current; current = current.parentElement) {
            if (current === this) {
                return true;
            }
        }
        return false;
    }

    matches(selector: string): boolean {
        if (selector.includes(",")) {
            return selector.split(",").some(part => this.matches(part.trim()));
        }
        if (selector.startsWith(".")) {
            return this.classList.contains(selector.substring(1));
        }
        const attribute = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(selector);
        if (attribute) {
            return attribute[2] === undefined ? this.hasAttribute(attribute[1]) :
                this.getAttribute(attribute[1]) === attribute[2];
        }
        return this.tagName.toLowerCase() === selector;
    }

    closest(selector: string): TestElement | null {
        if (this.matches(selector)) {
            return this;
        }
        return this.parentElement?.closest(selector) || null;
    }

    querySelectorAll(selector: string): TestElement[] {
        if (selector.startsWith(":scope > ")) {
            return this.children.filter(child => child.matches(selector.replaceAll(":scope > ", "")));
        }
        const results: TestElement[] = [];
        const visit = (element: TestElement) => element.children.forEach(child => {
            if (child.matches(selector)) {
                results.push(child);
            }
            visit(child);
        });
        visit(this);
        return results;
    }

    querySelector(selector: string) { return this.querySelectorAll(selector)[0] || null; }

    insertAdjacentHTML(position: "afterbegin" | "afterend" | "beforebegin", html: string) {
        const parent = position === "afterbegin" ? this : this.parentElement;
        const index = position === "afterbegin" ? 0 : parent.children.indexOf(this) + (position === "afterend" ? 1 : 0);
        const inserted = this.parseHTML(html);
        inserted.forEach(element => { element.parentElement = parent; });
        parent.children.splice(index, 0, ...inserted);
    }

    set innerHTML(html: string) {
        this.children.forEach(child => { child.parentElement = null; });
        this.children = [];
        this.append(...this.parseHTML(html));
    }
}

const block = (id: string, type = "NodeParagraph", children: ElementSpec[] = []): ElementSpec => ({
    attrs: {"data-node-id": id, "data-type": type}, children,
});

const fixture = (containerType: ContainerType = "editor") => {
    const snippets = new Map<string, ElementSpec[]>();
    const parseHTML = (html: string) => {
        assert.ok(snippets.has(html), "insertion uses the supplied HTML unchanged");
        return snippets.get(html).map(spec => new TestElement(spec, parseHTML));
    };
    const html = (...specs: ElementSpec[]) => {
        const serialize = (spec: ElementSpec): string => `<${(spec.tag || "DIV").toLowerCase()} ${
            Object.entries(spec.attrs || {}).map(([key, value]) => `${key}="${value}"`).join(" ")}>${
            (spec.children || []).map(serialize).join("")}</${(spec.tag || "DIV").toLowerCase()}>`;
        const value = specs.map(serialize).join("");
        snippets.set(value, specs);
        return value;
    };
    const root = new TestElement({attrs: {class: "protyle-wysiwyg"}}, parseHTML);
    let parent = root;
    if (containerType !== "editor") {
        const types = {blockquote: "NodeBlockquote", list: "NodeListItem", callout: "NodeCallout",
            tab: "NodeTabItem", superblock: "NodeSuperBlock"};
        const classes = {blockquote: "bq", list: "li", callout: "callout", tab: "tab-item", superblock: "sb"};
        parent = new TestElement({attrs: {"data-node-id": "parent", "data-type": types[containerType],
            class: classes[containerType]}}, parseHTML);
        root.append(parent);
        if (containerType === "list") {
            parent.append(new TestElement({attrs: {class: "protyle-action"}}, parseHTML));
        } else if (containerType === "callout" || containerType === "tab") {
            const content = new TestElement({attrs: {class: containerType === "callout" ?
                "callout-content" : "tab-item-content"}}, parseHTML);
            parent.append(content);
            parent = content;
        }
    }
    parent.append(new TestElement(block("before"), parseHTML), new TestElement(block("after"), parseHTML));
    const rendered = {process: [] as string[], highlight: [] as string[], av: [] as string[], block: [] as string[]};
    const focused: string[] = [];
    let commit: () => void;
    const noop = (): void => undefined;
    const identity = (value: string) => value;
    const record = (kind: keyof typeof rendered, element: TestElement) => rendered[kind].push(element.getAttribute("data-node-id"));
    const dependencies = {
        isUndoViewportPreserved,
        Constants: {CUSTOM_SY_AV_STATIC_TEXT: "custom-sy-av-s-text-"},
        normalizeHTMLAssetIFrameBlockDOM: identity,
        invalidateTrackedRangesByOperations: noop, invalidateViewFoldRequests: noop,
        handleViewFoldSourceOperation: () => false, syncTrackedRanges: noop, applyViewFoldStates: noop,
        queueHeadingNumberRefresh: noop, refreshHeadingFoldIndicators: noop, shouldReloadForHeadingBatch: () => false,
        isInEmbedBlock: () => false, refreshSbResize: noop,
        processRender: (element: TestElement) => record("process", element),
        highlightRender: (element: TestElement) => record("highlight", element),
        avRender: (element: TestElement) => record("av", element),
        blockRender: (_protyle: unknown, element: TestElement) => record("block", element),
        getEditorRange: () => ({}), focusBlock: (element: TestElement) => focused.push(element.getAttribute("data-node-id")),
        focusByWbr: (element: TestElement) => focused.push(element.getAttribute("data-node-id")),
        getNextBlockSibling: (element: TestElement) => element.nextElementSibling,
        getPreviousBlockSibling: (element: TestElement) => element.previousElementSibling,
        hasClosestByAttribute: (element: TestElement, attr: string, value: string) => element.closest(`[${attr}="${value}"]`),
        prepareViewFoldTransaction: (_protyle: unknown, doOperations: IOperation[], undoOperations?: IOperation[]) =>
            ({doOperations, undoOperations}),
        cleanBlockSelectionModeHTML: identity, cleanTableCellRichHTML: identity, cleanTableVirtualizationHTML: identity,
        cleanListMindmapHTML: identity, restoreInlineElementBoundaryHTML: identity, cleanHeadingNumberOperations: noop,
        getBlockSelectionStatusIDs: (): string[] => [], countBlockWord: noop, getEditorTransaction: (value: unknown) => value,
        queueTransaction: (_protyle: unknown, submit: () => void) => submit(),
        fetchPost: (_url: string, data: {transactions: unknown[]}, callback: (response: unknown) => void) => {
            commit = () => callback({data: data.transactions});
        },
    };
    const api = loadModule<typeof import("./transaction")>("src/protyle/wysiwyg/transaction.ts", {
        require: () => dependencies,
        window: {siyuan: {config: {fileTree: {}, sync: {provider: 0}}}},
        getSelection: () => ({rangeCount: 0}),
    }, ScriptTarget.ES2021);
    const protyle = {wysiwyg: {element: root}, element: root, options: {},
        block: {rootID: "doc", id: "doc", parentID: "doc"}} as unknown as IProtyle;
    const operation = (anchor: InsertAnchor, ...specs: ElementSpec[]): IOperation => ({
        action: "insert", id: specs[0].attrs["data-node-id"], data: html(...specs),
        ...(anchor === "previousID" ? {previousID: "before"} : anchor === "nextID" ? {nextID: "after"} :
            {parentID: containerType === "editor" ? "doc" : "parent"}),
        context: {setRange: "true"},
    });
    return {api, protyle, root, parent, rendered, focused, operation, commit: () => commit()};
};

const assertRendered = (rendered: ReturnType<typeof fixture>["rendered"], ids: string[], local = false) => {
    for (const kind of local ? ["process", "highlight", "block"] as const :
        ["process", "highlight", "av", "block"] as const) {
        assert.deepEqual(rendered[kind].slice().sort(), ids.slice().sort(), `${kind} initializes only inserted roots`);
    }
};

for (const anchor of ["previousID", "nextID", "parentID"] as const) {
    for (const container of ["editor", "blockquote", "list", "callout", "tab", "superblock"] as const) {
        test(`external ${anchor} insertion in ${container} renders every sibling without changing undo focus`, () => {
            const f = fixture(container);
            f.api.onTransaction(f.protyle, [f.operation(anchor, block("first"), block("second"))], true);
            assertRendered(f.rendered, ["first", "second"]);
            assert.deepEqual(f.focused, [anchor === "nextID" ? "second" : "first"]);
            assert.equal(f.root.querySelectorAll('[data-node-id="first"]').length, 1);
            assert.equal(f.root.querySelectorAll('[data-node-id="second"]').length, 1);
            const ids = f.parent.children.map(item => item.getAttribute("data-node-id")).filter(Boolean);
            assert.deepEqual(ids, anchor === "parentID" ? ["first", "second", "before", "after"] :
                ["before", "first", "second", "after"]);
        });
    }

    test(`external ${anchor} single-root insertion renders once`, () => {
        const f = fixture();
        f.api.onTransaction(f.protyle, [f.operation(anchor, block("first"))], false);
        assertRendered(f.rendered, ["first"]);
        assert.deepEqual(f.focused, []);
    });

    test(`local ${anchor} insertion renders sibling roots and delays database rendering until commit`, () => {
        const f = fixture(anchor === "parentID" ? "list" : "editor");
        f.api.transaction(f.protyle, [f.operation(anchor, block("first"), block("second", "NodeAttributeView"))]);
        assertRendered(f.rendered, ["first", "second"], true);
        assert.deepEqual(f.rendered.av, []);
        f.commit();
        assert.deepEqual(f.rendered.av, ["second"]);
        assert.deepEqual(f.focused, []);
    });
}

test("a single inserted container is rendered once with its descendant blocks", () => {
    const f = fixture();
    f.api.onTransaction(f.protyle, [f.operation("previousID", block("container", "NodeSuperBlock", [
        block("first"), block("second"),
    ]))], false);
    assertRendered(f.rendered, ["container"]);
    assert.equal(f.root.querySelectorAll('[data-node-id="first"]').length, 1);
    assert.equal(f.root.querySelectorAll('[data-node-id="second"]').length, 1);
});

for (const anchor of ["previousID", "nextID", "parentID"] as const) {
    test(`${anchor} insertion renders every root at an open sibling boundary`, () => {
        const f = fixture();
        if (anchor !== "previousID") {
            f.root.querySelector('[data-node-id="before"]').remove();
        }
        if (anchor !== "nextID") {
            f.root.querySelector('[data-node-id="after"]').remove();
        }
        f.api.onTransaction(f.protyle, [f.operation(anchor, block("first"), block("second"))], true);
        assertRendered(f.rendered, ["first", "second"]);
        assert.deepEqual(f.focused, [anchor === "nextID" ? "second" : "first"]);
        assert.deepEqual(f.root.children.map(item => item.getAttribute("data-node-id")),
            anchor === "previousID" ? ["before", "first", "second"] :
                anchor === "nextID" ? ["first", "second", "after"] : ["first", "second"]);
    });

    test(`local ${anchor} insertion does not duplicate blocks that are already in the editor`, () => {
        const f = fixture(anchor === "parentID" ? "list" : "editor");
        const operation = f.operation(anchor, block("first"), block("second"));
        if (anchor === "previousID") {
            f.root.querySelector('[data-node-id="before"]').insertAdjacentHTML("afterend", operation.data as string);
        } else if (anchor === "nextID") {
            f.root.querySelector('[data-node-id="after"]').insertAdjacentHTML("beforebegin", operation.data as string);
        } else {
            f.parent.firstElementChild.insertAdjacentHTML("afterend", operation.data as string);
        }
        const before = f.parent.children.slice();
        f.api.transaction(f.protyle, [operation]);
        assert.equal(f.root.querySelectorAll('[data-node-id="first"]').length, 1);
        assert.equal(f.root.querySelectorAll('[data-node-id="second"]').length, 1);
        assert.deepEqual(f.parent.children, before);
        assertRendered(f.rendered, [], true);
    });
}

test("undo restores and renders every root when the previous anchor and editor content are absent", () => {
    const f = fixture();
    f.root.children.slice().forEach(item => item.remove());
    f.api.onTransaction(f.protyle, [f.operation("previousID", block("first"), block("second"))], true);
    assertRendered(f.rendered, ["first", "second"]);
    assert.deepEqual(f.focused, ["first"]);
    assert.deepEqual(f.root.children.map(item => item.getAttribute("data-node-id")), ["first", "second"]);
});
