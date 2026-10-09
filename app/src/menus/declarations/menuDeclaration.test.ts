import * as assert from "node:assert/strict";
import {test} from "node:test";
import {IMAGE_OCR_MENU, IImageOCRMenuContext} from "./imageOCRMenu";
import {createDeclaredMenu, declaredMenuCatalog} from "./menuDeclaration";

const installLanguages = (t: {after: (callback: () => void) => void}) => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", {configurable: true, value: {
        siyuan: {languages: new Proxy({}, {get: (_target, key) => String(key)})},
    }});
    t.after(() => {
        if (descriptor) {
            Object.defineProperty(globalThis, "window", descriptor);
        } else {
            Reflect.deleteProperty(globalThis, "window");
        }
    });
};

const context = (options: Partial<IImageOCRMenuContext> = {}): IImageOCRMenuContext => ({
    textAvailable: true, localAvailable: true, aiAvailable: true,
    getStatus: async () => false, openResult: () => {}, copyText: () => {}, runLocal: () => {}, runAI: () => {},
    ...options,
});

test("OCR declarations drive catalog order, defaults and complete menu actions", t => {
    installLanguages(t);
    const clicked: string[] = [];
    const menu = createDeclaredMenu(IMAGE_OCR_MENU, context({
        openResult: () => { clicked.push("result"); }, copyText: () => { clicked.push("copy"); },
        runLocal: () => { clicked.push("local"); }, runAI: () => { clicked.push("ai"); },
    }));
    assert.deepEqual(menu.submenu.map(item => [item.id, item.label, item.icon, item.type]), [
        ["ocrResult", "ocrResult", "iconEdit", undefined], ["copyOCRText", "copy OCR", "iconCopy", undefined],
        ["separator_reOCR", "", undefined, "separator"], ["reOCR", "performOCR", "iconOCR", undefined],
        ["reAIOCR", "performAIOCR", "iconSparkles", undefined],
    ]);
    const catalog = declaredMenuCatalog(IMAGE_OCR_MENU);
    assert.equal(catalog.key, "ocr");
    assert.equal(catalog.simple, false);
    assert.deepEqual(catalog.children.map(item => item.key), menu.submenu.map(item => item.id));
    assert.deepEqual(catalog.children.map(item => item.simple), [false, false, true, false, false]);
    menu.submenu.forEach(item => item.click?.(undefined, undefined));
    assert.deepEqual(clicked, ["result", "copy", "local", "ai"]);
});

test("conditional OCR availability does not change configurable identities", t => {
    installLanguages(t);
    for (const textAvailable of [false, true]) {
        for (const localAvailable of [false, true]) {
            for (const aiAvailable of [false, true]) {
                const menu = createDeclaredMenu(IMAGE_OCR_MENU, context({textAvailable, localAvailable, aiAvailable}));
                assert.equal(menu.ignore, !textAvailable);
                assert.deepEqual(menu.submenu.map(item => item.ignore === true), [false, false,
                    !localAvailable && !aiAvailable, !localAvailable, !aiAvailable]);
                assert.deepEqual(menu.submenu.map(item => item.id), declaredMenuCatalog(IMAGE_OCR_MENU).children.map(item => item.key));
            }
        }
    }
});

test("late OCR status updates only connected menus and preserves provider labels", async t => {
    installLanguages(t);
    for (const connected of [false, true]) {
        for (const status of [undefined, false, true]) {
            let resolve: (value: boolean | undefined) => void;
            const menu = createDeclaredMenu(IMAGE_OCR_MENU, context({getStatus: () => new Promise(done => { resolve = done; })}));
            const labels = {local: {textContent: "performOCR"}, ai: {textContent: "performAIOCR"}};
            menu.bind({isConnected: connected, querySelector: (selector: string) => selector.includes('"reOCR"') ? labels.local : labels.ai} as unknown as HTMLElement);
            resolve(status);
            await Promise.resolve();
            assert.equal(labels.local.textContent, connected && status === true ? "reOCR" : "performOCR");
            assert.equal(labels.ai.textContent, connected && status === true ? "reAIOCR" : "performAIOCR");
        }
    }
});
