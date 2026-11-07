import {getAnchoredMenuPosition} from "../menus/menuPosition";

const MARKDOWN_TOOLTIP_SELECTOR = "[data-tooltip], .vditor-tooltipped[aria-label]";
let markdownTooltipSequence = 0;

export const createMarkdownTooltips = (root: HTMLElement) => {
    const document = root.ownerDocument;
    const view = document.defaultView;
    const events = new AbortController();
    const {signal} = events;
    const tooltip = document.createElement("div");
    tooltip.id = `markdown-tooltip-${++markdownTooltipSequence}`;
    tooltip.className = "tooltip";
    tooltip.setAttribute("role", "tooltip");
    tooltip.hidden = true;
    tooltip.style.pointerEvents = "none";
    document.body.append(tooltip);
    root.dataset.tooltips = "true";
    let target: HTMLElement;
    let described: HTMLElement;
    let dismissed: HTMLElement;
    let touchInput = view.matchMedia("(hover: none)").matches;
    let disposed = false;
    let feedbackTimeout: number;
    let resetFeedback: () => void;
    const find = (node: EventTarget | null) => {
        const element = node instanceof Element ? node.closest<HTMLElement>(MARKDOWN_TOOLTIP_SELECTOR) : null;
        return element && root.contains(element) ? element : undefined;
    };
    const message = (element: HTMLElement) => {
        const label = element.dataset.tooltip ?? element.getAttribute("aria-label") ?? "";
        return label && element.dataset.tooltipShortcut ? `${label} ${element.dataset.tooltipShortcut}` : label;
    };
    const hide = () => {
        view.clearTimeout(feedbackTimeout);
        const reset = resetFeedback;
        resetFeedback = undefined;
        reset?.();
        tooltip.hidden = true;
        if (described) {
            const ids = (described.getAttribute("aria-describedby") ?? "").split(/\s+/)
                .filter(id => id && id !== tooltip.id);
            if (ids.length) described.setAttribute("aria-describedby", ids.join(" "));
            else described.removeAttribute("aria-describedby");
        }
        target = undefined;
        described = undefined;
    };
    const show = (element: HTMLElement, focus?: HTMLElement, feedback = false) => {
        if (disposed || (touchInput && !feedback) || !element || element.closest("[inert]")) {hide(); return;}
        const text = message(element);
        const anchor = element.getBoundingClientRect();
        if (!text || !anchor.height || !anchor.width || anchor.bottom <= 0 || anchor.top >= view.innerHeight ||
            anchor.right <= 0 || anchor.left >= view.innerWidth) {hide(); return;}
        if (target !== element || described !== (focus ?? element)) hide();
        target = element;
        described = focus ?? element;
        // 提示只读取界面标签，正文链接、图片的 title 与序列化内容保持原样。
        tooltip.textContent = text;
        const ids = new Set((described.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean));
        ids.add(tooltip.id);
        described.setAttribute("aria-describedby", [...ids].join(" "));
        tooltip.style.maxWidth = `${Math.min(320, view.innerWidth)}px`;
        tooltip.style.maxHeight = "90vh";
        tooltip.style.animationDelay = feedback ? "0ms" : element.dataset.delay ? `${element.dataset.delay}ms` : "";
        tooltip.hidden = false;
        const width = tooltip.offsetWidth;
        const height = tooltip.offsetHeight;
        const vendorDirection = [...element.classList].map(name => /^vditor-tooltipped__([nsew])/.exec(name)?.[1]).find(Boolean);
        const directions: Record<string, string> = {n: "north", s: "south", e: "east", w: "west"};
        const position = element.dataset.position || directions[vendorDirection] || "south";
        const gap = parseInt(position) || 0.5;
        let left = anchor.left + (anchor.width - width) / 2;
        let top: number;
        if (position.endsWith("east") || position.endsWith("west")) {
            const west = position.endsWith("west");
            const before = anchor.left - width - gap;
            const after = anchor.right + gap;
            left = west ? (before >= 0 ? before : after) : (after + width <= view.innerWidth ? after : before);
            top = Math.max(0, Math.min(view.innerHeight - height, anchor.top + (anchor.height - height) / 2));
        } else {
            const north = position.endsWith("north");
            const placement = getAnchoredMenuPosition(north ? view.innerHeight - anchor.top + gap : anchor.bottom + gap,
                anchor.height + gap * 2, height, view.innerHeight, 0);
            top = north ? view.innerHeight - placement.top - placement.height : placement.top;
            tooltip.style.maxHeight = `${placement.height}px`;
        }
        tooltip.style.left = `${Math.max(0, Math.min(view.innerWidth - width, left))}px`;
        tooltip.style.top = `${Math.max(0, top)}px`;
    };
    root.addEventListener("markdown-copy-success", event => {
        const button = find(event.target);
        if (!button?.closest(".vditor-copy")) return;
        dismissed = undefined;
        show(button, undefined, true);
        const label = (event as CustomEvent<{label: string}>).detail?.label;
        resetFeedback = () => {if (label) button.setAttribute("aria-label", label);};
        view.clearTimeout(feedbackTimeout);
        feedbackTimeout = view.setTimeout(hide, 1500);
    }, {signal});
    const pointer = (event: PointerEvent) => {
        if (["mouse", "touch", "pen"].includes(event.pointerType)) touchInput = event.pointerType === "touch";
        const next = find(event.target);
        if (dismissed !== next) dismissed = undefined;
        if (touchInput || !next || next === dismissed) hide();
        else if (next !== target || message(next) !== tooltip.textContent) show(next);
    };
    root.addEventListener("pointerover", pointer, {capture: true, passive: true, signal});
    // 禁用按钮仍分发 pointer 事件，必要说明不依赖 click 或可聚焦状态。
    root.addEventListener("pointermove", pointer, {capture: true, passive: true, signal});
    root.addEventListener("pointerout", event => {
        const next = find(event.relatedTarget);
        if (dismissed !== next) dismissed = undefined;
        if (target && target !== next) hide();
    }, {capture: true, passive: true, signal});
    root.addEventListener("focusin", event => show(find(event.target), event.target as HTMLElement), {signal});
    root.addEventListener("focusout", hide, {signal});
    document.addEventListener("pointerdown", event => {
        if (["mouse", "touch", "pen"].includes(event.pointerType)) touchInput = event.pointerType === "touch";
        dismissed = target;
        hide();
    }, {capture: true, passive: true, signal});
    document.addEventListener("keydown", event => {
        if (event.key === "Escape") {dismissed = target; hide();}
        else if (event.key === "Tab") touchInput = false;
    }, {capture: true, signal});
    document.addEventListener("scroll", hide, {capture: true, passive: true, signal});
    view.addEventListener("resize", hide, {signal});
    view.addEventListener("blur", hide, {signal});
    const observer = new MutationObserver(records => {
        if (!target) return;
        if (!root.contains(target) || !root.contains(described) || target.closest("[inert]") || !target.getClientRects().length) {hide(); return;}
        if (records.some(record => record.type === "attributes" &&
            ["class", "style", "hidden", "open"].includes(record.attributeName) &&
            (record.target as Element).contains(target))) {hide(); return;}
        if (message(target) !== tooltip.textContent) show(target, described);
    });
    observer.observe(root, {childList: true, subtree: true, attributes: true,
        attributeFilter: ["data-tooltip", "data-tooltip-shortcut", "aria-label", "class", "style", "hidden", "inert", "open"]});
    return {destroy() {
        if (disposed) return;
        disposed = true;
        hide(); events.abort(); observer.disconnect(); tooltip.remove(); delete root.dataset.tooltips;
    }};
};
