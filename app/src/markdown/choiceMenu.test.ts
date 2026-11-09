import * as assert from "node:assert/strict";
import {test} from "node:test";
import {createMarkdownSubmenu} from "./choiceMenu";

test("Markdown submenu includes its borders and remeasures after a constrained opening", () => {
    const previous = new Map<string, PropertyDescriptor>();
    const setGlobal = (name: string, value: unknown) => {
        previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
        Object.defineProperty(globalThis, name, {value, configurable: true});
    };
    let anchor = {top: 20, right: 100, left: 0};
    const menu = {
        style: {maxHeight: "", top: "", left: ""},
        firstElementChild: undefined as {getBoundingClientRect(): {top: number}} | undefined,
        getBoundingClientRect: (): {width: number; top: number; height: number} => ({width: 220, top: 0,
            height: menu.style.maxHeight === "none" ? 106.333 : Math.min(106.333, parseFloat(menu.style.maxHeight) || 106.333)}),
        append: () => {}, contains: () => false,
    };
    class Entry extends EventTarget {
        childNodes: Node[] = [];
        className = "";
        innerHTML = "";
        tabIndex = 0;
        classList = {add: () => {}, remove: () => {}};
        attributes = new Map<string, string>();
        parentElement: HTMLElement | undefined;
        setAttribute(name: string, value: string) {this.attributes.set(name, value);}
        getAttribute(name: string) {return this.attributes.get(name);}
        querySelector(selector: string) {return selector === ".b3-menu__label" ? {textContent: ""} : menu;}
        getBoundingClientRect() {return anchor;}
        closest(): undefined {return undefined;}
        contains() {return false;}
    }
    const entry = new Entry();
    setGlobal("document", new EventTarget());
    setGlobal("window", new EventTarget());
    setGlobal("innerWidth", 800);
    setGlobal("innerHeight", 100);
    let submenu: ReturnType<typeof createMarkdownSubmenu>;
    try {
        submenu = createMarkdownSubmenu({element: entry as unknown as HTMLElement, label: "Mode", icon: "iconEdit"});
        entry.dispatchEvent(new Event("click"));
        assert.equal(menu.style.maxHeight, "72px", "constrained menus still scroll within the viewport");
        submenu.close();
        Object.defineProperty(globalThis, "innerHeight", {value: 800, configurable: true});
        entry.dispatchEvent(new Event("click"));
        assert.equal(menu.style.maxHeight, "107px", "fractional content and borders fit without a spurious scrollbar");
        assert.equal(menu.style.left, "100px");
        submenu.close();
        anchor = {top: 100, right: 500, left: 400};
        entry.parentElement = {
            closest: () => ({getBoundingClientRect: () => ({left: 100}),
                parentElement: {getBoundingClientRect: () => ({left: 600})}}),
        } as unknown as HTMLElement;
        menu.firstElementChild = {getBoundingClientRect: () => ({top: 9})};
        entry.dispatchEvent(new Event("click"));
        assert.equal(menu.style.left, "180px", "nested menus inherit leftward expansion even when both sides fit");
        assert.equal(menu.style.top, "91px", "the first item aligns with its parent row");
        submenu.close();
        anchor = {top: 100, right: 150, left: 50};
        entry.dispatchEvent(new Event("click"));
        assert.equal(menu.style.left, "150px", "the opposite direction is available near the viewport edge");
    } finally {
        submenu?.destroy();
        for (const [name, descriptor] of previous) {
            if (descriptor) Object.defineProperty(globalThis, name, descriptor);
            else Reflect.deleteProperty(globalThis, name);
        }
    }
});
