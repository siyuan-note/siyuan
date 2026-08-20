import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    captureBacklinkReadingAnchor,
    type IBacklinkReadingAnchor,
    restoreBacklinkReadingAnchor,
    selectBacklinkReadingAnchorCandidate
} from "./backlinkReadingAnchor";

interface IRect {
    top: number,
    bottom: number,
}

class FakeElement {
    public parentElement: FakeElement | null = null;
    public scrollTop = 0;
    private readonly attributes = new Map<string, string>();
    private readonly classNames = new Set<string>();
    private readonly childElements: FakeElement[] = [];
    private rect: IRect;

    constructor(rect: IRect, classNames = "") {
        this.rect = rect;
        classNames.split(" ").filter(Boolean).forEach(item => this.classNames.add(item));
    }

    public append(...elements: FakeElement[]) {
        elements.forEach(element => {
            element.parentElement = this;
            this.childElements.push(element);
        });
        return this;
    }

    public setAttribute(name: string, value: string) {
        this.attributes.set(name, value);
        return this;
    }

    public setRect(rect: IRect) {
        this.rect = rect;
    }

    public getAttribute(name: string) {
        return this.attributes.get(name) || null;
    }

    public hasAttribute(name: string) {
        return this.attributes.has(name);
    }

    public get children() {
        return this.childElements as unknown as HTMLCollection;
    }

    public get previousElementSibling() {
        if (!this.parentElement) {
            return null;
        }
        const index = this.parentElement.childElements.indexOf(this);
        return index > 0 ? this.parentElement.childElements[index - 1] : null;
    }

    public get nextElementSibling() {
        if (!this.parentElement) {
            return null;
        }
        const index = this.parentElement.childElements.indexOf(this);
        return index > -1 && index < this.parentElement.childElements.length - 1 ?
            this.parentElement.childElements[index + 1] : null;
    }

    public matches(selector: string) {
        const classNames = Array.from(selector.matchAll(/\.([\w-]+)/g), item => item[1]);
        const attributes = Array.from(selector.matchAll(/\[([\w-]+)\]/g), item => item[1]);
        return classNames.every(item => this.classNames.has(item)) &&
            attributes.every(item => this.hasAttribute(item));
    }

    public closest(selector: string): FakeElement | null {
        if (this.matches(selector)) {
            return this;
        }
        return this.parentElement?.closest(selector) || null;
    }

    public querySelectorAll(selector: string) {
        const descendants: FakeElement[] = [];
        const visit = (element: FakeElement) => {
            element.childElements.forEach(child => {
                descendants.push(child);
                visit(child);
            });
        };
        visit(this);
        const selectorParts = selector.split(" ");
        if (selectorParts.length === 1) {
            return descendants.filter(item => item.matches(selector));
        }
        const targetSelector = selectorParts[selectorParts.length - 1];
        const ancestorSelector = selectorParts.slice(0, -1).join(" ");
        return descendants.filter(item => item.matches(targetSelector) && Boolean(item.closest(ancestorSelector)));
    }

    public getBoundingClientRect() {
        return {
            top: this.rect.top,
            bottom: this.rect.bottom,
            height: this.rect.bottom - this.rect.top,
        } as DOMRect;
    }
}

const asHTMLElement = (element: FakeElement) => element as unknown as HTMLElement;

const createBlock = (id: string, rect: IRect, type = "NodeParagraph") => {
    return new FakeElement(rect)
        .setAttribute("data-node-id", id)
        .setAttribute("data-type", type);
};

const createFixture = () => {
    const scrollElement = new FakeElement({top: 0, bottom: 200});
    const scopeElement = new FakeElement({top: -100, bottom: 400});
    const documentElement = new FakeElement({top: -80, bottom: 350}, "backlinkList__item")
        .setAttribute("data-node-id", "root-a");
    const titleElement = new FakeElement({top: -80, bottom: -50}, "b3-list-item")
        .setAttribute("data-node-id", "root-a");
    const wysiwygElement = new FakeElement({top: -50, bottom: 350}, "protyle-wysiwyg");
    const breadcrumbElement = new FakeElement({top: -50, bottom: -30}, "protyle-breadcrumb__bar")
        .setAttribute("data-backlink-id", "occurrence-a");
    const parentBlock = createBlock("parent", {top: -20, bottom: 120}, "NodeList");
    const activeBlock = createBlock("active", {top: -5, bottom: 35});
    const nextBlock = createBlock("next", {top: 40, bottom: 80});
    parentBlock.append(activeBlock);
    wysiwygElement.append(breadcrumbElement, parentBlock, nextBlock);
    documentElement.append(titleElement, wysiwygElement);
    scopeElement.append(documentElement);
    return {
        scrollElement,
        scopeElement,
        documentElement,
        titleElement,
        wysiwygElement,
        breadcrumbElement,
        parentBlock,
        activeBlock,
        nextBlock,
    };
};

const captureFixture = (fixture: ReturnType<typeof createFixture>) => captureBacklinkReadingAnchor({
    scopeElement: asHTMLElement(fixture.scopeElement),
    scrollElement: asHTMLElement(fixture.scrollElement),
    pane: "backlink",
    queryKey: "query-a",
});

const restoreFixture = (
    fixture: ReturnType<typeof createFixture>,
    anchor: IBacklinkReadingAnchor,
    pane: "backlink" | "backmention" = "backlink",
    queryKey = "query-a",
) => restoreBacklinkReadingAnchor({
    anchor,
    scopeElement: asHTMLElement(fixture.scopeElement),
    scrollElement: asHTMLElement(fixture.scrollElement),
    pane,
    queryKey,
});

describe("selectBacklinkReadingAnchorCandidate", () => {
    it("selects the deepest and smallest block crossing the viewport top", () => {
        const parent = {id: "parent", top: -20, bottom: 120, height: 140, depth: 2, order: 0};
        const child = {id: "child", top: -5, bottom: 35, height: 40, depth: 4, order: 1};
        const below = {id: "below", top: 10, bottom: 30, height: 20, depth: 5, order: 2};

        assert.equal(selectBacklinkReadingAnchorCandidate([parent, below, child], 0, 100), child);
    });

    it("selects the nearest visible block below the viewport top", () => {
        const first = {id: "first", top: 20, bottom: 80, height: 60, depth: 2, order: 0};
        const precise = {id: "precise", top: 20, bottom: 50, height: 30, depth: 3, order: 1};
        const outside = {id: "outside", top: 120, bottom: 150, height: 30, depth: 5, order: 2};

        assert.equal(selectBacklinkReadingAnchorCandidate([outside, first, precise], 0, 100), precise);
    });
});

describe("captureBacklinkReadingAnchor", () => {
    it("captures an occurrence-scoped nested block with neighboring candidates", () => {
        const fixture = createFixture();

        assert.deepEqual(captureFixture(fixture), {
            pane: "backlink",
            rootID: "root-a",
            occurrenceID: "occurrence-a",
            blockID: "active",
            offset: -5,
            previousBlockID: "parent",
            nextBlockID: "next",
            queryKey: "query-a",
        });
    });

    it("uses the explicit owner viewport when the scope starts lower in it", () => {
        const fixture = createFixture();
        fixture.scopeElement.setRect({top: 80, bottom: 400});
        fixture.parentBlock.setRect({top: 85, bottom: 150});
        fixture.activeBlock.setRect({top: 85, bottom: 110});
        fixture.nextBlock.setRect({top: 120, bottom: 150});

        assert.equal(captureFixture(fixture)?.offset, 85);
    });

    it("captures a document-only anchor before its backlink blocks are hydrated", () => {
        const fixture = createFixture();
        fixture.titleElement.setRect({top: 20, bottom: 50});
        fixture.parentBlock.setRect({top: 0, bottom: 0});
        fixture.activeBlock.setRect({top: 0, bottom: 0});
        fixture.nextBlock.setRect({top: 0, bottom: 0});

        assert.deepEqual(captureFixture(fixture), {
            pane: "backlink",
            rootID: "root-a",
            occurrenceID: "",
            blockID: "",
            offset: 20,
            queryKey: "query-a",
        });
    });
});

describe("restoreBacklinkReadingAnchor", () => {
    it("restores the exact block at the captured visual offset", () => {
        const fixture = createFixture();
        const anchor = captureFixture(fixture);
        fixture.activeBlock.setRect({top: 25, bottom: 65});

        assert.equal(restoreFixture(fixture, anchor), "block");
        assert.equal(fixture.scrollElement.scrollTop, 30);
    });

    it("falls back to the next block before the previous block", () => {
        const fixture = createFixture();
        const anchor = captureFixture(fixture);
        fixture.activeBlock.setAttribute("data-node-id", "replacement");

        assert.equal(restoreFixture(fixture, anchor), "next");
        assert.equal(fixture.scrollElement.scrollTop, 45);
    });

    it("skips hidden exact and neighboring block targets", () => {
        const hiddenExactFixture = createFixture();
        const hiddenExactAnchor = captureFixture(hiddenExactFixture);
        hiddenExactFixture.activeBlock.setRect({top: 0, bottom: 0});
        assert.equal(restoreFixture(hiddenExactFixture, hiddenExactAnchor), "next");

        const hiddenNextFixture = createFixture();
        const hiddenNextAnchor = captureFixture(hiddenNextFixture);
        hiddenNextFixture.activeBlock.setAttribute("data-node-id", "replacement");
        hiddenNextFixture.nextBlock.setRect({top: 0, bottom: 0});
        assert.equal(restoreFixture(hiddenNextFixture, hiddenNextAnchor), "previous");

        const hiddenPreviousFixture = createFixture();
        const hiddenPreviousAnchor = captureFixture(hiddenPreviousFixture);
        hiddenPreviousFixture.activeBlock.setAttribute("data-node-id", "replacement");
        hiddenPreviousFixture.nextBlock.setAttribute("data-node-id", "replacement-next");
        hiddenPreviousFixture.parentBlock.setRect({top: 0, bottom: 0});
        assert.equal(restoreFixture(hiddenPreviousFixture, hiddenPreviousAnchor), "occurrence");
    });

    it("falls back through the previous block and occurrence breadcrumb", () => {
        const previousFixture = createFixture();
        const previousAnchor = captureFixture(previousFixture);
        previousFixture.activeBlock.setAttribute("data-node-id", "replacement");
        previousFixture.nextBlock.setAttribute("data-node-id", "replacement-next");
        assert.equal(restoreFixture(previousFixture, previousAnchor), "previous");

        const occurrenceFixture = createFixture();
        const occurrenceAnchor = captureFixture(occurrenceFixture);
        occurrenceFixture.activeBlock.setAttribute("data-node-id", "replacement");
        occurrenceFixture.nextBlock.setAttribute("data-node-id", "replacement-next");
        occurrenceFixture.parentBlock.setAttribute("data-node-id", "replacement-parent");
        assert.equal(restoreFixture(occurrenceFixture, occurrenceAnchor), "occurrence");
    });

    it("does not restore a matching block ID from another occurrence", () => {
        const fixture = createFixture();
        const anchor = captureFixture(fixture);
        fixture.activeBlock.setAttribute("data-node-id", "replacement");
        fixture.nextBlock.setAttribute("data-node-id", "replacement-next");
        fixture.parentBlock.setAttribute("data-node-id", "replacement-parent");
        fixture.wysiwygElement.append(
            new FakeElement({top: 200, bottom: 220}, "protyle-breadcrumb__bar")
                .setAttribute("data-backlink-id", "occurrence-b"),
            createBlock("active", {top: 220, bottom: 260}),
        );

        assert.equal(restoreFixture(fixture, anchor), "occurrence");
    });

    it("falls back to the document title when the occurrence no longer exists", () => {
        const fixture = createFixture();
        const anchor = captureFixture(fixture);
        fixture.breadcrumbElement.setAttribute("data-backlink-id", "replacement-occurrence");

        assert.equal(restoreFixture(fixture, anchor), "document");
    });

    it("restores a document-only anchor to its title", () => {
        const fixture = createFixture();
        fixture.titleElement.setRect({top: 20, bottom: 50});
        fixture.parentBlock.setRect({top: 0, bottom: 0});
        fixture.activeBlock.setRect({top: 0, bottom: 0});
        fixture.nextBlock.setRect({top: 0, bottom: 0});
        const anchor = captureFixture(fixture);
        fixture.titleElement.setRect({top: 70, bottom: 100});

        assert.equal(restoreFixture(fixture, anchor), "document");
        assert.equal(fixture.scrollElement.scrollTop, 50);
    });

    it("does not restore while the section or selected fallback target is hidden", () => {
        const hiddenSectionFixture = createFixture();
        const hiddenSectionAnchor = captureFixture(hiddenSectionFixture);
        hiddenSectionFixture.scopeElement.setRect({top: 0, bottom: 0});
        assert.equal(restoreFixture(hiddenSectionFixture, hiddenSectionAnchor), undefined);
        assert.equal(hiddenSectionFixture.scrollElement.scrollTop, 0);

        const hiddenTargetFixture = createFixture();
        const hiddenTargetAnchor = captureFixture(hiddenTargetFixture);
        hiddenTargetFixture.activeBlock.setAttribute("data-node-id", "replacement");
        hiddenTargetFixture.nextBlock.setAttribute("data-node-id", "replacement-next");
        hiddenTargetFixture.parentBlock.setAttribute("data-node-id", "replacement-parent");
        hiddenTargetFixture.breadcrumbElement.setRect({top: 0, bottom: 0});
        assert.equal(restoreFixture(hiddenTargetFixture, hiddenTargetAnchor), undefined);
        assert.equal(hiddenTargetFixture.scrollElement.scrollTop, 0);
    });

    it("rejects anchors from another pane or query", () => {
        const fixture = createFixture();
        const anchor = captureFixture(fixture);

        assert.equal(restoreFixture(fixture, anchor, "backmention"), undefined);
        assert.equal(restoreFixture(fixture, anchor, "backlink", "query-b"), undefined);
        assert.equal(fixture.scrollElement.scrollTop, 0);
    });
});
