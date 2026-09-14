import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compiled = transpileModule(readFileSync("src/protyle/render/av/mobilePanel.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const createPanel = () => {
    const listeners = new Map<string, (event: unknown) => void>();
    const scrim = {style: {opacity: ""}};
    const observers: Array<() => void> = [];
    const menu = {
        style: {height: "", transform: "", transition: ""},
        classList: {add() {}},
        clientHeight: 400,
        offsetHeight: 400,
        firstElementChild: undefined as undefined | {classList: {contains: (name: string) => boolean}},
        insertedHTML: [] as string[],
        insertAdjacentHTML(position: string, html: string) {
            this.insertedHTML.push(`${position}:${html}`);
            this.firstElementChild = {classList: {contains: (name: string) => html.includes(name)}};
        },
        querySelectorAll: (): Element[] => [],
        querySelector: (): Element => null,
        addEventListener: (name: string, listener: (event: unknown) => void) => listeners.set(name, listener),
    };
    let closes = 0;
    const panel = {
        querySelector: () => scrim,
        parentElement: {},
        dispatchEvent: () => closes++,
    };
    const exports: {bindMobileAVPanel?: (panel: unknown, menu: unknown) => void} = {};
    runInNewContext(compiled, {
        exports,
        require: () => ({waitForSheetViewport: () => () => {}}),
        window: {
            innerHeight: 800,
            siyuan: {mobile: {size: {portrait: {height1: 800}}}},
            addEventListener() {},
        },
        performance: {now: () => 1000},
        MutationObserver: class {
            constructor(callback: () => void) {
                observers.push(callback);
            }

            observe() {}

            disconnect() {}
        },
        CustomEvent: class {},
    });
    exports.bindMobileAVPanel(panel, menu);
    const drag = (sortable: boolean, offset: number) => {
        const target = {
            closest: (selector: string) => sortable && selector.includes('[draggable="true"]') ? {} : null,
            parentElement: menu,
        };
        listeners.get("touchstart")({target, touches: [{clientX: 80, clientY: 100}]});
        listeners.get("touchmove")({touches: [{clientX: 80, clientY: 100 + offset}]});
    };
    const end = () => listeners.get("touchend")({changedTouches: [{clientY: 300}]});
    // 触发内容观察者，模拟数据库面板内容整体重绘
    const rerender = () => observers[0]();
    return {menu, scrim, drag, end, rerender, closes: () => closes};
};

test("database panel handle is hosted by a root menu title", () => {
    const panel = createPanel();
    assert.deepEqual(panel.menu.insertedHTML,
        ['afterbegin:<div class="b3-menu__title b3-menu__title--root"></div>']);
    panel.menu.firstElementChild = undefined;
    panel.rerender();
    assert.equal(panel.menu.insertedHTML.length, 2);
});

test("sorting the first view downward does not move or dismiss the database panel", () => {
    const panel = createPanel();
    panel.drag(true, 200);
    assert.equal(panel.menu.style.transform, "");
    assert.equal(panel.scrim.style.opacity, "");
    panel.end();
    assert.equal(panel.closes(), 0);
});

test("sorting a later view upward leaves the database panel stationary", () => {
    const panel = createPanel();
    panel.drag(true, -50);
    assert.equal(panel.menu.style.transform, "");
    panel.end();
    assert.equal(panel.closes(), 0);
});

test("dragging the database panel background downward still dismisses it", () => {
    const panel = createPanel();
    panel.drag(false, 200);
    assert.equal(panel.menu.style.transform, "translateY(200px)");
    panel.end();
    assert.equal(panel.closes(), 1);
});
