import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    consumeGutterFoldRestore,
    hideGutterElements,
    markGutterForFoldRestore,
    isGutterTouchDragging,
    setGutterTouchDragging,
    shouldHideGutterAfterFold
} from "./gutterVisibility";

const createElement = (content: string) => {
    const classes = new Set<string>();
    return {
        element: {
            classList: {
                add: (name: string) => classes.add(name),
            },
            innerHTML: content,
        } as unknown as HTMLElement,
        hasClass: (name: string) => classes.has(name),
    };
};

describe("hideGutterElements", () => {
    it("preserves only the touched gutter across keyboard layout cleanup", () => {
        const source = createElement("source");
        const other = createElement("other");
        setGutterTouchDragging(source.element, true);
        for (const hidden of [true, false]) {
            hideGutterElements([source.element, other.element], hidden);
            assert.equal(source.element.innerHTML, "source");
            assert.equal(source.hasClass("fn__none"), false);
            assert.equal(other.element.innerHTML, "");
        }
        setGutterTouchDragging(source.element, false);
        assert.equal(isGutterTouchDragging(source.element), false);
        hideGutterElements([source.element], true);
        assert.equal(source.element.innerHTML, "");
        assert.equal(source.hasClass("fn__none"), true);
    });

    it("hides and clears every gutter in the editor hierarchy", () => {
        const parent = createElement("parent");
        const nested = createElement("nested");

        hideGutterElements([parent.element, nested.element], true);

        assert.equal(parent.hasClass("fn__none"), true);
        assert.equal(nested.hasClass("fn__none"), true);
        assert.equal(parent.element.innerHTML, "");
        assert.equal(nested.element.innerHTML, "");
    });

    it("clears gutters without hiding them when requested", () => {
        const gutter = createElement("content");

        hideGutterElements([gutter.element], false);

        assert.equal(gutter.hasClass("fn__none"), false);
        assert.equal(gutter.element.innerHTML, "");
    });
});

describe("shouldHideGutterAfterFold", () => {
    it("展开或折叠块后保留块标", () => {
        assert.equal(shouldHideGutterAfterFold(0), false);
        assert.equal(shouldHideGutterAfterFold(1), false);
    });

    it("折叠状态未变化时隐藏块标", () => {
        assert.equal(shouldHideGutterAfterFold(-1), true);
    });
});

describe("gutter fold restore", () => {
    const createGutter = () => {
        const attributes = new Map<string, string>();
        return {
            element: {
                getAttribute: (name: string) => attributes.get(name) || null,
                removeAttribute: (name: string) => attributes.delete(name),
                setAttribute: (name: string, value: string) => attributes.set(name, value),
            } as unknown as HTMLElement,
            attributes,
        };
    };

    it("记录并消费需要恢复块标的折叠操作", () => {
        const gutter = createGutter();

        assert.equal(markGutterForFoldRestore(gutter.element, "heading", 1), true);
        assert.equal(consumeGutterFoldRestore(gutter.element, "heading"), true);
        assert.equal(consumeGutterFoldRestore(gutter.element, "heading"), false);
        assert.equal(markGutterForFoldRestore(gutter.element, "heading", 0), true);
        assert.equal(consumeGutterFoldRestore(gutter.element, "heading"), true);
    });

    it("不记录未改变状态的折叠操作", () => {
        const gutter = createGutter();

        assert.equal(markGutterForFoldRestore(gutter.element, "heading", -1), false);
        assert.equal(gutter.attributes.size, 0);
    });
});
