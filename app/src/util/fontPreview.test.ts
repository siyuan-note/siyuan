import * as assert from "node:assert/strict";
import test from "node:test";
import {observeFontPreview} from "./fontPreview";

test("font previews load near the viewport, reveal settled labels and stop after cleanup", async () => {
    const saved = new Map(["window", "document", "IntersectionObserver", "getComputedStyle"].map(key =>
        [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    let callback: (entries: unknown[]) => void;
    let finish: () => void;
    let reject: (error: Error) => void;
    let loads = 0;
    let applies = 0;
    let disconnected = false;
    const pending = () => new Promise<void>((resolve, fail) => {
        finish = resolve;
        reject = fail;
    });
    let loading = pending();
    const label = {
        dataset: {family: "Preview"}, textContent: "Preview",
        style: {visibility: "", fontFamily: "", fontWeight: "", removeProperty(name: string) {
            this[name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = "";
        }},
    };
    const item = {querySelector: () => label};
    const list = {querySelectorAll: () => [item]} as unknown as HTMLElement;
    const emit = (visible: boolean) => callback([{target: item, isIntersecting: visible}]);
    const apply = () => { applies++; label.style.fontFamily = "Preview"; };
    try {
        Object.assign(globalThis, {
            window: {IntersectionObserver: true},
            document: {fonts: {load: () => { loads++; return loading; }}},
            getComputedStyle: () => ({fontWeight: "400", fontSize: "16px", fontFamily: "Preview"}),
            IntersectionObserver: class {
                constructor(cb: typeof callback, options: IntersectionObserverInit) {
                    callback = cb;
                    assert.equal(options.root, list);
                    assert.equal(options.rootMargin, "100px 0px");
                }
                observe() {}
                unobserve() {}
                disconnect() { disconnected = true; }
            },
        });
        const cleanup = observeFontPreview(list, apply);
        assert.equal(label.style.visibility, "hidden");
        emit(false);
        assert.equal(loads, 0);
        emit(true);
        assert.equal(loads, 1);
        assert.equal(applies, 1);
        assert.equal(label.style.visibility, "hidden");
        emit(true);
        assert.equal(loads, 1);
        finish();
        await loading;
        assert.equal(label.style.visibility, "");
        assert.equal(label.style.fontFamily, "Preview");
        cleanup();
        assert.equal(disconnected, true);

        loading = pending();
        const cleanupFailure = observeFontPreview(list, apply);
        emit(true);
        reject(new Error("Font unavailable"));
        await loading.catch(() => {});
        assert.equal(label.style.visibility, "");
        assert.equal(label.style.fontFamily, "");
        cleanupFailure();

        loading = pending();
        const cleanupPending = observeFontPreview(list, apply);
        emit(true);
        cleanupPending();
        finish();
        await loading;
        assert.equal(label.style.visibility, "hidden");
        const previousLoads = loads;
        callback([{target: {querySelector: () => label}, isIntersecting: true}]);
        assert.equal(loads, previousLoads);

        loading = pending();
        Object.assign(globalThis, {window: {}});
        const cleanupFallback = observeFontPreview(list, apply);
        assert.equal(loads, previousLoads + 1);
        finish();
        await loading;
        assert.equal(label.style.visibility, "");
        cleanupFallback();
    } finally {
        saved.forEach((descriptor, key) => {
            if (descriptor) {
                Object.defineProperty(globalThis, key, descriptor);
            } else {
                Reflect.deleteProperty(globalThis, key);
            }
        });
    }
});
