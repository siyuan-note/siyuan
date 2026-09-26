import {test} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";
import * as gestures from "./touchPanelGesture";
import {getTouchAxis} from "./touchGesture";

const loadModule = (name: string, globals: Record<string, unknown>) => {
    const exports: Record<string, (...args: unknown[]) => void> = {};
    const source = readFileSync(resolve(process.cwd(), `src/mobile/util/${name}.ts`), "utf8");
    runInNewContext(transpileModule(source, {compilerOptions: {module: ModuleKind.CommonJS}}).outputText,
        {exports, ...globals});
    return exports;
};

const classList = (...classes: string[]) => {
    const values = new Set(classes);
    return {
        contains: (name: string) => values.has(name),
        add: (name: string) => values.add(name),
        remove: (name: string) => values.delete(name),
    };
};

test("sidebar cycling follows visible tab order and dispatches plugin activation", () => {
    const activated: string[] = [];
    const revealed: string[] = [];
    const tabs = ["file", "agent", "plugin-custom", "tag"].map(type => ({
        dataset: {type: `sidebar-${type}-tab`, mobilePluginDockTab: type === "plugin-custom" ? type : undefined},
        classList: classList(...(type === "file" ? ["toolbar__icon--active"] : type === "agent" ? ["fn__none"] : [])),
        scrollIntoView: () => revealed.push(type),
    }));
    let currentTabs = tabs;
    const toolbar = {
        querySelectorAll: () => currentTabs,
        dispatchEvent: (event: {detail: string}) => {
            activated.push(event.detail);
            tabs.forEach(tab => {
                tab.classList.remove("toolbar__icon--active");
                if (tab.dataset.type === `sidebar-${event.detail}-tab`) {
                    tab.classList.add("toolbar__icon--active");
                }
            });
        },
    };
    const sidebar = loadModule("sidebar", {
        require: () => ({}),
        document: {getElementById: () => ({querySelector: () => toolbar})},
        CustomEvent: class {
            detail: string;
            constructor(_type: string, options: {detail: string}) { this.detail = options.detail; }
        },
    });
    sidebar.switchToNextSidebarTab("left");
    sidebar.switchToNextSidebarTab("left");
    sidebar.switchToNextSidebarTab("left");
    assert.deepEqual(activated, ["plugin-custom", "tag", "file"]);
    assert.deepEqual(revealed, activated);
    currentTabs = [tabs[3], tabs[0], tabs[2]];
    sidebar.switchToNextSidebarTab("right");
    assert.equal(activated.at(-1), "plugin-custom");
    currentTabs = [tabs[0], tabs[1]];
    sidebar.switchToNextSidebarTab("left");
    currentTabs = [];
    sidebar.switchToNextSidebarTab("right");
    assert.equal(activated.length, 4);
});

const createTouchHarness = (side: "left" | "right", options: {
    scrollable?: boolean, disabled?: boolean, closed?: boolean,
} = {}) => {
    const actions: string[] = [];
    const panel = {
        classList: classList(),
        style: {transform: "translateX(0px)", removeProperty() { this.transform = ""; }},
        contains: () => false,
    };
    const mask = {classList: classList(...(options.closed ? ["fn__none"] : [])), style: {}};
    const target = {
        id: options.closed ? "editor" : side === "left" ? "sidebar" : "sidebarRight",
        tagName: "DIV", dataset: {}, parentElement: null as HTMLElement | null,
        preventSwipe: false,
        closest: (): null => null,
        scrollWidth: options.scrollable ? 600 : 300, clientWidth: 300, scrollLeft: 100,
    };
    let now = 1000;
    const modules: Record<string, unknown> = {
        "./sidebar": {
            getSidebarElement: () => panel,
            getSidebarDock: () => ({}),
            popSidebar: (value: string, render = true) => {
                panel.style.transform = "translateX(0px)";
                actions.push(render ? `open:${value}` : "restore");
            },
            switchToNextSidebarTab: (value: string) => actions.push(`next:${value}`),
        },
        "./touchPanelGesture": gestures,
        "./touchGesture": {getTouchAxis},
        "./mobileBarsConfig": {getMobileSidebarConfig: () => ({sidebarSwipe: !options.disabled})},
        "../../protyle/util/hasClosest": {
            hasClosestByAttribute: (element: typeof target, key: string, value: string) =>
                (key === "id" && element.id === value) || (key === "data-prevent-swipe" && element.preventSwipe) ?
                    element : undefined,
            hasClosestByClassName: (): undefined => undefined,
            hasTopClosestByClassName: (): undefined => undefined,
            hasClosestBlock: (): undefined => undefined,
        },
        "./closePanel": {closePanel: () => actions.push("close"), showPanelMask: () => {}},
        "./keyboardToolbar": {activeBlur: () => {}, resetAndroidBoundedSelectionGesture: () => {}},
        "../../protyle/util/compatibility": {isInHarmony: () => false, isInAndroid: () => false, isIPhone: () => false},
        "../editor": {getCurrentEditor: (): undefined => undefined},
        "../../constants": {Constants: {SIZE_DRAG_THRESHOLD: 5, TIMEOUT_LONGPRESS: 500, TIMEOUT_MULTIPLE_SELECT: 500}},
    };
    const touch = loadModule("touch", {
        require: (name: string) => modules[name] || {},
        document: {
            querySelector: (selector: string) => selector === ".side-mask" ? mask : {classList: classList("fn__none")},
            getElementById: (): null => null,
        },
        window: {innerWidth: 360, siyuan: {mobile: {}, zIndex: 0}, getSelection: () => ({rangeCount: 0})},
        getSelection: () => ({rangeCount: 0}),
        getComputedStyle: () => ({overflowX: options.scrollable ? "auto" : "visible"}),
        Date: {now: () => now},
    });
    const event = (x: number, y = 200, count = 1) => ({
        target, touches: Array.from({length: count}, () => ({target, clientX: x, clientY: y})),
        changedTouches: [{target, clientX: x, clientY: y}],
    });
    return {
        actions, panel, target,
        start: (x = 180, y = 200) => touch.handleTouchStart(event(x, y)),
        move: (x: number, y = 200, count = 1) => touch.handleTouchMove(event(x, y, count)),
        end: (x: number, y = 200) => { now += 100; touch.handleTouchEnd(event(x, y)); },
        cancel: () => touch.handleTouchCancel(),
    };
};

for (const side of ["left", "right"] as const) {
    const nextX = side === "left" ? 240 : 120;
    const closeX = side === "left" ? 120 : 240;
    test(`${side} sidebar ignores the complete gesture inside a protected canvas and resumes outside it`, () => {
        const harness = createTouchHarness(side, {closed: true});
        harness.start();
        harness.move(nextX);
        harness.end(nextX);
        harness.actions.length = 0;

        harness.target.preventSwipe = true;
        harness.start();
        harness.target.preventSwipe = false;
        harness.move(nextX);
        harness.end(nextX);
        harness.cancel();
        assert.deepEqual(harness.actions, []);

        harness.target.preventSwipe = true;
        harness.start(1, 1);
        harness.end(1, 1);
        harness.cancel();
        assert.deepEqual(harness.actions, [], "a protected tap near the origin cannot reuse previous swipe state");

        harness.target.preventSwipe = false;
        harness.start();
        harness.move(nextX);
        harness.end(nextX);
        assert.deepEqual(harness.actions, [`open:${side}`]);
    });

    test(`${side} sidebar restores its selected tab only after a committed swipe`, () => {
        const harness = createTouchHarness(side, {closed: true});
        harness.start();
        harness.move(nextX);
        assert.deepEqual(harness.actions, []);
        harness.end(nextX);
        assert.deepEqual(harness.actions, [`open:${side}`]);
        const disabled = createTouchHarness(side, {closed: true, disabled: true});
        disabled.start();
        disabled.move(nextX);
        disabled.end(nextX);
        assert.deepEqual(disabled.actions, []);
    });

    test(`${side} sidebar switches once on release and retains closing gestures`, () => {
        const next = createTouchHarness(side, {disabled: true});
        next.start();
        next.move(nextX);
        next.move(nextX);
        assert.deepEqual(next.actions, []);
        assert.equal(next.panel.style.transform, "translateX(0px)");
        next.end(nextX);
        assert.deepEqual(next.actions, ["restore", `next:${side}`]);
        const close = createTouchHarness(side);
        close.start();
        close.move(closeX);
        assert.notEqual(close.panel.style.transform, "translateX(0px)");
        close.end(closeX);
        assert.deepEqual(close.actions, ["close"]);
    });

    test(`${side} sidebar ignores short, vertical, canceled, reversed and multi-touch gestures`, () => {
        for (const kind of ["short", "vertical", "cancel", "reverse", "multi"]) {
            const harness = createTouchHarness(side);
            harness.start();
            if (kind === "short") {
                harness.move(190);
                harness.end(190);
            } else if (kind === "vertical") {
                harness.move(185, 240);
                harness.move(nextX, 250);
                harness.end(nextX, 250);
            } else {
                harness.move(nextX, 200, kind === "multi" ? 2 : 1);
                if (kind === "cancel") {
                    harness.cancel();
                } else {
                    harness.end(kind === "reverse" ? 180 : nextX);
                }
            }
            assert.equal(harness.actions.some(action => action.startsWith("next:") || action === "close"), false, kind);
        }
    });

    test(`${side} sidebar leaves horizontal scrolling to content until the next gesture`, () => {
        const harness = createTouchHarness(side, {scrollable: true});
        harness.start();
        harness.move(nextX);
        harness.target.scrollLeft = side === "left" ? 0 : 300;
        harness.move(nextX);
        harness.end(nextX);
        assert.deepEqual(harness.actions, ["restore"]);
        harness.start();
        harness.move(nextX);
        harness.end(nextX);
        assert.deepEqual(harness.actions, ["restore", "restore", `next:${side}`]);
    });

    test(`${side} sidebar closes only on a fresh gesture after content reaches its horizontal edge`, () => {
        const harness = createTouchHarness(side, {scrollable: true});
        harness.start();
        harness.move(closeX);
        harness.target.scrollLeft = side === "left" ? 300 : 0;
        harness.move(closeX);
        harness.end(closeX);
        assert.deepEqual(harness.actions, ["restore"]);
        harness.start();
        harness.move(closeX);
        harness.end(closeX);
        assert.deepEqual(harness.actions, ["restore", "close"]);
    });
}
