interface MarkdownPanelStyleTarget {
    element: HTMLElement;
    properties: string[];
}

interface MarkdownPanelVisibilityOptions {
    animate?: boolean;
    drawer?: boolean;
    force?: boolean;
}

const keyframeProperty = (property: string) => property.startsWith("--") ? property :
    property.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());

const panelProperties = ["opacity", "transform", "display", "direction", "box-sizing", "max-width", "padding-left", "padding-right",
    "border-left-width", "border-right-width"];

export const createMarkdownPanelAnimation = (options: {
    element: HTMLElement;
    applyVisible(visible: boolean, context: {reversing: boolean}): void;
    styleTargets?(): MarkdownPanelStyleTarget[];
}) => {
    const {element} = options;
    const view = element.ownerDocument.defaultView;
    const motion = view?.matchMedia?.("(prefers-reduced-motion: reduce)");
    let target: boolean;
    let destroyed = false;
    let running: {animations: Animation[]; restore(): void};
    const styles = (node: HTMLElement, properties: string[]): Keyframe => {
        const computed = view.getComputedStyle(node);
        return Object.fromEntries(properties.map(property => [keyframeProperty(property), computed.getPropertyValue(property)]));
    };
    const finish = () => {
        const current = running;
        if (!current) return;
        running = undefined;
        for (const animation of current.animations) {
            animation.onfinish = null;
            animation.oncancel = null;
            animation.cancel();
        }
        current.restore();
    };
    const motionChanged = () => {if (motion.matches) finish();};
    motion?.addEventListener("change", motionChanged);

    return {
        setVisible(visible: boolean, settings: MarkdownPanelVisibilityOptions = {}) {
            if (destroyed || target === visible && !settings.force) return;
            const animate = target !== undefined && settings.animate && !settings.force && !motion?.matches &&
                typeof element.animate === "function" && Boolean(view);
            const reversing = Boolean(animate && running);
            let before: {width: number; style: Keyframe; shown: boolean};
            let additional: Array<{target: MarkdownPanelStyleTarget; before: Keyframe}> = [];
            if (animate) {
                try {
                    const style = styles(element, panelProperties);
                    before = {width: element.getBoundingClientRect().width, style,
                        shown: !element.hidden && style.display !== "none"};
                    additional = (options.styleTargets?.() ?? []).map(item => ({target: item,
                        before: styles(item.element, item.properties)}));
                } catch {before = undefined;}
            }
            // 先读取当前绘制值，再撤销旧动画；新目标始终接续用户眼前的位置。
            finish();
            target = visible;
            options.applyVisible(visible, {reversing});
            if (!before) return;

            const saved = new Map<string, {value: string; priority: string}>();
            const remember = (property: string) => {
                if (!saved.has(property)) saved.set(property, {value: element.style.getPropertyValue(property),
                    priority: element.style.getPropertyPriority(property)});
            };
            const set = (property: string, value: string) => {remember(property); element.style.setProperty(property, value);};
            const restoreProperty = (property: string) => {
                const savedProperty = saved.get(property);
                if (savedProperty.value) element.style.setProperty(property, savedProperty.value, savedProperty.priority);
                else element.style.removeProperty(property);
            };
            const hidden = element.getAttribute("hidden");
            const current = {animations: [] as Animation[], restore() {
                for (const [property, value] of saved) {
                    if (value.value) element.style.setProperty(property, value.value, value.priority);
                    else element.style.removeProperty(property);
                }
                if (hidden === null) element.removeAttribute("hidden");
                else element.setAttribute("hidden", hidden);
            }};
            running = current;
            try {
                const after = styles(element, panelProperties);
                const width = visible ? element.getBoundingClientRect().width : before.width;
                const afterAdditional = additional.map(item => styles(item.target.element, item.target.properties));
                if (!Number.isFinite(width) || width <= 0 || visible && (element.hidden || after.display === "none")) {
                    finish();
                    return;
                }
                if (!visible) {
                    // 语义状态已由宿主更新；退场只保留绘制，不重新执行原生展开操作。
                    element.removeAttribute("hidden");
                    set("display", String(before.style.display === "none" ? "block" : before.style.display));
                }
                set("overflow", "clip");
                const start: Keyframe = {opacity: before.shown ? before.style.opacity : "0"};
                const end: Keyframe = {opacity: visible ? after.opacity : "0"};
                if (settings.drawer) {
                    const base = after.transform === "none" ? "" : String(after.transform);
                    const outside = `translateX(${after.direction === "rtl" ? width : -width}px) ${base}`.trim();
                    start.transform = before.shown ? before.style.transform : outside;
                    end.transform = visible ? after.transform : outside;
                } else {
                    // 动画目标取自然宽度，由百分比上限持续约束，父容器变宽时不在结束后突然补宽。
                    let naturalWidth = width;
                    if (visible) {
                        set("max-width", "none");
                        set("flex-shrink", "0");
                        naturalWidth = element.getBoundingClientRect().width;
                        restoreProperty("max-width");
                    }
                    // 使用真实边框盒宽度，避免 flex 收缩、百分比上限和边框在首尾产生位移。
                    set("box-sizing", "border-box");
                    set("min-width", "0");
                    if (after.boxSizing !== "border-box" && after.maxWidth && after.maxWidth !== "none") {
                        const edges = ["paddingLeft", "paddingRight", "borderLeftWidth", "borderRightWidth"]
                            .reduce((sum, property) => sum + (parseFloat(String(after[property])) || 0), 0);
                        set("max-width", `calc(${after.maxWidth} + ${edges}px)`);
                    }
                    set("flex-shrink", "0");
                    start.width = `${before.shown ? before.width : 0}px`;
                    end.width = `${visible ? naturalWidth : 0}px`;
                    for (const property of ["paddingLeft", "paddingRight", "borderLeftWidth", "borderRightWidth"]) {
                        start[property] = before.shown ? before.style[property] : "0px";
                        end[property] = visible ? after[property] : "0px";
                    }
                }
                const timing: KeyframeAnimationOptions = {duration: 200, easing: "cubic-bezier(0, 0, .2, 1)", fill: "both"};
                const panel = element.animate([start, end], timing);
                current.animations.push(panel);
                additional.forEach((item, index) => {
                    if (Object.keys(item.before).some(property => item.before[property] !== afterAdditional[index][property])) {
                        current.animations.push(item.target.element.animate([item.before, afterAdditional[index]], timing));
                    }
                });
                for (const animation of current.animations) {
                    animation.oncancel = () => {if (running === current) finish();};
                }
                panel.onfinish = () => {if (running === current) finish();};
            } catch {finish();}
        },
        destroy() {
            if (destroyed) return;
            destroyed = true;
            finish();
            motion?.removeEventListener("change", motionChanged);
        },
    };
};
