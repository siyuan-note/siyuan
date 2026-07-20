const FILE_TREE_ANIMATION_DURATION = 200;
const FILE_TREE_ANIMATION_EASING = "cubic-bezier(0, 0, .2, 1)";
const collapsingElements = new WeakMap<HTMLElement, Animation>();

const getAnimationOptions = (): KeyframeAnimationOptions => ({
    duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : FILE_TREE_ANIMATION_DURATION,
    easing: FILE_TREE_ANIMATION_EASING,
    fill: "both",
});

export const expandFileTree = (element: HTMLElement, onFinish?: () => void) => {
    element.style.overflow = "hidden";
    const animation = element.animate([
        {height: "0"},
        {height: `${element.scrollHeight}px`},
    ], getAnimationOptions());
    animation.finished.then(() => {
        animation.cancel();
        if (!element.isConnected) {
            return;
        }
        element.style.removeProperty("overflow");
        onFinish?.();
    }, () => {
        if (element.isConnected) {
            element.style.removeProperty("overflow");
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

    leafElement.style.overflow = "hidden";
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
