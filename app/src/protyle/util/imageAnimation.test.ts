import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    createImageAnimationController,
    IMAGE_ANIMATION_PAUSED_CLASS,
} from "./imageAnimation";

const createElement = () => {
    const classes = new Set<string>();
    return {
        element: {
            classList: {
                add: (name: string) => classes.add(name),
                contains: (name: string) => classes.has(name),
                remove: (name: string) => classes.delete(name),
            },
        } as unknown as HTMLElement,
        hasClass: (name: string) => classes.has(name),
    };
};

const createScheduler = () => {
    let nextID = 0;
    const callbacks = new Map<number, () => void>();
    return {
        clearTimer: (id: number) => callbacks.delete(id),
        runAll: () => {
            const pendingCallbacks = Array.from(callbacks.values());
            callbacks.clear();
            pendingCallbacks.forEach(callback => callback());
        },
        setTimer: (callback: () => void) => {
            nextID++;
            callbacks.set(nextID, callback);
            return nextID;
        },
    };
};

describe("imageAnimationController", () => {
    it("pauses immediately and resumes after the scheduled delay", () => {
        const scheduler = createScheduler();
        const controller = createImageAnimationController(scheduler.setTimer, scheduler.clearTimer);
        const target = createElement();

        controller.pauseTemporarily(target.element, 256);

        assert.equal(target.hasClass(IMAGE_ANIMATION_PAUSED_CLASS), true);
        scheduler.runAll();
        assert.equal(target.hasClass(IMAGE_ANIMATION_PAUSED_CLASS), false);
    });

    it("cancels a scheduled resume when the element pauses again", () => {
        const scheduler = createScheduler();
        const controller = createImageAnimationController(scheduler.setTimer, scheduler.clearTimer);
        const target = createElement();

        controller.pauseTemporarily(target.element, 256);
        controller.pause(target.element);
        scheduler.runAll();

        assert.equal(target.hasClass(IMAGE_ANIMATION_PAUSED_CLASS), true);
    });

    it("resumes immediately when no delay is requested", () => {
        const scheduler = createScheduler();
        const controller = createImageAnimationController(scheduler.setTimer, scheduler.clearTimer);
        const target = createElement();

        controller.pause(target.element);
        controller.resume(target.element, 0);

        assert.equal(target.hasClass(IMAGE_ANIMATION_PAUSED_CLASS), false);
    });
});
