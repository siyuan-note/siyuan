import * as assert from "node:assert/strict";
import {test} from "node:test";
import {bindMobileToolbar, getMobileToolbarPaddingElement, getMobileToolbarProtyle, getMobileToolbarUndo, setMobileToolbarUndo} from "./mobileToolbar";

test("table cell keyboard padding belongs to its outer editor", () => {
    const createEditor = (lite = false) => ({
        lite,
        element: {parentElement: {style: {paddingBottom: ""}}},
        contentElement: {style: {paddingBottom: ""}},
    }) as unknown as IProtyle;
    for (const lite of [false, true]) {
        const owner = createEditor(lite);
        const cell = createEditor(true);
        setMobileToolbarUndo(cell, owner, () => {});
        const target = lite ? owner.contentElement : owner.element.parentElement;
        assert.equal(getMobileToolbarPaddingElement(owner), target);
        assert.equal(getMobileToolbarPaddingElement(cell), target);
        for (const padding of ["48px", "320px", ""]) {
            getMobileToolbarPaddingElement(cell).style.paddingBottom = padding;
            assert.equal(target.style.paddingBottom, padding);
            assert.equal(cell.contentElement.style.paddingBottom, "");
        }
    }
    const composer = createEditor(true);
    assert.equal(getMobileToolbarPaddingElement(composer), composer.contentElement);
});

test("shared mobile toolbar follows fragment focus, retains panel ownership and releases destroyed editors", () => {
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
    const events = new EventTarget();
    const state = {activeElement: {closest: (): unknown => null}};
    const createEditor = () => {
        const element = Object.assign(new EventTarget(), {
            isConnected: true,
            closest: (selector: string): unknown => selector === ".protyle-wysiwyg" ? element : null,
        });
        return {element, wysiwyg: {element}} as unknown as IProtyle;
    };
    const composer = createEditor();
    const cell = createEditor();
    const changes: IProtyle[] = [];
    events.addEventListener("siyuan-mobile-toolbar-editor", (event: CustomEvent<IProtyle>) => changes.push(event.detail));
    Object.defineProperty(globalThis, "window", {configurable: true, value: events});
    Object.defineProperty(globalThis, "document", {configurable: true, value: state});
    const cleanups: Array<() => void> = [];
    try {
        cleanups.push(bindMobileToolbar(composer), bindMobileToolbar(cell));
        const owner = createEditor();
        const operations: boolean[] = [];
        setMobileToolbarUndo(cell, owner, redo => operations.push(redo));
        assert.equal(getMobileToolbarUndo(composer), undefined);
        assert.equal(getMobileToolbarUndo(cell).owner, owner);
        getMobileToolbarUndo(cell).run(false);
        getMobileToolbarUndo(cell).run(true);
        assert.deepEqual(operations, [false, true]);
        state.activeElement = {closest: () => composer.wysiwyg.element};
        composer.wysiwyg.element.dispatchEvent(new Event("focusin"));
        assert.equal(getMobileToolbarProtyle(), composer);

        state.activeElement = {closest: () => null};
        assert.equal(getMobileToolbarProtyle(), composer);

        state.activeElement = {closest: () => cell.wysiwyg.element};
        cell.wysiwyg.element.dispatchEvent(new Event("focusin"));
        assert.equal(getMobileToolbarProtyle(), cell);
        assert.equal(changes.at(-1), composer);

        state.activeElement = {closest: () => ({})};
        assert.equal(getMobileToolbarProtyle(), undefined);

        state.activeElement = {closest: () => cell.wysiwyg.element};
        cell.wysiwyg.element.dispatchEvent(new Event("focusin"));
        cleanups.pop()();
        assert.equal(getMobileToolbarProtyle(), undefined);
        assert.equal(changes.at(-1), cell);

        state.activeElement = {closest: () => composer.wysiwyg.element};
        composer.wysiwyg.element.dispatchEvent(new Event("focusin"));
        Object.defineProperty(composer.element, "isConnected", {value: false});
        assert.equal(getMobileToolbarProtyle(), undefined);
    } finally {
        cleanups.forEach(cleanup => cleanup());
        if (originalWindow) {
            Object.defineProperty(globalThis, "window", originalWindow);
        } else {
            Reflect.deleteProperty(globalThis, "window");
        }
        if (originalDocument) {
            Object.defineProperty(globalThis, "document", originalDocument);
        } else {
            Reflect.deleteProperty(globalThis, "document");
        }
    }
});
