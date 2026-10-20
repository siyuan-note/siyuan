import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isClassDeclaration, ModuleKind, ScriptTarget, transpileModule} from "typescript";
import type {Menu} from "./Menu";

const source = createSourceFile("Menu.ts", readFileSync("src/menus/Menu.ts", "utf8"), ScriptTarget.ES2021, true);
const declaration = source.statements.find(statement => isClassDeclaration(statement) && statement.name?.text === "Menu");
const compiled = transpileModule(declaration.getText(source), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const createSheet = (expandable = false) => {
    let closes = 0;
    const listeners = new Map<string, (event: object) => void>();
    const classes = new Set(["b3-menu--sheet"]);
    const element = {
        id: "testMenu",
        style: {transform: "", transition: "", height: "448px"},
        classList: {contains: (name: string) => classes.has(name)},
        getAttribute: () => expandable ? "true" : null,
        clientHeight: 400,
        querySelector: () => ({innerHTML: ""}),
        addEventListener: (type: string, listener: (event: object) => void) => listeners.set(type, listener),
    };
    const exports = {} as {Menu: typeof Menu};
    runInNewContext(compiled, {
        exports,
        isMobile: () => true,
        setSheetExpanded: (_element: unknown, expanded: boolean) => {
            if (expanded) {
                classes.add("b3-menu--expanded");
            } else {
                classes.delete("b3-menu--expanded");
            }
        },
        performance: {now: () => 1000},
        getComputedStyle: () => ({overflowY: "auto"}),
        updateMenuGroupsOnMutation() {},
        MutationObserver: class { observe() {} },
        document: {createElement: () => ({})},
        window: {innerHeight: 800, siyuan: {languages: {back: "Back"}}, setTimeout() {}},
    });
    const menu = new exports.Menu(element as unknown as HTMLElement);
    menu.closeSheet = () => { closes++; };
    (menu as unknown as {setSheetHeight: () => void}).setSheetHeight = () => {
        element.style.height = classes.has("b3-menu--expanded") ? "800px" : "448px";
    };
    const swipe = (options: {sortable?: boolean, title?: boolean, scrollTop?: number}, offset: number) => {
        const items = {scrollHeight: 1000, clientHeight: 400, scrollTop: options.scrollTop || 0, parentElement: element};
        const target = {
            parentElement: items,
            closest: (selector: string) => {
                if (options.sortable && selector.includes('[draggable="true"]')) {
                    return target;
                }
                if (options.title && selector === ".b3-menu__title") {
                    return target;
                }
                return selector === ".b3-menu__items" ? items : null;
            },
        };
        const point = {clientX: 80, clientY: 100};
        const event = {
            target,
            touches: [point],
            changedTouches: [point],
            cancelable: true,
            defaultPrevented: false,
            preventDefault() { this.defaultPrevented = true; },
        };
        listeners.get("touchstart")(event);
        point.clientY += offset;
        listeners.get("touchmove")(event);
        const transform = element.style.transform;
        listeners.get("touchend")(event);
        return {transform, prevented: event.defaultPrevented};
    };
    return {swipe, element, classes, closes: () => closes};
};

test("sorting a menu item downward does not move or dismiss its bottom sheet", () => {
    const sheet = createSheet();
    assert.deepEqual(sheet.swipe({sortable: true}, 200), {transform: "", prevented: false});
    assert.equal(sheet.closes(), 0);
});

test("scrolling a sortable menu upward does not move its bottom sheet", () => {
    const sheet = createSheet();
    assert.deepEqual(sheet.swipe({sortable: true}, -100), {transform: "", prevented: false});
    assert.equal(sheet.closes(), 0);
});

test("scrolling menu content back toward the top does not dismiss its bottom sheet", () => {
    const sheet = createSheet();
    assert.deepEqual(sheet.swipe({scrollTop: 150}, 100), {transform: "", prevented: false});
    assert.equal(sheet.closes(), 0);
});

for (const title of [false, true]) {
    test(`pulling the menu ${title ? "title" : "ordinary content at the top"} downward still dismisses it`, () => {
        const sheet = createSheet();
        assert.deepEqual(sheet.swipe({title}, 200), {transform: "translateY(200px)", prevented: true});
        assert.equal(sheet.closes(), 1);
    });
}

test("pulling a database menu title upward expands it and pulling down restores half height", () => {
    const sheet = createSheet(true);
    assert.equal(sheet.swipe({title: true}, -100).prevented, true);
    assert.equal(sheet.classes.has("b3-menu--expanded"), true);
    assert.equal(sheet.element.style.height, "800px");
    sheet.swipe({title: true}, 200);
    assert.equal(sheet.classes.has("b3-menu--expanded"), false);
    assert.equal(sheet.element.style.height, "448px");
    assert.equal(sheet.closes(), 0);
});

test("scrolling database menu content upward keeps the half-height menu", () => {
    const sheet = createSheet(true);
    assert.equal(sheet.swipe({}, -100).prevented, false);
    assert.equal(sheet.classes.has("b3-menu--expanded"), false);
    assert.equal(sheet.element.style.height, "448px");
});
