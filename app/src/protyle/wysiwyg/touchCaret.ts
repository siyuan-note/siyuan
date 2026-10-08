import {Constants} from "../../constants";
import {focusByRange} from "../util/selectionOffsets";
import {isCommittedTextInput} from "./compositionInput";
import {bindTouchNavigation} from "./touchNavigation";

const TOUCH_CARET_EXCLUDED = "input, textarea, select, button, a, img, audio, video, iframe, " +
    ".protyle-action, .protyle-attr, .table, .av, .protyle-custom, [data-prevent-swipe], " +
    "[data-type~='block-ref'], [data-type~='virtual-block-ref'], [data-type~='file-annotation-ref'], " +
    "[data-type~='a'], [data-type~='tag'], [data-type~='inline-memo'], [data-type~='inline-math']";

const getTouchCharacterRange = (range: Range, point: {x: number, y: number}) => {
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) {
        return;
    }
    for (const candidate of [range.startOffset, range.startOffset - 1]) {
        if (candidate < 0 || candidate >= node.textContent.length) {
            continue;
        }
        const start = candidate > 0 && /[\uDC00-\uDFFF]/.test(node.textContent[candidate]) ? candidate - 1 : candidate;
        const end = start + (node.textContent.codePointAt(start) > 0xffff ? 2 : 1);
        const character = range.cloneRange();
        character.setStart(node, start);
        character.setEnd(node, end);
        if (character.toString().trim() && Array.from(character.getClientRects()).some(rect =>
            point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom)) {
            return character;
        }
    }
};

export const bindIOSTouchCaret = (element: HTMLElement, canPlaceCaret: () => boolean) => {
    const ownerDocument = element.ownerDocument;
    const ownerWindow = ownerDocument.defaultView;
    let frame: number;
    let composing = false;
    let touchCaret: {editable: HTMLElement, range: Range, character?: Range, startedUnfocused: boolean, time: number};
    let previousTap: typeof touchCaret & {time: number, x: number, y: number, count: number, word?: Range | false};
    let pendingTap: typeof previousTap;
    const cancelFrame = () => {
        if (frame !== undefined) {
            ownerWindow.cancelAnimationFrame(frame);
            frame = undefined;
        }
    };
    const cancel = () => {
        cancelFrame();
        pendingTap = undefined;
    };
    const schedule = () => {
        cancelFrame();
        const tap = pendingTap;
        // 等待原生点击更新折叠选区后校正位置，不阻止点击、键盘唤起或系统文字选择手势。
        frame = ownerWindow.requestAnimationFrame(() => {
            frame = undefined;
            const selection = ownerDocument.getSelection();
            const activeElement = ownerDocument.activeElement;
            if (composing || !canPlaceCaret() || !tap.range.startContainer.isConnected ||
                !tap.editable.isContentEditable || !element.contains(activeElement) ||
                (!tap.editable.contains(activeElement) && !activeElement.contains(tap.editable)) ||
                !selection?.isCollapsed || selection.rangeCount === 0 ||
                !element.contains(selection.anchorNode)) {
                return;
            }
            if (tap.count === 1) {
                if (selection.anchorNode !== tap.range.startContainer || selection.anchorOffset !== tap.range.startOffset) {
                    focusByRange(tap.range);
                }
                return;
            }
            if (tap.word === false || !tap.character?.startContainer.isConnected) {
                return;
            }
            if (tap.word) {
                focusByRange(tap.word);
                return;
            }
            const word = tap.character.cloneRange() as Range & {expand?: (unit: string) => void};
            if (typeof word.expand === "function") {
                word.expand("word");
            } else {
                // 使用浏览器的分词粒度，兼容未提供 Range.expand 的实现。
                const saved = selection.getRangeAt(0).cloneRange();
                selection.collapse(word.endContainer, word.endOffset);
                selection.modify("move", "backward", "word");
                selection.modify("extend", "forward", "word");
                const expanded = selection.getRangeAt(0);
                word.setStart(expanded.startContainer, expanded.startOffset);
                word.setEnd(expanded.endContainer, expanded.endOffset);
                focusByRange(saved);
            }
            if (word.startContainer.nodeType === Node.TEXT_NODE) {
                const leadingSpace = word.startContainer.textContent.substring(word.startOffset).match(/^\s+/u);
                if (leadingSpace) {
                    word.setStart(word.startContainer, word.startOffset + leadingSpace[0].length);
                }
            }
            if (word.endContainer.nodeType === Node.TEXT_NODE) {
                const trailingSpace = word.endContainer.textContent.substring(0, word.endOffset).match(/\s+$/u);
                if (trailingSpace) {
                    word.setEnd(word.endContainer, word.endOffset - trailingSpace[0].length);
                }
            }
            if (!word.collapsed && word.toString().trim() && tap.editable.contains(word.startContainer) &&
                tap.editable.contains(word.endContainer) &&
                !Array.from(tap.editable.querySelectorAll(TOUCH_CARET_EXCLUDED + ", [contenteditable='false']"))
                    .some(item => word.intersectsNode(item))) {
                tap.word = word;
                focusByRange(word);
            } else {
                tap.word = false;
            }
        });
    };
    const selectionChange = () => {
        const tap = pendingTap;
        const selection = ownerDocument.getSelection();
        if (frame !== undefined || !tap || tap.word === false || Date.now() - tap.time >= Constants.TIMEOUT_LONGPRESS ||
            !selection?.isCollapsed || selection.rangeCount === 0) {
            return;
        }
        // 原生手势可能在后续事件中再次吸附到词边界，仅在本轮短按内校正迟到的折叠选区。
        if (tap.count === 2 || selection.anchorNode !== tap.range.startContainer ||
            selection.anchorOffset !== tap.range.startOffset) {
            schedule();
        }
    };
    const click = (event: MouseEvent) => {
        if (pendingTap && !composing && canPlaceCaret() && !event.defaultPrevented && event.detail === 1 &&
            Date.now() - pendingTap.time < Constants.TIMEOUT_LONGPRESS &&
            Math.hypot(event.clientX - pendingTap.x, event.clientY - pendingTap.y) < Constants.SIZE_DRAG_THRESHOLD) {
            if (event.target === element && pendingTap.startedUnfocused) {
                // 布局变化使合成点击落到非编辑宿主时，保留最初命中的正文焦点和选区。
                event.preventDefault();
                pendingTap.editable.focus({preventScroll: true});
                const selection = ownerDocument.getSelection();
                if (!selection?.rangeCount || selection.isCollapsed) {
                    focusByRange(pendingTap.word || pendingTap.range);
                }
            }
            // 原生点击晚于首帧到达时，沿用本轮触摸命中的字符位置。
            schedule();
        }
    };
    const focusOut = (event: FocusEvent) => {
        if (event.relatedTarget && !element.contains(event.relatedTarget as Node)) {
            cancel();
        }
    };
    const compositionStart = () => {
        composing = true;
        cancel();
    };
    const compositionEnd = () => {
        composing = false;
    };
    const input = (event: InputEvent) => {
        cancel();
        if (isCommittedTextInput(event)) {
            composing = false;
        }
    };
    const touchStart = (event: TouchEvent) => {
        cancel();
        touchCaret = undefined;
        const target = event.target as HTMLElement;
        if (event.defaultPrevented || event.touches.length !== 1 || composing || !canPlaceCaret() ||
            target.closest(TOUCH_CARET_EXCLUDED)) {
            return;
        }
        const point = {x: event.touches[0].clientX, y: event.touches[0].clientY};
        if (previousTap?.count === 1 && previousTap.startedUnfocused &&
            Date.now() - previousTap.time < Constants.TIMEOUT_LONGPRESS &&
            Math.hypot(point.x - previousTap.x, point.y - previousTap.y) < Constants.SIZE_DRAG_THRESHOLD * 4 &&
            previousTap.range.startContainer.isConnected && element.contains(previousTap.editable)) {
            // 键盘唤起后第二次点击可能命中正文空白，双击仍以第一次按下时的字符为目标。
            touchCaret = {...previousTap, time: Date.now()};
            return;
        }
        const editable = target.closest<HTMLElement>("[contenteditable]");
        if (!editable || editable.getAttribute("contenteditable") !== "true" || !element.contains(editable)) {
            return;
        }
        const range = ownerDocument.caretRangeFromPoint(point.x, point.y);
        const rangeElement = range && (range.startContainer.nodeType === Node.ELEMENT_NODE ?
            range.startContainer as Element : range.startContainer.parentElement);
        if (!rangeElement || rangeElement.closest("[contenteditable]") !== editable ||
            !editable.contains(range.endContainer)) {
            return;
        }
        range.collapse(true);
        // 在键盘唤起和视口调整前记录字符位置，避免用变化后的页面布局再次命中坐标。
        const activeElement = ownerDocument.activeElement;
        const startedUnfocused = !element.contains(activeElement) ||
            (!editable.contains(activeElement) && !activeElement.contains(editable));
        touchCaret = {editable, range, character: getTouchCharacterRange(range, point), startedUnfocused, time: Date.now()};
    };
    const disposeNavigation = bindTouchNavigation(element, (_target, point) => {
        cancel();
        const caret = touchCaret;
        touchCaret = undefined;
        if (!caret || composing || !canPlaceCaret() || !caret.range.startContainer.isConnected ||
            !element.contains(caret.editable)) {
            return;
        }
        const time = Date.now();
        const repeated = previousTap && previousTap.editable === caret.editable &&
            caret.time - previousTap.time < Constants.TIMEOUT_LONGPRESS &&
            Math.hypot(point.x - previousTap.x, point.y - previousTap.y) < Constants.SIZE_DRAG_THRESHOLD * 4;
        previousTap = {...(repeated ? previousTap : caret), time, ...point, count: repeated ? previousTap.count + 1 : 1};
        // 三击及更多次连续点击保留系统的整段选择行为。
        if (previousTap.count > 2) {
            return;
        }
        const activeElement = ownerDocument.activeElement;
        if (!element.contains(activeElement) ||
            (!caret.editable.contains(activeElement) && !activeElement.contains(caret.editable))) {
            caret.editable.focus({preventScroll: true});
            focusByRange(previousTap.range);
        }
        pendingTap = previousTap;
        schedule();
    }, () => !!touchCaret);
    const cancelEvents = ["pointerdown", "touchcancel", "beforeinput", "keydown", "scroll"];
    cancelEvents.forEach(type => element.addEventListener(type, cancel, {capture: true, passive: true}));
    element.addEventListener("touchstart", touchStart, {capture: true, passive: true});
    element.addEventListener("compositionstart", compositionStart);
    element.addEventListener("compositionend", compositionEnd);
    element.addEventListener("input", input);
    element.addEventListener("click", click);
    element.addEventListener("focusout", focusOut);
    ownerDocument.addEventListener("selectionchange", selectionChange);
    return () => {
        cancel();
        disposeNavigation();
        cancelEvents.forEach(type => element.removeEventListener(type, cancel, true));
        element.removeEventListener("touchstart", touchStart, true);
        element.removeEventListener("compositionstart", compositionStart);
        element.removeEventListener("compositionend", compositionEnd);
        element.removeEventListener("input", input);
        element.removeEventListener("click", click);
        element.removeEventListener("focusout", focusOut);
        ownerDocument.removeEventListener("selectionchange", selectionChange);
    };
};
