import {after, before, describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {insertMobileMultiSelectMenu, renderMultiSelectToolbar, updateMultiSelectToolbar} from "./multiSelectToolbar";

const createMenu = (ids: string[]) => {
    const children: HTMLElement[] = [];
    const createItem = (id: string) => ({
        getAttribute: (name: string) => name === "data-id" ? id : null,
        after(item: HTMLElement) {
            children.splice(children.indexOf(this as unknown as HTMLElement) + 1, 0, item);
        },
    } as unknown as HTMLElement);
    children.push(...ids.map(createItem));
    const element = {children, prepend: (item: HTMLElement) => children.unshift(item)} as unknown as HTMLElement;
    return {element, createItem, ids: () => children.map(item => item.getAttribute("data-id"))};
};

describe("mobile multi-select menu order", () => {
    it("places multi-select immediately after open in new tab and before its separator", () => {
        const menu = createMenu(["plugin", "openInNewTab", "separator_open", "rename", "delete"]);
        insertMobileMultiSelectMenu(menu.element, menu.createItem("multiSelect"));
        assert.deepEqual(menu.ids(), ["plugin", "openInNewTab", "multiSelect", "separator_open", "rename", "delete"]);
    });

    it("places multi-select first in notebook menus without open in new tab", () => {
        const menu = createMenu(["rename", "separator", "closeNotebook"]);
        insertMobileMultiSelectMenu(menu.element, menu.createItem("multiSelect"));
        assert.deepEqual(menu.ids(), ["multiSelect", "rename", "separator", "closeNotebook"]);
    });

    it("supports an empty menu", () => {
        const menu = createMenu([]);
        insertMobileMultiSelectMenu(menu.element, menu.createItem("multiSelect"));
        assert.deepEqual(menu.ids(), ["multiSelect"]);
    });
});

describe("shared mobile multi-select toolbar", () => {
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    before(() => {
        Object.defineProperty(globalThis, "window", {
            configurable: true,
            value: {siyuan: {languages: {more: "More", close: "Close", selectAll: "Select all"}}},
        });
    });
    after(() => {
        if (originalWindow) {
            Object.defineProperty(globalThis, "window", originalWindow);
        } else {
            Reflect.deleteProperty(globalThis, "window");
        }
    });

    const createToolbar = (onSelectAll?: () => void) => {
        const count = {textContent: ""};
        const menu = {dataset: {type: "menu"}, disabled: false};
        const close = {dataset: {type: "exitMultiSelectMode"}, disabled: false};
        let listener: (event: unknown) => void;
        let menuCalls = 0;
        let exitCalls = 0;
        const element = {
            style: {},
            innerHTML: "",
            querySelector: (selector: string) => selector === ".multiSelectCount" ? count : menu,
            firstElementChild: {addEventListener: (_type: string, callback: typeof listener) => { listener = callback; }},
        } as unknown as HTMLElement;
        renderMultiSelectToolbar(element, 1, () => { menuCalls++; }, () => { exitCalls++; }, onSelectAll);
        const click = (button: typeof menu | null) => {
            let prevented = false;
            let stopped = false;
            listener({
                target: {closest: () => button},
                preventDefault: () => { prevented = true; },
                stopPropagation: () => { stopped = true; },
            });
            assert.equal(prevented, true);
            assert.equal(stopped, true);
        };
        return {element, count, menu, close, click, calls: () => [menuCalls, exitCalls]};
    };

    it("offers select all only when requested and allows it with zero selected blocks", () => {
        assert.equal(createToolbar().element.innerHTML.includes('data-type="selectAll"'), false);
        let calls = 0;
        const toolbar = createToolbar(() => { calls++; });
        assert.equal(toolbar.element.innerHTML.includes('data-type="selectAll"'), true);
        updateMultiSelectToolbar(toolbar.element, 0);
        toolbar.click({dataset: {type: "selectAll"}, disabled: false});
        assert.equal(calls, 1);
        assert.deepEqual(toolbar.calls(), [0, 0]);
    });

    it("disables the menu for an empty selection and enables it when selection resumes", () => {
        const toolbar = createToolbar();
        assert.equal(toolbar.count.textContent, "1");
        updateMultiSelectToolbar(toolbar.element, 0);
        assert.equal(toolbar.count.textContent, "0");
        assert.equal(toolbar.menu.disabled, true);
        toolbar.click(toolbar.menu);
        assert.deepEqual(toolbar.calls(), [0, 0]);
        updateMultiSelectToolbar(toolbar.element, 3);
        assert.equal(toolbar.count.textContent, "3");
        assert.equal(toolbar.menu.disabled, false);
        toolbar.click(toolbar.menu);
        assert.deepEqual(toolbar.calls(), [1, 0]);
    });

    it("allows exiting with no selection and keeps background taps from triggering actions", () => {
        const toolbar = createToolbar();
        updateMultiSelectToolbar(toolbar.element, 0);
        toolbar.click(null);
        assert.deepEqual(toolbar.calls(), [0, 0]);
        toolbar.click(toolbar.close);
        assert.deepEqual(toolbar.calls(), [0, 1]);
    });
});
