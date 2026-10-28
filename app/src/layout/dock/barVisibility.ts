export const shouldShowDockBar = (globallyHidden: boolean, hasVisibleEntry: boolean, temporarilyShown = false) =>
    (!globallyHidden || temporarilyShown) && hasVisibleEntry;

export const shouldShowDockSplit = (hasVisibleEntryBefore: boolean, hasVisibleEntryAfter: boolean) =>
    hasVisibleEntryBefore && hasVisibleEntryAfter;

const hoveredDockBars = new WeakSet<HTMLElement>();
let floatingBarResizeObserver: ResizeObserver;
const floatingBarEffects = new WeakMap<HTMLElement, {
    backdrop: HTMLElement;
    animations: Animation[];
    closing: boolean;
    frame: number;
}>();

const clearFloatingBarEffects = (element: HTMLElement) => {
    const effects = floatingBarEffects.get(element);
    effects?.animations.forEach(animation => animation.cancel());
    if (effects) {
        cancelAnimationFrame(effects.frame);
    }
    effects?.backdrop.remove();
    floatingBarEffects.delete(element);
    element.classList.remove("dock--closing");
    element.inert = false;
};

const animateFloatingBar = (element: HTMLElement, from: number, to: number, closing: boolean, panel?: HTMLElement) => {
    const effects = floatingBarEffects.get(element);
    const opacity = effects.animations.length ? getComputedStyle(element).opacity : closing ? "1" : "0";
    effects.animations.forEach(animation => animation.cancel());
    cancelAnimationFrame(effects.frame);
    effects.closing = closing;
    element.classList.toggle("dock--closing", closing);
    element.inert = closing;
    effects.animations = [element, effects.backdrop].flatMap(target => [
        target.animate([{transform: `translateX(${from}px)`}, {transform: `translateX(${to}px)`}], {
            duration: 200, easing: "cubic-bezier(0, 0, .2, 1)", fill: "forwards",
        }),
        target.animate([{opacity}, {opacity: closing ? "0" : "1"}], {
            duration: 300, easing: "cubic-bezier(0, 0, .2, 1)", fill: "forwards",
        }),
    ]);
    const finish = () => {
        if (closing) {
            clearFloatingBarEffects(element);
            syncDockBarVisibility();
        } else {
            effects.animations.forEach(animation => animation.cancel());
            effects.animations = [];
        }
    };
    effects.animations[effects.animations.length - 1].onfinish = finish;
    if (panel) {
        // 原生过渡在反向播放时会缩短时长，复制其关键帧和时间轴以保持边缘贴合。
        effects.frame = requestAnimationFrame(() => {
            const offset = (element.id === "dockLeft" ? -1 : 1) * element.clientWidth;
            for (const source of panel.getAnimations()) {
                if (!(source instanceof CSSTransition) || !["transform", "opacity"].includes(source.transitionProperty)) {
                    continue;
                }
                const transform = source.transitionProperty === "transform";
                const frames = (source.effect as KeyframeEffect).getKeyframes().map(frame => ({
                    offset: frame.offset, easing: frame.easing,
                    ...(transform ? {transform: `translateX(${new DOMMatrixReadOnly(frame.transform as string).m41 + offset}px)`} :
                        {opacity: frame.opacity}),
                }));
                [element, effects.backdrop].forEach((target, index) => {
                    const slot = index * 2 + (transform ? 0 : 1);
                    effects.animations[slot].cancel();
                    const animation = target.animate(frames, {...source.effect.getTiming(), fill: "forwards"});
                    if (typeof source.startTime === "number") {
                        animation.startTime = source.startTime;
                    }
                    effects.animations[slot] = animation;
                });
            }
            effects.animations[effects.animations.length - 1].onfinish = finish;
        });
    }
};

const getTranslateX = (element: HTMLElement) => new DOMMatrixReadOnly(getComputedStyle(element).transform).m41;

export const adjustDockPadding = () => {
    const layoutElement = window.siyuan.layout?.layout?.children[0]?.element;
    const leftDockElement = window.siyuan.layout?.leftDock?.elements[0]?.parentElement;
    const rightDockElement = window.siyuan.layout?.rightDock?.elements[0]?.parentElement;
    // 设置窗口和独立编辑窗口没有主窗口的停靠栏，布局初始化完成后才调整间距。
    if (!layoutElement || !leftDockElement || !rightDockElement) {
        return;
    }
    if (leftDockElement.classList.contains("fn__none") || leftDockElement.classList.contains("dock--float")) {
        layoutElement.style.marginLeft = "var(--b3-layout-space)";
    } else {
        layoutElement.style.marginLeft = "";
    }
    if (rightDockElement.classList.contains("fn__none") || rightDockElement.classList.contains("dock--float")) {
        layoutElement.style.marginRight = "var(--b3-layout-space)";
    } else {
        layoutElement.style.marginRight = "";
    }
    if (window.siyuan.config.appearance.hideStatusBar) {
        layoutElement.style.marginBottom = "var(--b3-layout-space)";
    } else {
        layoutElement.style.marginBottom = "";
    }
};

export const syncDockBarVisibility = () => {
    let changed = false;
    let hasFloatingBar = false;
    const cornerElements: HTMLElement[] = [];
    // 右侧停靠栏占用布局空间时记录宽度，供通知等固定定位元素避让
    let rightDockWidth = "0px";
    document.querySelectorAll<HTMLElement>(".dock").forEach((item) => {
        const sections = Array.from(item.querySelectorAll<HTMLElement>(":scope > .dock__items"));
        const sectionVisibility = sections.map((section) =>
            Boolean(section.querySelector(".dock__item[data-type]:not(.fn__none)")));
        const splitElement = item.querySelector(":scope > .dock__split");
        splitElement?.classList.toggle("fn__none", !shouldShowDockSplit(
            sectionVisibility[0],
            sectionVisibility[1],
        ));
        const dock = item.id === "dockLeft" ? window.siyuan.layout?.leftDock :
            item.id === "dockRight" ? window.siyuan.layout?.rightDock : undefined;
        const floatingPanelOpen = Boolean(dock?.isFloating() && dock.isPanelVisible() &&
            !dock.layout.element.classList.contains("fn__none") && dock.layout.element.style.opacity === "1");
        const canFloat = window.siyuan.config.uiLayout.hideDock && dock?.isFloating() && sectionVisibility.some(Boolean);
        if (!canFloat) {
            hoveredDockBars.delete(item);
        }
        const floating = Boolean(canFloat && (floatingPanelOpen || hoveredDockBars.has(item)));
        const wasFloating = item.classList.contains("dock--float");
        const effects = floatingBarEffects.get(item);
        const direction = item.id === "dockLeft" ? -1 : 1;
        if (!floating && effects) {
            if (canFloat && dock.isPanelVisible() && !dock.layout.element.classList.contains("fn__none")) {
                if (!effects.closing) {
                    animateFloatingBar(item, getTranslateX(item),
                        direction * (dock.layout.element.clientWidth + item.clientWidth + 8), true, dock.layout.element);
                }
            } else {
                clearFloatingBarEffects(item);
            }
        }
        const displayingFloat = floating || floatingBarEffects.has(item);
        item.classList.toggle("dock--float", displayingFloat);
        const hidden = !shouldShowDockBar(
            window.siyuan.config.uiLayout.hideDock,
            sectionVisibility.some(Boolean),
            displayingFloat,
        );
        changed = item.classList.contains("fn__none") !== hidden || wasFloating !== displayingFloat || changed;
        item.classList.toggle("fn__none", hidden);
        if (item.id === "dockRight" && !hidden && !displayingFloat) {
            rightDockWidth = "var(--b3-ui-dock-width, 42px)";
        }
        if (displayingFloat) {
            hasFloatingBar = true;
            // 保留停靠栏原有的顶栏避让和高度范围，临时显示时脱离编辑区布局。
            const rowRect = item.parentElement.getBoundingClientRect();
            item.style.top = rowRect.top + "px";
            item.style.bottom = (window.innerHeight - rowRect.bottom) + "px";
            item.style.zIndex = (Math.max(10, Number(dock.layout.element.style.zIndex)) - 1).toString();
            if (floating && !floatingBarEffects.has(item)) {
                const backdrop = document.createElement("div");
                backdrop.className = item.id === "dockLeft" ? "dock__backdrop" : "dock__backdrop dock__backdrop--right";
                backdrop.setAttribute("aria-hidden", "true");
                item.before(backdrop);
                floatingBarEffects.set(item, {backdrop, animations: [], closing: false, frame: 0});
            }
            const currentEffects = floatingBarEffects.get(item);
            const cornerElement = document.body.classList.contains("body--toolbar-hide") ?
                window.siyuan.layout?.centerLayout?.element.querySelector<HTMLElement>(item.id === "dockLeft" ?
                    ".layout__wnd--left .layout-tab-container" : ".layout__wnd--right .layout-tab-container") : undefined;
            // 融合顶栏的页签保持透明，内圆角从页签下方的编辑内容上沿开始。
            const backgroundTop = cornerElement?.clientHeight ? cornerElement.getBoundingClientRect().top : rowRect.top;
            if (cornerElement) {
                cornerElements.push(cornerElement);
            }
            currentEffects.backdrop.style.top = backgroundTop + "px";
            currentEffects.backdrop.style.bottom = item.style.bottom;
            currentEffects.backdrop.style.setProperty("--b3-dock-background-y", -backgroundTop + "px");
            if (floating && (!effects || effects.closing)) {
                // 面板先进入窗口，图标栏贴着面板外沿使用相同的位移曲线滑入。
                const from = effects ? getTranslateX(item) : floatingPanelOpen ?
                    getTranslateX(dock.layout.element) + direction * item.clientWidth : direction * item.clientWidth;
                animateFloatingBar(item, from, 0, false, floatingPanelOpen ? dock.layout.element : undefined);
            }
        } else if (wasFloating) {
            item.style.top = "";
            item.style.bottom = "";
            item.style.zIndex = "";
        }
    });
    document.documentElement.style.setProperty("--b3-dock-right-width", rightDockWidth);
    adjustDockPadding();
    if (hasFloatingBar && !floatingBarResizeObserver) {
        floatingBarResizeObserver = new ResizeObserver(() => {
            syncDockBarVisibility();
            for (const dock of [window.siyuan.layout?.leftDock, window.siyuan.layout?.rightDock]) {
                if (dock?.elements[0].parentElement.classList.contains("dock--float") &&
                    dock.isPanelVisible() && dock.layout.element.style.opacity === "1") {
                    dock.showDock(true);
                }
            }
        });
        for (const element of [document.getElementById("dockLeft"), document.getElementById("dockRight")]) {
            if (element) {
                floatingBarResizeObserver.observe(element);
                floatingBarResizeObserver.observe(element.parentElement);
            }
        }
    } else if (!hasFloatingBar && floatingBarResizeObserver) {
        floatingBarResizeObserver.disconnect();
        floatingBarResizeObserver = undefined;
    }
    cornerElements.forEach(element => floatingBarResizeObserver?.observe(element));
    return changed;
};

export const setDockBarHover = (element: HTMLElement, hovered: boolean) => {
    if (hovered) {
        hoveredDockBars.add(element);
    } else {
        hoveredDockBars.delete(element);
    }
    syncDockBarVisibility();
};
