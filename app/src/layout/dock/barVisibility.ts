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
    followsPanel: boolean;
    frame: number;
}>();

// 面板偏移与停靠栏动画共用停靠栏宽度，宽度来源不同会在动画结束时留下缝隙。
export const getDockBarWidth = (barElement: HTMLElement) => barElement.clientWidth;

const pointerOverDockBars = new WeakSet<HTMLElement>();

// 面板收起时指针仍停在图标栏上，保留临时显示以便继续切换工具。
export const setDockBarPointerOver = (barElement: HTMLElement, over: boolean) => {
    if (over) {
        pointerOverDockBars.add(barElement);
    } else {
        pointerOverDockBars.delete(barElement);
    }
};

export const isDockBarPointerOver = (barElement: HTMLElement) => pointerOverDockBars.has(barElement);

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
    effects.followsPanel = Boolean(panel);
    element.classList.toggle("dock--closing", closing);
    element.inert = closing;
    effects.animations = [element, effects.backdrop].flatMap(target => [
        target.animate(panel ? [{transform: `translateX(${from}px)`}] :
            [{transform: `translateX(${from}px)`}, {transform: `translateX(${to}px)`}], {
            duration: panel ? 0 : 200, easing: "cubic-bezier(0, 0, .2, 1)", fill: "both",
        }),
        target.animate(panel ? [{opacity}] : [{opacity}, {opacity: closing ? "0" : "1"}], {
            duration: panel ? 0 : 300, easing: "cubic-bezier(0, 0, .2, 1)", fill: "both",
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
    const finishAnimations = () => {
        const animations = effects.animations;
        // 位移与透明度可使用不同的时长和延迟；反向操作取消的动画不能清理新一轮动画。
        Promise.all(animations.map(animation => animation.finished)).then(() => {
            if (floatingBarEffects.get(element) === effects && effects.animations === animations) {
                finish();
            }
        }).catch(() => {
            // 取消动画时 finished 会拒绝，当前显隐状态由接替的动画负责。
        });
    };
    if (panel) {
        // 原生过渡在反向播放时会缩短时长，复制其关键帧和时间轴以保持边缘贴合。
        effects.frame = requestAnimationFrame(() => {
            const offset = (element.id === "dockLeft" ? -1 : 1) * element.clientWidth;
            const panelStyle = getComputedStyle(panel);
            const sources = panel.getAnimations();
            effects.animations.forEach(animation => animation.cancel());
            effects.animations = ["transform", "opacity"].flatMap(property => {
                const source = sources.find(animation => animation instanceof CSSTransition &&
                    animation.transitionProperty === property);
                const transform = property === "transform";
                const frames = source ? (source.effect as KeyframeEffect).getKeyframes().map(frame => ({
                    offset: frame.offset, easing: frame.easing,
                    ...(transform ? {transform: `translateX(${new DOMMatrixReadOnly(frame.transform as string).m41 + offset}px)`} :
                        {opacity: frame.opacity}),
                })) : [transform ? {transform: `translateX(${new DOMMatrixReadOnly(panelStyle.transform).m41 + offset}px)`} :
                    {opacity: panelStyle.opacity}];
                // 无过渡的属性直接使用面板当前值；延迟开始的过渡也要保持起始帧。
                return [element, effects.backdrop].map(target => {
                    const animation = target.animate(transform && !closing ?
                        [...frames.slice(0, -1), {...frames[frames.length - 1], transform: "translateX(0px)"}] : frames, {
                        ...(source ? source.effect.getTiming() : {duration: 0}), fill: "both",
                    });
                    if (typeof source?.startTime === "number") {
                        animation.startTime = source.startTime;
                    }
                    return animation;
                });
            });
            finishAnimations();
        });
    } else {
        finishAnimations();
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
    // 右侧内容左边界与窗口边缘的距离，供通知等固定定位元素避让
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
            if (canFloat) {
                // 面板收起时图标栏跟随面板；面板已经消失时单独滑出，避免被瞬间移除。
                const panelVisible = dock.isPanelVisible() && !dock.layout.element.classList.contains("fn__none");
                if (!effects.closing) {
                    const barWidth = Math.max(item.clientWidth, effects.backdrop.clientWidth);
                    animateFloatingBar(item, getTranslateX(item),
                        direction * (dock.layout.element.clientWidth + barWidth + 8), true,
                        panelVisible ? dock.layout.element : undefined);
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
        if (item.id === "dockRight") {
            // 停靠栏占用布局时是栏宽，隐藏或浮动时编辑区只保留自身外边距
            rightDockWidth = !hidden && !displayingFloat ? "var(--b3-ui-dock-width, 42px)" :
                "var(--b3-layout-space)";
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
                floatingBarEffects.set(item, {backdrop, animations: [], closing: false, followsPanel: false, frame: 0});
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
            // 面板展开时图标栏要重新贴合面板外沿；面板已就位时保持当前状态，避免重复启动动画。
            const needsFollow = floating && floatingPanelOpen && !currentEffects?.followsPanel &&
                Math.abs(getTranslateX(item) - (getTranslateX(dock.layout.element) + direction * item.clientWidth)) >= 1;
            if (floating && (!effects || effects.closing || needsFollow)) {
                // 面板先进入窗口，图标栏贴着面板外沿使用相同的位移曲线滑入。
                const from = floatingPanelOpen ? getTranslateX(dock.layout.element) + direction * item.clientWidth :
                    effects ? getTranslateX(item) : direction * item.clientWidth;
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
