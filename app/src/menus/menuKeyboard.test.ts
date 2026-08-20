import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {setMenuInputCurrent} from "./menuKeyboard";

const createClassList = (...classNames: string[]) => {
    const classes = new Set(classNames);
    return {
        add(className: string) {
            classes.add(className);
        },
        contains(className: string) {
            return classes.has(className);
        },
        remove(className: string) {
            classes.delete(className);
        },
    } as unknown as DOMTokenList;
};

describe("setMenuInputCurrent", () => {
    it("moves the current state from a hovered action to the focused input container", () => {
        const inputElement = {} as Element;
        const inputItemElement = {
            classList: createClassList(),
            contains: (element: Element) => element === inputElement,
        } as unknown as Element;
        const actionElement = {
            classList: createClassList("b3-menu__item--current"),
        } as unknown as Element;
        const itemsElement = {
            children: [inputItemElement, actionElement],
        } as unknown as Element;
        inputElement.closest = () => itemsElement;
        const menuElement = {
            contains: (element: Element) => element === inputItemElement || element === actionElement,
            querySelectorAll: () => [actionElement],
        } as unknown as Element;

        assert.equal(setMenuInputCurrent(menuElement, inputElement), true);
        assert.equal(inputItemElement.classList.contains("b3-menu__item--current"), true);
        assert.equal(actionElement.classList.contains("b3-menu__item--current"), false);
    });

    it("ignores inputs outside the menu", () => {
        const inputItemElement = {
            classList: createClassList(),
            contains: () => true,
        } as unknown as Element;
        const itemsElement = {
            children: [inputItemElement],
        } as unknown as Element;
        const inputElement = {
            closest: () => itemsElement,
        } as unknown as Element;
        const menuElement = {
            contains: () => false,
            querySelectorAll: (): Element[] => [],
        } as unknown as Element;

        assert.equal(setMenuInputCurrent(menuElement, inputElement), false);
        assert.equal(inputItemElement.classList.contains("b3-menu__item--current"), false);
    });
});
