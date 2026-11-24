export const bindSelectionQuote = (messages: HTMLElement, quote: (message: HTMLElement, text: string, range: Range) => void) => {
    const doc = messages.ownerDocument;
    const host = messages.parentElement;
    const controller = new AbortController();
    const options = {signal: controller.signal};
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "b3-button b3-button--small b3-button--secondary agent-chat__selection-quote";
    button.textContent = window.siyuan.languages.agentQuoteText;
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
        if (text.trim()) return {message, text, range: range.cloneRange()};
    };
    const capture = {...options, capture: true};
    let shown: ReturnType<typeof selectedPassage>;
    let buttonPointerId: number;
    let pointerId: number;
    let touching = false;
    const hide = () => {
        shown = undefined;
        buttonPointerId = undefined;
        button.remove();
    };
    const update = () => {
        if (pointerId !== undefined || buttonPointerId !== undefined || touching) return;
        const passage = selectedPassage();
        if (!passage) return hide();
        const rect = passage.range.getBoundingClientRect();
        const bounds = messages.getBoundingClientRect();
        if (!rect.width || !bounds.width || !bounds.height || rect.bottom <= bounds.top || rect.top >= bounds.bottom) return hide();
        shown = passage;
        if (!button.isConnected) {
            host.appendChild(button);
        }
        const origin = host.getBoundingClientRect();
        const gap = 4;
        const above = rect.top - button.offsetHeight - gap;
        const top = above >= bounds.top ? above : Math.max(bounds.top, Math.min(rect.bottom + gap, bounds.bottom - button.offsetHeight));
        const left = Math.max(bounds.left, Math.min(rect.left + (rect.width - button.offsetWidth) / 2, bounds.right - button.offsetWidth));
        button.style.top = top - origin.top + "px";
        button.style.left = left - origin.left + "px";
    };
    messages.addEventListener("pointerdown", event => {
        if (event.button !== 0 || !event.isPrimary) return;
        pointerId = event.pointerId;
        hide();
    }, capture);
    doc.addEventListener("pointerup", event => {
        if (event.pointerId === buttonPointerId) {
            // 等待 click 处理按下时的摘录；拖离按钮时也需要结束本次操作。
            doc.defaultView.setTimeout(() => {
                if (buttonPointerId !== event.pointerId) return;
                buttonPointerId = undefined;
                update();
            }, 0);
        }
        if (event.pointerId !== pointerId) return;
        pointerId = undefined;
        update();
    }, capture);
    doc.addEventListener("pointercancel", event => {
        if (event.pointerId === pointerId) pointerId = undefined;
        if (event.pointerId === buttonPointerId) {
            buttonPointerId = undefined;
            update();
        }
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
    button.addEventListener("pointerdown", event => {
        if (event.button !== 0 || !event.isPrimary) return;
        buttonPointerId = event.pointerId;
        event.preventDefault();
    }, options);
    button.addEventListener("click", () => {
        const passage = shown;
        hide();
        if (passage && messages.contains(passage.message)) quote(passage.message, passage.text, passage.range);
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
