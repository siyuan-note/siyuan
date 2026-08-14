import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {updateScrollVisibility} from "./visibility";

const createElement = () => {
    const classes = new Set<string>();
    return {
        element: {
            classList: {
                toggle: (name: string, force: boolean) => {
                    if (force) {
                        classes.add(name);
                    } else {
                        classes.delete(name);
                    }
                },
            },
        } as unknown as HTMLElement,
        hasClass: (name: string) => classes.has(name),
    };
};

describe("updateScrollVisibility", () => {
    it("hides the container and bar", () => {
        const parent = createElement();
        const bar = createElement();

        updateScrollVisibility(parent.element, bar.element, false, false);

        assert.equal(parent.hasClass("fn__none"), true);
        assert.equal(bar.hasClass("fn__none"), true);
    });

    it("shows the container while keeping the bar hidden", () => {
        const parent = createElement();
        const bar = createElement();

        updateScrollVisibility(parent.element, bar.element, true, false);

        assert.equal(parent.hasClass("fn__none"), false);
        assert.equal(bar.hasClass("fn__none"), true);
    });

    it("shows the container and bar", () => {
        const parent = createElement();
        const bar = createElement();
        updateScrollVisibility(parent.element, bar.element, false, false);

        updateScrollVisibility(parent.element, bar.element, true, true);

        assert.equal(parent.hasClass("fn__none"), false);
        assert.equal(bar.hasClass("fn__none"), false);
    });
});
