import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isClassDeclaration, ModuleKind, ScriptTarget, transpileModule} from "typescript";
import type {Menu} from "./Menu";
import {getMobileSheetBounds, moveSheetGesture} from "../mobile/util/mobileSheetGesture";
import {getVisibleSheetViewport} from "./sheetOpen";

const source = createSourceFile("Menu.ts", readFileSync("src/menus/Menu.ts", "utf8"), ScriptTarget.ES2021, true);
const declaration = source.statements.find(statement => isClassDeclaration(statement) && statement.name?.text === "Menu");
const compiled = transpileModule(declaration.getText(source), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const createSheet = (expandable = false, realSizing = false) => {
    let closes = 0;
    let now = 1000;
    let busy = false;
    const listeners = new Map<string, (event: object) => void>();
    const classes = new Set(["b3-menu--sheet"]);
    const element = {
        id: "testMenu",
        style: {transform: "", transition: "", height: "448px"},
        classList: {contains: (name: string) => classes.has(name)},
        getAttribute: (name: string) => name === "aria-busy" ? String(busy) : expandable ? "true" : null,
        get clientHeight() { return parseFloat(this.style.height); },
        firstElementChild: {getBoundingClientRect: () => ({height: 16})},
        lastElementChild: {style: {flex: ""}, scrollHeight: 1000, get clientHeight() { return element.clientHeight - 16; }},
        querySelector: () => ({innerHTML: ""}),
        addEventListener: (type: string, listener: (event: object) => void) => listeners.set(type, listener),
    };
    const exports = {} as {Menu: typeof Menu};
    const window = {innerWidth: 390, innerHeight: 800, visualViewport: {height: 800, offsetTop: 0},
        siyuan: {languages: {back: "Back"}, mobile: {size: {portrait: {height1: 800}}}}, setTimeout() {}};
    runInNewContext(compiled, {
        exports,
        fullscreenCloseTimeout: undefined,
        clearTimeout() {}, Constants: {TIMEOUT_DBLCLICK: 200},
        getMobileSheetBounds, moveSheetGesture, getVisibleSheetViewport,
        isMobile: () => true,
        setSheetExpanded: (_element: unknown, expanded: boolean) => {
            if (expanded) {
                classes.add("b3-menu--expanded");
            } else {
                classes.delete("b3-menu--expanded");
            }
        },
        performance: {now: () => now},
        getComputedStyle: () => ({overflowY: "auto"}),
        updateMenuGroupsOnMutation() {},
        MutationObserver: class { observe() {} },
        document: {createElement: () => ({}), getElementById: (): HTMLElement | null => null, querySelectorAll: (): HTMLElement[] => []},
        window,
    });
    const menu = new exports.Menu(element as unknown as HTMLElement);
    menu.closeSheet = () => { closes++; };
    (menu as unknown as {hideFullscreenScrim: () => void}).hideFullscreenScrim = () => {};
    (menu as unknown as {updateSheetTitle: () => void}).updateSheetTitle = () => {};
    if (!realSizing) (menu as unknown as {setSheetHeight: () => void}).setSheetHeight = () => {
        const preferred = (menu as unknown as {sheetPreferredHeight?: number}).sheetPreferredHeight;
        element.style.height = classes.has("b3-menu--expanded") ? "800px" : (preferred ?? 448) + "px";
    };
    if (realSizing) menu.resetPosition();
    const swipe = (options: {sortable?: boolean, title?: boolean, scrollTop?: number}, offset: number) => {
        const items = {scrollHeight: 1000, clientHeight: 400, scrollTop: options.scrollTop || 0, parentElement: element};
        const target = {
            parentElement: items,
            closest: (selector: string) => {
                if (options.sortable && selector.includes('[draggable="true"]')) {
                    return target;
                }
                if (options.title && selector === ".b3-menu__title") {
                    return element.firstElementChild;
                }
                return selector === ".b3-menu__items" ? items : null;
            },
        };
        const point = {clientX: 80, clientY: 100, identifier: 3};
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
        now += 1000;
        listeners.get("touchmove")(event);
        const transform = element.style.transform;
        listeners.get("touchend")(event);
        return {transform, prevented: event.defaultPrevented};
    };
    const startGrip = () => {
        const point = {clientX: 80, clientY: 100, identifier: 5};
        const target = {closest: (selector: string) => selector === ".b3-menu__title" ? element.firstElementChild : null};
        const event = {target, touches: [point], changedTouches: [point], cancelable: true, preventDefault() {}};
        listeners.get("touchstart")(event);
        return {
            move: (offset: number, x = 80) => { point.clientY = 100 + offset; point.clientX = x; now += 1000; listeners.get("touchmove")(event); },
            end: () => listeners.get("touchend")(event),
            cancel: () => listeners.get("touchcancel")(event),
        };
    };
    return {swipe, startGrip, window, menu, element, classes, setBusy: () => { busy = true; }, closes: () => closes,
        externalClose: () => exports.Menu.prototype.closeSheet.call(menu)};
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

test("pulling ordinary content at the top downward still dismisses it", () => {
    const sheet = createSheet();
    assert.deepEqual(sheet.swipe({}, 200), {transform: "translateY(200px)", prevented: true});
    assert.equal(sheet.closes(), 1);
});

test("dragging a menu grip retains arbitrary height rather than snapping between two sizes", () => {
    const sheet = createSheet(true);
    assert.equal(sheet.swipe({title: true}, -100).prevented, true);
    assert.equal(sheet.classes.has("b3-menu--expanded"), false);
    assert.equal(sheet.element.style.height, "548px");
    sheet.swipe({title: true}, 200);
    assert.equal(sheet.classes.has("b3-menu--expanded"), false);
    assert.equal(sheet.element.style.height, "348px");
    assert.equal(sheet.closes(), 0);
});

test("a single grip gesture shrinks to minimum then closes only with additional downward distance", () => {
    const sheet = createSheet();
    sheet.swipe({title: true}, 312);
    assert.equal(sheet.element.style.height, "136px");
    assert.equal(sheet.closes(), 0);
    sheet.swipe({title: true}, 20);
    assert.equal(sheet.closes(), 0);
    sheet.swipe({title: true}, 40);
    assert.equal(sheet.closes(), 1);
    const expanded = createSheet();
    expanded.element.style.height = "800px";
    expanded.classes.add("b3-menu--expanded");
    expanded.swipe({title: true}, 705);
    assert.equal(expanded.closes(), 1);
});

test("scrolling database menu content upward keeps the half-height menu", () => {
    const sheet = createSheet(true);
    assert.equal(sheet.swipe({}, -100).prevented, false);
    assert.equal(sheet.classes.has("b3-menu--expanded"), false);
    assert.equal(sheet.element.style.height, "448px");
});

for (const moved of [false, true]) {
    test(`viewport changes cancel ${moved ? "active" : "pending"} grip resizing before stale excess is applied`, () => {
        const f = createSheet(true, true);
        const grip = f.startGrip();
        if (moved) grip.move(100);
        f.window.visualViewport.height = 260;
        grip.move(600);
        grip.end();
        assert.equal(f.closes(), 0);
        assert.equal(f.element.style.transform, "translateY(0px)");
        assert.ok(parseFloat(f.element.style.height) <= 260);
    });
}

test("pending begun after a resize move prevents a release-only close", () => {
    const f = createSheet(true, true);
    const grip = f.startGrip();
    grip.move(350);
    f.setBusy();
    const height = f.element.style.height;
    grip.end();
    assert.equal(f.closes(), 0);
    assert.equal(f.element.style.height, height);
    assert.equal(f.element.style.transform, "translateY(0px)");
});

test("an external menu close abandons the gesture without overwriting its exit transform", () => {
    const f = createSheet(true, true);
    const grip = f.startGrip();
    grip.move(100);
    f.externalClose();
    assert.equal(f.element.style.transform, "translateY(100%)");
    grip.move(200);
    grip.end();
    grip.cancel();
    assert.equal(f.element.style.transform, "translateY(100%)");
    assert.equal(f.closes(), 0);
});

test("a horizontal grip gesture cannot become a later vertical resize", () => {
    const f = createSheet(true, true);
    const grip = f.startGrip();
    grip.move(5, 130);
    grip.move(600);
    grip.end();
    assert.equal(f.closes(), 0);
    assert.ok(Math.abs(parseFloat(f.element.style.height) - 448) < .001);
});
