import {readFileSync} from "node:fs";
import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {runInNewContext} from "node:vm";
import {createSourceFile, isClassDeclaration, ModuleKind, ScriptTarget, transpileModule} from "typescript";
import type {Menu} from "./Menu";
import {waitForSheetViewport} from "./sheetOpen";

const source = createSourceFile("Menu.ts", readFileSync("src/menus/Menu.ts", "utf8"), ScriptTarget.ES2021, true);
const declaration = source.statements.find(statement => isClassDeclaration(statement) && statement.name?.text === "Menu");
const compiled = transpileModule(declaration.getText(source), {
    compilerOptions: {target: ScriptTarget.ES2021, module: ModuleKind.CommonJS},
}).outputText;

const createElement = () => {
    const classes = new Set<string>();
    const attributes = new Map<string, string>();
    return {
        style: {} as CSSStyleDeclaration,
        innerHTML: "items",
        scrollTop: 0,
        offsetHeight: 480,
        classList: {
            add: (...names: string[]) => names.forEach(name => classes.add(name)),
            remove: (...names: string[]) => names.forEach(name => classes.delete(name)),
            contains: (name: string) => classes.has(name),
        },
        getAttribute: (name: string) => attributes.get(name),
        removeAttribute: (name: string) => attributes.delete(name),
    };
};

const setup = () => {
    let time = 0;
    let height = 476;
    let sequence = 0;
    const timers = new Map<number, () => void>();
    const frames = new Map<number, () => void>();
    const events: string[] = [];
    const first = {...createElement(), querySelector: () => ({innerHTML: ""})};
    const element = {
        ...createElement(),
        firstElementChild: first,
        lastElementChild: createElement(),
        querySelectorAll: () => [] as Element[],
    };
    const module = {exports: {} as {Menu: typeof Menu}};
    runInNewContext(compiled, {
        exports: module.exports,
        fullscreenCloseTimeout: undefined,
        isMobile: () => true,
        applyMenuConfig: () => {},
        updateMenuItemGroupClasses: () => {},
        activeBlur: (force: boolean) => events.push(force ? "hide-forced" : "hide"),
        waitForSheetViewport,
        clearTimeout: (id: number) => timers.delete(id),
        requestAnimationFrame: (callback: () => void) => { frames.set(++sequence, callback); return sequence; },
        cancelAnimationFrame: (id: number) => frames.delete(id),
        performance: {now: () => time},
        document: {activeElement: {blur: () => events.push("blur")}},
        Constants: {TIMEOUT_DBLCLICK: 200},
        window: {
            get innerHeight() { return height; },
            siyuan: {
                zIndex: 0,
                languages: {back: "Back"},
                mobile: {size: {portrait: {height1: 808}}},
            },
            addEventListener: () => {},
            setTimeout: (callback: () => void) => { timers.set(++sequence, callback); return sequence; },
        },
    });
    const menu = Object.create(module.exports.Menu.prototype) as Menu;
    Object.assign(menu, {
        element,
        stopTrackingTargetPosition: () => {},
        emitCommonMenu: () => {},
        showFullscreenScrim: () => {},
        hideFullscreenScrim: () => {},
        setSheetHeight: () => {},
        finishSheetTouch: () => {},
        removeScrollEvent: () => {},
    });
    return {
        menu, element, events,
        tick(nextTime: number, nextHeight = height) {
            time = nextTime;
            height = nextHeight;
            const callbacks = Array.from(frames.values());
            frames.clear();
            callbacks.forEach(callback => callback());
        },
        finishClose() {
            const callbacks = Array.from(timers.values());
            timers.clear();
            callbacks.forEach(callback => callback());
        },
    };
};

describe("mobile menu keyboard lifecycle", () => {
    it("still hides the keyboard and waits for the restored viewport before opening", () => {
        const {menu, element, events, tick} = setup();
        menu.fullscreen("all", () => events.push("restore"));
        assert.deepEqual(events, ["blur", "hide-forced"]);
        tick(16);
        tick(400, 700);
        assert.equal(element.style.transform, "translateY(100%)");
        tick(500, 808);
        tick(532);
        assert.equal(element.style.transform, "translateY(0px)");
        assert.equal(events.includes("restore"), false);
    });

    it("restores once during the dismissal gesture, before the closing timer runs", () => {
        const {menu, events, finishClose} = setup();
        menu.fullscreen("all", () => events.push("restore"));
        menu.closeSheet();
        assert.deepEqual(events, ["blur", "hide-forced", "restore"]);
        menu.closeSheet();
        finishClose();
        assert.equal(events.filter(event => event === "restore").length, 1);
    });

    it("hides the sheet before restoring the keyboard can resize the viewport", () => {
        const {menu, element, tick} = setup();
        menu.fullscreen("all", () => {
            assert.equal(element.classList.contains("fn__none"), true);
            assert.equal(element.classList.contains("b3-menu--sheet"), false);
        });
        tick(500, 808);
        tick(532);
        menu.closeSheet();
        tick(550, 476);
        assert.equal(element.classList.contains("fn__none"), true);
    });

    it("keeps the closing animation when no keyboard needs restoring", () => {
        const {menu, element, finishClose} = setup();
        menu.fullscreen();
        menu.closeSheet();
        assert.equal(element.style.transform, "translateY(100%)");
        assert.equal(element.classList.contains("fn__none"), false);
        finishClose();
        assert.equal(element.classList.contains("fn__none"), true);
    });

    it("restores on system back but leaves submenu back navigation alone", () => {
        const {menu, events, element} = setup();
        menu.fullscreen("all", () => events.push("restore"));
        const submenu = {...createElement(), querySelector: (): Element => undefined};
        element.querySelectorAll = () => [submenu as unknown as Element];
        menu.remove(true);
        assert.equal(events.includes("restore"), false);
        element.querySelectorAll = () => [];
        menu.remove(true);
        assert.equal(events.includes("restore"), true);
    });

    it("discards restoration on menu actions and internal removal", () => {
        const {menu, events} = setup();
        menu.fullscreen("all", () => events.push("restore"));
        menu.remove();
        menu.closeSheet();
        assert.equal(events.includes("restore"), false);
    });

    it("cancels the old closing timer when another menu opens", () => {
        const {menu, element, events, finishClose} = setup();
        menu.fullscreen();
        menu.closeSheet();
        menu.fullscreen("all", () => events.push("restore-second"));
        finishClose();
        assert.equal(element.classList.contains("fn__none"), false);
        menu.closeSheet();
        assert.equal(events.filter(event => event === "restore-second").length, 1);
    });
});
