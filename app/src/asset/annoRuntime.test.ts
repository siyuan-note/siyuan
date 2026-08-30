import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    bindPdfAnnotationPointerDrag,
    destroyAnno,
    getRegisteredPdfInstance,
    registerAnnoCleanup,
    registerPdfInstance,
    unregisterPdfInstance,
} from "./annoRuntime";

const createPointerEvent = (type: string, pointerId: number) => {
    const event = new Event(type);
    Object.defineProperty(event, "pointerId", {value: pointerId});
    return event as PointerEvent;
};

describe("PDF annotation runtime", () => {
    it("resolves a registered PDF instance from a descendant and unregisters it", () => {
        const root = {parentElement: null} as HTMLElement;
        const child = {parentElement: root} as HTMLElement;
        const grandchild = {parentElement: child} as HTMLElement;
        const pdf = {};

        registerPdfInstance(root, pdf);
        assert.equal(getRegisteredPdfInstance(root), pdf);
        assert.equal(getRegisteredPdfInstance(grandchild), pdf);

        unregisterPdfInstance(root);
        assert.equal(getRegisteredPdfInstance(grandchild), undefined);
    });

    it("destroys the annotation runtime once and unregisters its PDF instance", () => {
        const root = {parentElement: null} as HTMLElement;
        const child = {parentElement: root} as HTMLElement;
        let cleanupCount = 0;
        registerPdfInstance(root, {});
        registerAnnoCleanup(root, () => {
            cleanupCount++;
        });

        destroyAnno(root);
        destroyAnno(root);

        assert.equal(cleanupCount, 1);
        assert.equal(getRegisteredPdfInstance(child), undefined);
    });

    it("finishes only for the matching pointer and removes document listeners on pointerup", () => {
        const target = new EventTarget() as unknown as Document;
        const moves: number[] = [];
        const pointerups: number[] = [];
        let canceled = 0;
        bindPdfAnnotationPointerDrag(target, 7, (event) => {
            moves.push(event.pointerId);
        }, (event) => {
            pointerups.push(event.pointerId);
        }, () => {
            canceled++;
        });

        target.dispatchEvent(createPointerEvent("pointermove", 8));
        target.dispatchEvent(createPointerEvent("pointermove", 7));
        target.dispatchEvent(createPointerEvent("pointerup", 8));
        target.dispatchEvent(createPointerEvent("pointerup", 7));
        target.dispatchEvent(createPointerEvent("pointermove", 7));
        target.dispatchEvent(createPointerEvent("pointercancel", 7));

        assert.deepEqual(moves, [7]);
        assert.deepEqual(pointerups, [7]);
        assert.equal(canceled, 0);
    });

    it("cancels once and removes document listeners on pointercancel or explicit cleanup", () => {
        const pointerCancelTarget = new EventTarget() as unknown as Document;
        let pointerCancelMoves = 0;
        let pointerCancelCount = 0;
        const cancelPointerDrag = bindPdfAnnotationPointerDrag(pointerCancelTarget, 3, () => {
            pointerCancelMoves++;
        }, () => {}, () => {
            pointerCancelCount++;
        });

        pointerCancelTarget.dispatchEvent(createPointerEvent("pointercancel", 3));
        pointerCancelTarget.dispatchEvent(createPointerEvent("pointermove", 3));
        cancelPointerDrag();
        assert.equal(pointerCancelMoves, 0);
        assert.equal(pointerCancelCount, 1);

        const cleanupTarget = new EventTarget() as unknown as Document;
        let cleanupMoves = 0;
        let cleanupCount = 0;
        const cleanup = bindPdfAnnotationPointerDrag(cleanupTarget, 5, () => {
            cleanupMoves++;
        }, () => {}, () => {
            cleanupCount++;
        });

        cleanup();
        cleanupTarget.dispatchEvent(createPointerEvent("pointermove", 5));
        cleanupTarget.dispatchEvent(createPointerEvent("pointerup", 5));
        cleanup();
        assert.equal(cleanupMoves, 0);
        assert.equal(cleanupCount, 1);
    });
});
