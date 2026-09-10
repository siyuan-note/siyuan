import * as assert from "node:assert/strict";
import test from "node:test";
import {observeFontPreview} from "./fontPreview";

test("font previews defer loading, discard invisible items and stop after cleanup", async () => {
    const saved = new Map(["window", "document", "IntersectionObserver", "getComputedStyle", "setTimeout", "clearTimeout",
        "requestAnimationFrame", "cancelAnimationFrame"].map(key =>
        [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    let callback: (entries: unknown[]) => void;
    let finish: () => void;
    let reject: (error: Error) => void;
    let loads = 0;
    let applies = 0;
    let disconnected = false;
    let scheduled: () => void;
    let nextFrame: () => void;
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
    const list = {querySelectorAll: () => [item], addEventListener() {}, removeEventListener() {}} as unknown as HTMLElement;
    const emit = (visible: boolean) => callback([{target: item, isIntersecting: visible}]);
    const apply = () => { applies++; label.style.fontFamily = "Preview"; };
    try {
        Object.assign(globalThis, {
            setTimeout: (cb: () => void) => { scheduled = cb; return 1; },
            clearTimeout: () => { scheduled = undefined; },
            requestAnimationFrame: (cb: () => void) => { nextFrame = cb; return 1; },
            cancelAnimationFrame: () => { nextFrame = undefined; },
            window: {IntersectionObserver: true},
            document: {fonts: {load: () => { loads++; return loading; }}},
            getComputedStyle: () => ({fontWeight: "400", fontSize: "16px", fontFamily: "Preview"}),
            IntersectionObserver: class {
                constructor(cb: typeof callback, options: IntersectionObserverInit) {
                    callback = cb;
                    assert.equal(options.root, list);
                    assert.equal(options.rootMargin, undefined);
                }
                observe() {}
                unobserve() {}
                disconnect() { disconnected = true; }
            },
        });
        const cleanup = observeFontPreview(list, apply);
        assert.equal(label.style.visibility, "");
        emit(false);
        assert.equal(loads, 0);
        emit(true);
        assert.equal(loads, 0);
        emit(false);
        scheduled();
        assert.equal(loads, 0);
        emit(true);
        scheduled();
        assert.equal(loads, 1);
        emit(true);
        scheduled();
        assert.equal(loads, 1);
        assert.equal(label.style.visibility, "");
        finish();
        await loading;
        assert.equal(label.style.visibility, "");
        emit(false);
        emit(true);
        assert.equal(applies, 1);
        assert.equal(label.style.fontFamily, "Preview");
        cleanup();
        assert.equal(disconnected, true);

        loading = pending();
        const cleanupFailure = observeFontPreview(list, apply);
        emit(true);
        scheduled();
        reject(new Error("Font unavailable"));
        await loading.catch(() => {});
        assert.equal(label.style.visibility, "");
        assert.equal(label.style.fontFamily, "");
        cleanupFailure();

        loading = pending();
        const cleanupPending = observeFontPreview(list, apply);
        emit(true);
        scheduled();
        cleanupPending();
        finish();
        await loading;
        assert.equal(label.style.visibility, "");
        assert.equal(scheduled, undefined);

        loading = pending();
        const cleanupQueue = observeFontPreview(list, apply);
        const secondItem = {querySelector: () => label};
        callback([{target: item, isIntersecting: true}, {target: secondItem, isIntersecting: true}]);
        scheduled();
        const firstLoadCount = loads;
        assert.equal(nextFrame, undefined);
        finish();
        await loading;
        await Promise.resolve();
        assert.equal(loads, firstLoadCount);
        assert.equal(typeof nextFrame, "function");
        nextFrame();
        assert.equal(loads, firstLoadCount + 1);
        cleanupQueue();
        assert.equal(nextFrame, undefined);
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
