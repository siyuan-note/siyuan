const FILE_TREE_ANIMATION_DURATION = 200;
const FILE_TREE_ANIMATION_EASING = "cubic-bezier(0, 0, .2, 1)";
const collapsingElements = new WeakMap<HTMLElement, Animation>();

const getAnimationOptions = (): KeyframeAnimationOptions => ({
    duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : FILE_TREE_ANIMATION_DURATION,
    easing: FILE_TREE_ANIMATION_EASING,
    fill: "both",
});

const setAnimationStyles = (element: HTMLElement) => {
    element.style.overflow = "clip";
    element.style.position = "relative";
};

const clearAnimationStyles = (element: HTMLElement) => {
    element.style.removeProperty("overflow");
    element.style.removeProperty("position");
};

export const expandFileTree = (element: HTMLElement, onFinish?: () => void) => {
    setAnimationStyles(element);
    const animation = element.animate([
        {height: "0"},
        {height: `${element.scrollHeight}px`},
    ], getAnimationOptions());
    animation.finished.then(() => {
        animation.cancel();
        if (!element.isConnected) {
            return;
        }
        clearAnimationStyles(element);
        onFinish?.();
    }, () => {
        if (element.isConnected) {
            clearAnimationStyles(element);
        }
    });
};

const getLeafElement = (liElement: Element) => {
    const leafElement = liElement.nextElementSibling as HTMLElement;
    return leafElement?.tagName === "UL" ? leafElement : undefined;
};

export const isFileTreeCollapsing = (liElement: Element) => {
    const leafElement = getLeafElement(liElement);
    return leafElement ? collapsingElements.has(leafElement) : false;
};

export const cancelFileTreeCollapse = (liElement: Element) => {
    const leafElement = getLeafElement(liElement);
    const animation = leafElement && collapsingElements.get(leafElement);
    if (!animation) {
        return false;
    }
    collapsingElements.delete(leafElement);
    animation.cancel();
    leafElement.remove();
    return true;
};

export const collapseFileTree = (liElement: Element, onFinish: () => void) => {
    liElement.querySelector(".b3-list-item__arrow")?.classList.remove("b3-list-item__arrow--open");
    const leafElement = getLeafElement(liElement);
    if (!leafElement) {
        onFinish();
        return;
    }
    if (collapsingElements.has(leafElement)) {
        return;
    }

    setAnimationStyles(leafElement);
    const animation = leafElement.animate([
        {height: `${leafElement.scrollHeight}px`},
        {height: "0"},
    ], getAnimationOptions());
    collapsingElements.set(leafElement, animation);
    animation.finished.then(() => {
        if (collapsingElements.get(leafElement) !== animation) {
            return;
        }
        collapsingElements.delete(leafElement);
        if (!leafElement.isConnected) {
            animation.cancel();
            return;
        }
        leafElement.remove();
        animation.cancel();
        onFinish();
    }, () => {
        if (collapsingElements.get(leafElement) !== animation) {
            return;
        }
        collapsingElements.delete(leafElement);
        if (!leafElement.isConnected) {
            return;
        }
        leafElement.remove();
        onFinish();
    });
};

export const toggleFileTree = (liElement: Element, onCollapse: () => void, onExpand: () => void) => {
    if (liElement.querySelector(".b3-list-item__arrow--open")) {
        collapseFileTree(liElement, onCollapse);
    } else if (!isFileTreeCollapsing(liElement)) {
        onExpand();
    }
};
