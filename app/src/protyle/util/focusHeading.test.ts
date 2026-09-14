import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {getFocusedHeadingChildren} from "./heading";
import * as focusFold from "./focusFold";

class HeadingElement {
    isConnected = true;
    children: HeadingElement[] = [];
    parent: HeadingElement;
    classList = {contains: (name: string) => this.attrs.class === name};

    constructor(public attrs: Record<string, string> = {}) {}

    get firstElementChild() {
        return this.children[0] || null;
    }

    get lastElementChild() {
        return this.children[this.children.length - 1] || null;
    }

    get nextElementSibling() {
        return this.parent?.children[this.parent.children.indexOf(this) + 1] || null;
    }

    getAttribute(name: string) {
        return this.attrs[name] ?? null;
    }

    hasAttribute(name: string) {
        return name in this.attrs;
    }

    setAttribute(name: string, value: string) {
        this.attrs[name] = value;
    }

    removeAttribute(name: string) {
        delete this.attrs[name];
    }

    contains(element: HeadingElement): boolean {
        return element === this || this.children.some(child => child.contains(element));
    }

    querySelector(selector: string): HeadingElement {
        return this.children.find(child => selector === `[data-node-id="${child.getAttribute("data-node-id")}"]`);
    }

    append(...children: HeadingElement[]) {
        children.forEach(child => {
            if (child.parent) {
                child.remove();
            }
            child.parent = this;
            this.children.push(child);
        });
        return this;
    }

    appendChild(child: HeadingElement) {
        this.append(child);
        return child;
    }

    after(fragment: HeadingElement) {
        const children = [...fragment.children];
        children.forEach(child => {
            child.remove();
            child.parent = this.parent;
        });
        this.parent.children.splice(this.parent.children.indexOf(this) + 1, 0, ...children);
    }

    remove() {
        this.parent.children.splice(this.parent.children.indexOf(this), 1);
        this.parent = undefined;
    }

    querySelectorAll(): HeadingElement[] {
        return this.children.flatMap(child => [
            ...(child.attrs["data-type"] === "NodeHeading" && child.attrs.fold === "1" ? [child] : []),
            ...child.querySelectorAll(),
        ]);
    }

    asFragment() {
        return this as unknown as DocumentFragment;
    }
}

const heading = (id: string, level: number, folded = false) => new HeadingElement({
    "data-node-id": id,
    "data-type": "NodeHeading",
    "data-subtype": `h${level}`,
    fold: folded ? "1" : "0",
});

const compiledViewFold = transpileModule(readFileSync("src/protyle/util/viewFold.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const loadView = (responseContent: HeadingElement) => {
    const exports = {} as {applyFocusFold: (protyle: IProtyle) => Promise<void>};
    let requests = 0;
    const dependencies = {
        fetchSyncPost: async (url: string, data: {id: string, removeFoldAttr: boolean}) => {
            assert.equal(url, "/api/block/getHeadingChildrenDOM");
            assert.equal(data.id, "parent");
            assert.equal(data.removeFoldAttr, false);
            requests++;
            return {code: 0, data: "heading response"};
        },
        normalizeHTMLAssetIFrameBlockDOM: (html: string) => html,
        processRender: (): void => undefined,
        highlightRender: (): void => undefined,
        avRender: (): void => undefined,
        blockRender: (): void => undefined,
        renderHeadingNumbers: (): void => undefined,
        queueHeadingNumberRefresh: (): void => undefined,
        updateDocumentBottomEof: (): void => undefined,
    };
    runInNewContext(compiledViewFold, {
        exports,
        require: (id: string) => id === "./focusFold" ? focusFold :
            id === "./heading" ? {getFocusedHeadingChildren} : dependencies,
        document: {
            createElement: () => ({content: responseContent.asFragment(), innerHTML: ""}),
            createDocumentFragment: () => new HeadingElement(),
        },
    });
    return {apply: exports.applyFocusFold, requests: () => requests};
};

describe("focused heading view integration", () => {
    it("merges missing content without overwriting edited blocks and preserves the bottom boundary", async () => {
        const parent = heading("parent", 1, true);
        const edited = paragraph("edited");
        edited.setAttribute("custom-value", "local edit");
        edited.setAttribute("data-eof", "2");
        const root = new HeadingElement().append(parent, edited);
        const response = new HeadingElement().append(
            heading("parent", 1, true), paragraph("intro"), paragraph("edited"),
            heading("child", 2, true), paragraph("hidden"), heading("sibling", 2), paragraph("visible"),
        );
        const view = loadView(response);
        const protyle = {
            block: {id: "parent", rootID: "doc", showAll: true},
            options: {render: {scroll: false}},
            wysiwyg: {element: root},
        } as unknown as IProtyle;
        await view.apply(protyle);
        assert.deepEqual(root.children.map(element => element.getAttribute("data-node-id")), [
            "parent", "intro", "edited", "child", "sibling", "visible",
        ]);
        assert.equal(root.children[2], edited);
        assert.equal(edited.getAttribute("custom-value"), "local edit");
        assert.equal(edited.getAttribute("data-eof"), null);
        assert.equal(root.lastElementChild.getAttribute("data-eof"), "2");
        assert.equal(parent.getAttribute("fold"), null);
        assert.equal(parent.getAttribute("data-view-fold-source"), "1");
        assert.equal(root.children[3].getAttribute("fold"), "1");
        await view.apply(protyle);
        assert.equal(view.requests(), 1);
    });

    it("keeps already loaded, unfolded heading content without another request", async () => {
        const root = new HeadingElement().append(heading("parent", 1), paragraph("content"));
        const view = loadView(new HeadingElement());
        await view.apply({
            block: {id: "parent", rootID: "doc", showAll: true},
            options: {render: {scroll: false}},
            wysiwyg: {element: root},
        } as unknown as IProtyle);
        assert.equal(view.requests(), 0);
        assert.equal(root.children.length, 2);
    });
});
const paragraph = (id: string) => new HeadingElement({"data-node-id": id, "data-type": "NodeParagraph"});

describe("focused heading content", () => {
    it("reveals the parent content while omitting folded subheadings' content", () => {
        const parent = heading("parent", 1, true);
        const child = heading("child", 2, true);
        const sibling = heading("sibling", 2);
        const content = new HeadingElement().append(
            parent, paragraph("intro"), child, paragraph("hidden"),
            heading("grandchild", 3, true), paragraph("deep-hidden"),
            sibling, paragraph("visible"), heading("expanded-grandchild", 3), paragraph("deep-visible"),
        );
        const result = getFocusedHeadingChildren(content.asFragment(), "parent");
        assert.equal(result.folded, true);
        assert.deepEqual(result.children.map(element => element.getAttribute("data-node-id")), [
            "intro", "child", "sibling", "visible", "expanded-grandchild", "deep-visible",
        ]);
        assert.equal(child.getAttribute("fold"), "1");
        assert.equal(sibling.getAttribute("fold"), "0");
    });

    it("preserves list folding and prunes headings inside containers without removing their attributes", () => {
        const foldedList = new HeadingElement({"data-type": "NodeListItem", fold: "1"})
            .append(paragraph("list-content"));
        const nestedHeading = heading("nested", 3, true);
        const attributes = new HeadingElement({class: "protyle-attr"});
        const quote = new HeadingElement({"data-type": "NodeBlockquote"})
            .append(nestedHeading, paragraph("hidden"), attributes);
        const content = new HeadingElement().append(heading("parent", 1, true), foldedList, quote);
        const result = getFocusedHeadingChildren(content.asFragment(), "parent");
        assert.equal(result.children.length, 2);
        assert.equal(foldedList.getAttribute("fold"), "1");
        assert.equal(foldedList.children.length, 1);
        assert.deepEqual(quote.children, [nestedHeading, attributes]);
    });

    it("accepts an empty heading and rejects mismatched or invalid responses without modifying them", () => {
        const empty = new HeadingElement().append(heading("parent", 1));
        const result = getFocusedHeadingChildren(empty.asFragment(), "parent");
        assert.equal(result.folded, false);
        assert.equal(result.children.length, 0);
        const wrong = new HeadingElement().append(heading("other", 1), paragraph("content"));
        assert.equal(getFocusedHeadingChildren(wrong.asFragment(), "parent"), undefined);
        assert.equal(wrong.children.length, 2);
        const invalid = new HeadingElement().append(paragraph("parent"));
        assert.equal(getFocusedHeadingChildren(invalid.asFragment(), "parent"), undefined);
        assert.equal(invalid.children.length, 1);
        assert.equal(getFocusedHeadingChildren(new HeadingElement().asFragment(), "parent"), undefined);
    });
});
