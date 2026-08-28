import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {resetMenuHorizontalScroll} from "./menuScroll";

describe("resetMenuHorizontalScroll", () => {
    it("resets every menu layer horizontally without changing vertical positions", () => {
        const submenu = {scrollLeft: 160, scrollTop: 48};
        const submenuItems = {scrollLeft: 80, scrollTop: 96};
        const menuElement = {
            scrollLeft: 40,
            scrollTop: 24,
            querySelectorAll: (selector: string) => {
                assert.equal(selector, ".b3-menu__items, .b3-menu__submenu");
                return [submenu, submenuItems];
            },
        } as unknown as HTMLElement;

        resetMenuHorizontalScroll(menuElement);

        assert.equal(menuElement.scrollLeft, 0);
        assert.equal(submenu.scrollLeft, 0);
        assert.equal(submenuItems.scrollLeft, 0);
        assert.equal(menuElement.scrollTop, 24);
        assert.equal(submenu.scrollTop, 48);
        assert.equal(submenuItems.scrollTop, 96);
    });
});
