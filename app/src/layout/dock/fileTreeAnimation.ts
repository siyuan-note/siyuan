const FILE_TREE_ANIMATION_DURATION = 200;
const FILE_TREE_ANIMATION_EASING = "cubic-bezier(0, 0, .2, 1)";
const animatingElements = new WeakMap<HTMLElement, {
    animation: Animation,
    type: "expand" | "collapse",
}>();

const getAnimationOptions = (): KeyframeAnimationOptions => ({
    duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : FILE_TREE_ANIMATION_DURATION,
    easing: FILE_TREE_ANIMATION_EASING,
    fill: "both",
});

const setAnimationStyles = (element: HTMLElement) => {
    element.style.overflow = "clip";
};

const clearAnimationStyles = (element: HTMLElement) => {
    element.style.removeProperty("overflow");
};

export const expandFileTree = (element: HTMLElement, onFinish?: () => void) => {
    if (animatingElements.has(element)) {
        return;
    }
    setAnimationStyles(element);
    const animation = element.animate([
        {height: "0"},
        {height: `${element.scrollHeight}px`},
    ], getAnimationOptions());
    animatingElements.set(element, {animation, type: "expand"});
    animation.finished.then(() => {
        if (animatingElements.get(element)?.animation !== animation) {
            return;
        }
        animatingElements.delete(element);
        animation.cancel();
        if (!element.isConnected) {
            return;
        }
        clearAnimationStyles(element);
        onFinish?.();
    }, () => {
        if (animatingElements.get(element)?.animation !== animation) {
            return;
        }
        animatingElements.delete(element);
        if (!element.isConnected) {
            return;
        }
        clearAnimationStyles(element);
    });
};

const getLeafElement = (liElement: Element) => {
    const leafElement = liElement.nextElementSibling as HTMLElement;
    return leafElement?.tagName === "UL" ? leafElement : undefined;
};

export const isFileTreeCollapsing = (liElement: Element) => {
    const leafElement = getLeafElement(liElement);
    return leafElement ? animatingElements.get(leafElement)?.type === "collapse" : false;
};

export const cancelFileTreeCollapse = (liElement: Element) => {
    const leafElement = getLeafElement(liElement);
    const animationState = leafElement && animatingElements.get(leafElement);
    if (animationState?.type !== "collapse") {
        return false;
    }
    animatingElements.delete(leafElement);
    animationState.animation.cancel();
    leafElement.remove();
    return true;
};

export const collapseFileTree = (liElement: Element, onFinish: () => void) => {
    const leafElement = getLeafElement(liElement);
    if (!leafElement) {
        liElement.querySelector(".b3-list-item__arrow")?.classList.remove("b3-list-item__arrow--open");
        onFinish();
        return;
    }
    if (animatingElements.has(leafElement)) {
        return;
    }

    liElement.querySelector(".b3-list-item__arrow")?.classList.remove("b3-list-item__arrow--open");
    setAnimationStyles(leafElement);
    const animation = leafElement.animate([
        {height: `${leafElement.scrollHeight}px`},
        {height: "0"},
    ], getAnimationOptions());
    animatingElements.set(leafElement, {animation, type: "collapse"});
    animation.finished.then(() => {
        if (animatingElements.get(leafElement)?.animation !== animation) {
            return;
        }
        animatingElements.delete(leafElement);
        if (!leafElement.isConnected) {
            animation.cancel();
            return;
        }
        leafElement.remove();
        animation.cancel();
        onFinish();
    }, () => {
        if (animatingElements.get(leafElement)?.animation !== animation) {
            return;
        }
        animatingElements.delete(leafElement);
        if (!leafElement.isConnected) {
            return;
        }
        leafElement.remove();
        onFinish();
    });
};

export const toggleFileTree = (liElement: Element, onCollapse: () => void, onExpand: () => void) => {
    const leafElement = getLeafElement(liElement);
    if (leafElement && animatingElements.has(leafElement)) {
        return;
    }
    if (liElement.querySelector(".b3-list-item__arrow--open")) {
        collapseFileTree(liElement, onCollapse);
    } else if (!isFileTreeCollapsing(liElement)) {
        onExpand();
    }
};
