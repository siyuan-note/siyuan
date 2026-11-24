import {getTopBarHeight} from "../../../layout/getTopBarHeight";
import {setPosition} from "../../../util/setPosition";

export const bindSelectionQuote = (messages: HTMLElement, quote: (message: HTMLElement, text: string) => void) => {
    const doc = messages.ownerDocument;
    const controller = new AbortController();
    const options = {signal: controller.signal};
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "b3-button b3-button--small b3-button--secondary agent-chat__selection-quote";
    button.textContent = window.siyuan.languages.agentQuoteText;
    const hide = () => button.remove();
    const selectedPassage = () => {
        const selection = doc.getSelection();
        if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return;
        const range = selection.getRangeAt(0);
        if (!messages.contains(range.commonAncestorContainer)) return;
        const node = range.commonAncestorContainer;
        const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
        const body = element?.closest(".agent-chat__body");
        const message = body?.closest<HTMLElement>(".agent-chat__msg[data-message-id]");
        if (!message || message.classList.contains("agent-chat__msg--editing") ||
            !message.querySelector(".agent-chat__msg-actions")) return;
        const text = selection.toString();
        if (text.trim()) return {message, text, range};
    };
    const capture = {...options, capture: true};
    let pointerId: number;
    let touching = false;
    const update = () => {
        if (pointerId !== undefined || touching) return;
        const passage = selectedPassage();
        if (!passage) return hide();
        const rect = passage.range.getBoundingClientRect();
        const bounds = messages.getBoundingClientRect();
        if (!rect.width || rect.bottom <= bounds.top || rect.top >= bounds.bottom) return hide();
        if (!button.isConnected) {
            button.style.zIndex = (++window.siyuan.zIndex).toString();
            doc.body.appendChild(button);
        }
        const gap = 4;
        const above = rect.top - button.offsetHeight - gap;
        const top = above >= Math.max(bounds.top, getTopBarHeight()) ? above : Math.min(bounds.bottom, rect.bottom) + gap;
        const left = Math.max(bounds.left, Math.min(rect.left + (rect.width - button.offsetWidth) / 2, bounds.right - button.offsetWidth));
        setPosition(button, left, top, rect.height + 2 * gap);
    };
    messages.addEventListener("pointerdown", event => {
        if (event.button !== 0 || !event.isPrimary) return;
        pointerId = event.pointerId;
        hide();
    }, capture);
    doc.addEventListener("pointerup", event => {
        if (event.pointerId !== pointerId) return;
        pointerId = undefined;
        update();
    }, capture);
    doc.addEventListener("pointercancel", event => {
        if (event.pointerId === pointerId) pointerId = undefined;
    }, capture);
    // 原生长按选词可能先取消指针事件，手指抬起前仍要等待触摸结束。
    messages.addEventListener("touchstart", () => {
        touching = true;
        hide();
    }, {...capture, passive: true});
    doc.addEventListener("touchend", event => {
        if (!touching || event.touches.length) return;
        touching = false;
        update();
    }, capture);
    doc.addEventListener("touchcancel", event => {
        if (!event.touches.length) touching = false;
    }, capture);
    doc.defaultView.addEventListener("blur", () => {
        pointerId = undefined;
        touching = false;
        hide();
    }, options);
    doc.addEventListener("selectionchange", update, options);
    button.addEventListener("pointerdown", event => event.preventDefault(), options);
    button.addEventListener("click", () => {
        const passage = selectedPassage();
        hide();
        if (passage) quote(passage.message, passage.text);
    }, options);
    doc.addEventListener("scroll", hide, {...options, capture: true});
    doc.defaultView.addEventListener("resize", hide, options);
    doc.addEventListener("keydown", event => {
        if (event.key === "Escape") hide();
    }, options);
    return () => {
        controller.abort();
        hide();
    };
};
