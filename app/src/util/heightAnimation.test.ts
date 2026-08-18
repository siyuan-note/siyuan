import {after, before, beforeEach, describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    cancelHeightAnimation,
    collapseHeight,
    expandHeight,
    isHeightAnimating
} from "./heightAnimation";

let reduceMotion = false;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

before(() => {
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            matchMedia: () => ({matches: reduceMotion}),
        },
    });
});

beforeEach(() => {
    reduceMotion = false;
});

after(() => {
    if (originalWindow) {
        Object.defineProperty(globalThis, "window", originalWindow);
    } else {
        Reflect.deleteProperty(globalThis, "window");
    }
});

const createAnimation = () => {
    let resolve!: () => void;
    let reject!: (reason?: unknown) => void;
    let canceled = false;
    const finished = new Promise<void>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    const animation = {
        finished,
        cancel() {
            canceled = true;
            reject(new Error("Animation canceled"));
        },
    } as unknown as Animation;
    return {
        animation,
        finish: resolve,
        fail: reject,
        isCanceled: () => canceled,
    };
};

const createElement = () => {
    const animation = createAnimation();
    let frames!: Keyframe[];
    let options!: KeyframeAnimationOptions;
    const style = {
        minHeight: "",
        overflow: "",
        removeProperty(property: string) {
            if (property === "min-height") {
                this.minHeight = "";
            }
            if (property === "overflow") {
                this.overflow = "";
            }
            return "";
        },
    } as unknown as CSSStyleDeclaration;
    const element = {
        scrollHeight: 96,
        style,
        animate(animationFrames: Keyframe[], animationOptions: KeyframeAnimationOptions) {
            frames = animationFrames;
            options = animationOptions;
            return animation.animation;
        },
    } as unknown as HTMLElement;
    return {
        animation,
        element,
        getFrames: () => frames,
        getOptions: () => options,
    };
};

describe("heightAnimation", () => {
    it("expands to the content height and restores overflow", async () => {
        const target = createElement();
        let finished = false;
        assert.equal(expandHeight(target.element, () => {
            finished = true;
        }), true);

        assert.deepEqual(target.getFrames(), [{height: "0"}, {height: "96px"}]);
        assert.equal(target.getOptions().duration, 200);
        assert.equal(target.element.style.minHeight, "0");
        assert.equal(target.element.style.overflow, "hidden");
        assert.equal(isHeightAnimating(target.element), true);

        target.animation.finish();
        await target.animation.animation.finished;
        assert.equal(target.animation.isCanceled(), true);
        assert.equal(target.element.style.minHeight, "");
        assert.equal(target.element.style.overflow, "");
        assert.equal(isHeightAnimating(target.element), false);
        assert.equal(finished, true);
    });

    it("collapses from the content height", async () => {
        const target = createElement();
        collapseHeight(target.element);

        assert.deepEqual(target.getFrames(), [{height: "96px"}, {height: "0"}]);
        target.animation.finish();
        await target.animation.animation.finished;
    });

    it("uses no duration when reduced motion is requested", async () => {
        reduceMotion = true;
        const target = createElement();
        expandHeight(target.element);
        assert.equal(target.getOptions().duration, 0);
        target.animation.finish();
        await target.animation.animation.finished;
    });

    it("restores existing layout styles", async () => {
        const target = createElement();
        target.element.style.minHeight = "24px";
        target.element.style.overflow = "visible";
        collapseHeight(target.element);

        target.animation.finish();
        await target.animation.animation.finished;
        assert.equal(target.element.style.minHeight, "24px");
        assert.equal(target.element.style.overflow, "visible");
    });

    it("ignores repeated animations for the same element", async () => {
        const target = createElement();
        assert.equal(collapseHeight(target.element), true);
        assert.equal(expandHeight(target.element), false);
        target.animation.finish();
        await target.animation.animation.finished;
    });

    it("cancels without running the completion callback", async () => {
        const target = createElement();
        let finished = false;
        collapseHeight(target.element, () => {
            finished = true;
        });

        assert.equal(cancelHeightAnimation(target.element), true);
        await assert.rejects(target.animation.animation.finished);
        assert.equal(target.animation.isCanceled(), true);
        assert.equal(target.element.style.minHeight, "");
        assert.equal(target.element.style.overflow, "");
        assert.equal(isHeightAnimating(target.element), false);
        assert.equal(finished, false);
    });

    it("finishes the target state when an animation fails", async () => {
        const target = createElement();
        let finished = false;
        collapseHeight(target.element, () => {
            finished = true;
        });

        target.animation.fail(new Error("Animation failed"));
        await assert.rejects(target.animation.animation.finished);
        assert.equal(target.element.style.overflow, "");
        assert.equal(isHeightAnimating(target.element), false);
        assert.equal(finished, true);
    });
});
