import * as assert from "node:assert/strict";
import {describe, it} from "node:test";
import {bindThinkingCardToggle} from "./thinkingCard";

class FakeClassList {
    private readonly values = new Set<string>();

    constructor(values: string[] = []) {
        values.forEach(value => this.values.add(value));
    }

    add(...values: string[]) {
        values.forEach(value => this.values.add(value));
    }

    remove(...values: string[]) {
        values.forEach(value => this.values.delete(value));
    }

    contains(value: string) {
        return this.values.has(value);
    }

    toggle(value: string, force?: boolean) {
        const enabled = force === undefined ? !this.values.has(value) : force;
        if (enabled) {
            this.values.add(value);
        } else {
            this.values.delete(value);
        }
        return enabled;
    }
}

class FakeElement extends EventTarget {
    readonly classList: FakeClassList;
    readonly attributes = new Map<string, string>();
    readonly children = new Map<string, FakeElement>();
    scrollLeft = 0;
    scrollWidth = 0;

    constructor(classes: string[] = []) {
        super();
        this.classList = new FakeClassList(classes);
    }

    querySelector(selector: string) {
        return this.children.get(selector) || null;
    }

    setAttribute(name: string, value: string) {
        this.attributes.set(name, value);
    }
}

const createThinkingCard = (options: { done?: boolean; preview?: boolean } = {}) => {
    const card = new FakeElement(options.done ? ["agent-chat__msg--thinking-done"] : []);
    const header = new FakeElement();
    const body = new FakeElement(options.preview ? ["agent-chat__thinking-body--preview"] : []);
    const expandIcon = new FakeElement();
    const contractIcon = new FakeElement(["fn__none"]);
    const latest = new FakeElement(options.done ? ["fn__none"] : []);
    latest.scrollWidth = 240;
    card.children.set(".agent-chat__thinking-header", header);
    card.children.set(".agent-chat__thinking-body", body);
    card.children.set(".agent-chat__thinking-arrow--expand", expandIcon);
    card.children.set(".agent-chat__thinking-arrow--contract", contractIcon);
    card.children.set(".agent-chat__thinking-latest", latest);
    bindThinkingCardToggle(card as unknown as HTMLElement);
    return {card, header, body, expandIcon, contractIcon, latest};
};

describe("thinking card toggle", () => {
    it("expands a collapsed streaming card on the first click", () => {
        const card = createThinkingCard();

        card.header.dispatchEvent(new Event("click"));

        assert.equal(card.body.classList.contains("agent-chat__thinking-body--expanded"), true);
        assert.equal(card.body.classList.contains("agent-chat__thinking-body--preview"), false);
        assert.equal(card.expandIcon.classList.contains("fn__none"), true);
        assert.equal(card.contractIcon.classList.contains("fn__none"), false);
        assert.equal(card.latest.classList.contains("fn__none"), true);
        assert.equal(card.card.attributes.get("data-user-interacted"), "true");
    });

    it("returns an expanded streaming card to the single-line collapsed state", () => {
        const card = createThinkingCard();
        card.header.dispatchEvent(new Event("click"));

        card.header.dispatchEvent(new Event("click"));

        assert.equal(card.body.classList.contains("agent-chat__thinking-body--expanded"), false);
        assert.equal(card.expandIcon.classList.contains("fn__none"), false);
        assert.equal(card.contractIcon.classList.contains("fn__none"), true);
        assert.equal(card.latest.classList.contains("fn__none"), false);
        assert.equal(card.latest.scrollLeft, card.latest.scrollWidth);
    });

    it("skips the legacy preview state when expanding", () => {
        const card = createThinkingCard({preview: true});

        card.header.dispatchEvent(new Event("click"));

        assert.equal(card.body.classList.contains("agent-chat__thinking-body--preview"), false);
        assert.equal(card.body.classList.contains("agent-chat__thinking-body--expanded"), true);
    });

    it("keeps the latest line hidden after completed thinking is collapsed", () => {
        const card = createThinkingCard({done: true});
        card.header.dispatchEvent(new Event("click"));

        card.header.dispatchEvent(new Event("click"));

        assert.equal(card.body.classList.contains("agent-chat__thinking-body--expanded"), false);
        assert.equal(card.latest.classList.contains("fn__none"), true);
    });
});
