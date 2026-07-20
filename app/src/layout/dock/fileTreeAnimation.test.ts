import {after, before, beforeEach, describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    cancelFileTreeCollapse,
    collapseFileTree,
    expandFileTree,
    isFileTreeCollapsing
} from "./fileTreeAnimation";

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

const createTreeElements = () => {
    const animation = createAnimation();
    let frames!: Keyframe[] | PropertyIndexedKeyframes;
    let options!: number | KeyframeAnimationOptions;
    let arrowClosed = false;
    const style = {
        overflow: "",
        removeProperty(property: string) {
            if (property === "overflow") {
                this.overflow = "";
            }
            return "";
        },
    } as unknown as CSSStyleDeclaration;
    const leafElement = {
        tagName: "UL",
        scrollHeight: 96,
        style,
        isConnected: true,
        animate(animationFrames: Keyframe[] | PropertyIndexedKeyframes, animationOptions?: number | KeyframeAnimationOptions) {
            frames = animationFrames;
            options = animationOptions;
            return animation.animation;
        },
        remove() {
            this.isConnected = false;
        },
    } as unknown as HTMLElement;
    const liElement = {
        nextElementSibling: leafElement,
        querySelector() {
            return {
                classList: {
                    remove() {
                        arrowClosed = true;
                    },
                },
            };
        },
    } as unknown as Element;
    return {
        animation,
        leafElement,
        liElement,
        getFrames: () => frames,
        getOptions: () => options as KeyframeAnimationOptions,
        isArrowClosed: () => arrowClosed,
    };
};

describe("fileTreeAnimation", () => {
    it("expands to the actual content height and restores overflow", async () => {
        const tree = createTreeElements();
        let finished = false;
        expandFileTree(tree.leafElement, () => {
            finished = true;
        });

        assert.deepEqual(tree.getFrames(), [{height: "0"}, {height: "96px"}]);
        assert.equal(tree.getOptions().duration, 200);
        assert.equal(tree.leafElement.style.overflow, "hidden");

        tree.animation.finish();
        await tree.animation.animation.finished;
        assert.equal(tree.animation.isCanceled(), true);
        assert.equal(tree.leafElement.style.overflow, "");
        assert.equal(finished, true);
    });

    it("uses no duration when reduced motion is requested", async () => {
        reduceMotion = true;
        const tree = createTreeElements();
        expandFileTree(tree.leafElement);
        assert.equal(tree.getOptions().duration, 0);
        tree.animation.finish();
        await tree.animation.animation.finished;
    });

    it("collapses once and removes the child list after the animation", async () => {
        const tree = createTreeElements();
        let finishCount = 0;
        collapseFileTree(tree.liElement, () => finishCount++);
        collapseFileTree(tree.liElement, () => finishCount++);

        assert.equal(tree.isArrowClosed(), true);
        assert.equal(isFileTreeCollapsing(tree.liElement), true);
        assert.deepEqual(tree.getFrames(), [{height: "96px"}, {height: "0"}]);

        tree.animation.finish();
        await tree.animation.animation.finished;
        assert.equal(tree.leafElement.isConnected, false);
        assert.equal(isFileTreeCollapsing(tree.liElement), false);
        assert.equal(finishCount, 1);
    });

    it("cancels and removes an in-progress collapse", async () => {
        const tree = createTreeElements();
        let finished = false;
        collapseFileTree(tree.liElement, () => {
            finished = true;
        });

        assert.equal(cancelFileTreeCollapse(tree.liElement), true);
        await assert.rejects(tree.animation.animation.finished);
        assert.equal(tree.animation.isCanceled(), true);
        assert.equal(tree.leafElement.isConnected, false);
        assert.equal(isFileTreeCollapsing(tree.liElement), false);
        assert.equal(finished, false);
    });

    it("finishes a collapse if the animation fails unexpectedly", async () => {
        const tree = createTreeElements();
        let finished = false;
        collapseFileTree(tree.liElement, () => {
            finished = true;
        });

        tree.animation.fail(new Error("Animation failed"));
        await assert.rejects(tree.animation.animation.finished);
        assert.equal(tree.leafElement.isConnected, false);
        assert.equal(isFileTreeCollapsing(tree.liElement), false);
        assert.equal(finished, true);
    });
});
