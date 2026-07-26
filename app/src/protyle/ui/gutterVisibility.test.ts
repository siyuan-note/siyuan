import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {hideGutterElements} from "./gutterVisibility";

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
