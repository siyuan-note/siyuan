import * as assert from "node:assert/strict";
import test from "node:test";
import {observeFontPreview} from "./fontPreview";

test("font previews report pending loads, reveal settled labels and stop updates after cleanup", async () => {
    const saved = new Map(["window", "document", "IntersectionObserver", "getComputedStyle"].map(key =>
        [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    let callback: (entries: unknown[]) => void;
    let finish: () => void;
    let reject: (error: Error) => void;
    let loads = 0;
    let applies = 0;
    let disconnected = false;
    const changes: boolean[] = [];
    const onLoadingChange = (loading: boolean) => changes.push(loading);
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
        const cleanup = observeFontPreview(list, apply, onLoadingChange);
        assert.equal(label.style.visibility, "hidden");
        emit(false);
        assert.equal(loads, 0);
        assert.deepEqual(changes, []);
        emit(true);
        assert.equal(loads, 1);
        assert.equal(applies, 1);
        assert.equal(label.style.visibility, "hidden");
        assert.deepEqual(changes, [true]);
        emit(true);
        assert.equal(loads, 1);
        finish();
        await loading;
        assert.equal(label.style.visibility, "");
        assert.equal(label.style.fontFamily, "Preview");
        assert.deepEqual(changes, [true, false]);
        cleanup();
        assert.equal(disconnected, true);

        loading = pending();
        changes.length = 0;
        const cleanupFailure = observeFontPreview(list, apply, onLoadingChange);
        emit(true);
        reject(new Error("Font unavailable"));
        await loading.catch(() => {});
        assert.equal(label.style.visibility, "");
        assert.equal(label.style.fontFamily, "");
        assert.deepEqual(changes, [true, false]);
        cleanupFailure();

        loading = pending();
        changes.length = 0;
        const cleanupPending = observeFontPreview(list, apply, onLoadingChange);
        emit(true);
        cleanupPending();
        finish();
        await loading;
        assert.equal(label.style.visibility, "hidden");
        assert.deepEqual(changes, [true]);
        const previousLoads = loads;
        callback([{target: {querySelector: () => label}, isIntersecting: true}]);
        assert.equal(loads, previousLoads);

        loading = pending();
        changes.length = 0;
        const cleanupRejected = observeFontPreview(list, apply, onLoadingChange);
        emit(true);
        cleanupRejected();
        reject(new Error("Closed font unavailable"));
        await loading.catch(() => {});
        assert.equal(label.style.fontFamily, "Preview");
        assert.equal(label.style.visibility, "hidden");
        assert.deepEqual(changes, [true]);

        loading = pending();
        Object.assign(globalThis, {window: {}});
        const cleanupFallback = observeFontPreview(list, apply, onLoadingChange);
        assert.equal(loads, previousLoads + 2);
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

test("font preview loading remains active until every pending visible preview settles", async () => {
    const saved = new Map(["window", "document", "IntersectionObserver", "getComputedStyle"].map(key =>
        [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    let callback: (entries: unknown[]) => void;
    const completions: Array<() => void> = [];
    const promises: Promise<void>[] = [];
    const changes: boolean[] = [];
    const items = ["First", "Second", ""].map(family => ({querySelector: () => ({
        dataset: {family}, textContent: family, style: {visibility: "", removeProperty() {}},
    })}));
    const list = {querySelectorAll: () => items} as unknown as HTMLElement;
    try {
        Object.assign(globalThis, {
            window: {IntersectionObserver: true},
            document: {fonts: {load: () => {
                const promise = new Promise<void>(resolve => completions.push(resolve));
                promises.push(promise);
                return promise;
            }}},
            getComputedStyle: () => ({fontWeight: "400", fontSize: "16px", fontFamily: "Preview"}),
            IntersectionObserver: class {
                constructor(cb: typeof callback) { callback = cb; }
                observe() {}
                unobserve() {}
                disconnect() {}
            },
        });
        const cleanup = observeFontPreview(list, () => {}, loading => changes.push(loading));
        callback(items.map(target => ({target, isIntersecting: true})));
        assert.equal(promises.length, 2, "the default option does not trigger a font preview load");
        assert.deepEqual(changes, [true]);
        completions[0]();
        await promises[0];
        assert.deepEqual(changes, [true], "one completed preview must not hide the spinner for another");
        completions[1]();
        await promises[1];
        assert.deepEqual(changes, [true, false]);
        cleanup();
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
