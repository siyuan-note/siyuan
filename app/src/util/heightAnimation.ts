const HEIGHT_ANIMATION_DURATION = 200;
const HEIGHT_ANIMATION_EASING = "cubic-bezier(0, 0, .2, 1)";
const heightAnimations = new WeakMap<HTMLElement, {
    animation: Animation,
    minHeight: string,
    overflow: string,
}>();

const getAnimationOptions = (): KeyframeAnimationOptions => ({
    duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : HEIGHT_ANIMATION_DURATION,
    easing: HEIGHT_ANIMATION_EASING,
    fill: "both",
});

const restoreStyles = (element: HTMLElement, minHeight: string, overflow: string) => {
    if (minHeight) {
        element.style.minHeight = minHeight;
    } else {
        element.style.removeProperty("min-height");
    }
    if (overflow) {
        element.style.overflow = overflow;
    } else {
        element.style.removeProperty("overflow");
    }
};

const animateHeight = (element: HTMLElement, keyframes: Keyframe[], onFinish?: () => void) => {
    if (heightAnimations.has(element)) {
        return false;
    }
    const minHeight = element.style.minHeight;
    const overflow = element.style.overflow;
    element.style.minHeight = "0";
    element.style.overflow = "hidden";
    const animation = element.animate(keyframes, getAnimationOptions());
    const animationState = {animation, minHeight, overflow};
    heightAnimations.set(element, animationState);
    animation.finished.then(() => {
        if (heightAnimations.get(element) !== animationState) {
            return;
        }
        heightAnimations.delete(element);
        animation.cancel();
        restoreStyles(element, minHeight, overflow);
        onFinish?.();
    }, () => {
        if (heightAnimations.get(element) !== animationState) {
            return;
        }
        heightAnimations.delete(element);
        restoreStyles(element, minHeight, overflow);
        onFinish?.();
    });
    return true;
};

export const isHeightAnimating = (element: HTMLElement) => heightAnimations.has(element);

export const cancelHeightAnimation = (element: HTMLElement) => {
    const animationState = heightAnimations.get(element);
    if (!animationState) {
        return false;
    }
    heightAnimations.delete(element);
    animationState.animation.cancel();
    restoreStyles(element, animationState.minHeight, animationState.overflow);
    return true;
};

export const expandHeight = (element: HTMLElement, onFinish?: () => void) => {
    return animateHeight(element, [
        {height: "0"},
        {height: `${element.scrollHeight}px`},
    ], onFinish);
};

export const collapseHeight = (element: HTMLElement, onFinish?: () => void) => {
    return animateHeight(element, [
        {height: `${element.scrollHeight}px`},
        {height: "0"},
    ], onFinish);
};
