import {Constants} from "../../constants";
import {focusByRange} from "../util/selectionOffsets";
import {isCommittedTextInput} from "./compositionInput";
import {bindTouchNavigation} from "./touchNavigation";
import {bindNativeTextMenu, requestNativeTextMenu} from "./nativeTextMenu";

const TOUCH_CARET_EXCLUDED = "input, textarea, select, button, a, img, audio, video, iframe, " +
    ".protyle-action, .protyle-attr, .av, .protyle-custom, [data-prevent-swipe], " +
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

export const bindIOSTouchCaret = (element: HTMLElement, canPlaceCaret: () => boolean,
                                 onTap?: (target: HTMLElement, point: {x: number, y: number}) => boolean) => {
    const ownerDocument = element.ownerDocument;
    const ownerWindow = ownerDocument.defaultView;
    const disposeNativeMenu = bindNativeTextMenu(element);
    let frame: number;
    let composing = false;
    let touchCaret: {editable: HTMLElement, range: Range, character?: Range, startedUnfocused: boolean,
        time: number, touchTime: number, selection?: Range};
    let previousTap: typeof touchCaret & {x: number, y: number, count: number, word?: Range | false, canceled?: boolean};
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
            const range = selection?.rangeCount > 0 ? selection.getRangeAt(0) : undefined;
            // 只替换双击前未更新且不包含目标字符的旧选区，保留系统已经完成的新文字选择。
            const staleSelection = tap.count === 2 && tap.selection && range && !range.collapsed &&
                range.startContainer === tap.selection.startContainer && range.startOffset === tap.selection.startOffset &&
                range.endContainer === tap.selection.endContainer && range.endOffset === tap.selection.endOffset &&
                tap.character && !(range.isPointInRange(tap.character.startContainer, tap.character.startOffset) &&
                    range.isPointInRange(tap.character.endContainer, tap.character.endOffset));
            const activeInEditable = element.contains(activeElement) &&
                (tap.editable.contains(activeElement) || activeElement.contains(tap.editable));
            if (tap.count === 2 && !composing && canPlaceCaret() && activeInEditable && range &&
                !range.collapsed && !staleSelection && tap.editable.contains(range.startContainer) &&
                tap.editable.contains(range.endContainer)) {
                requestNativeTextMenu(element, range);
            }
            if (composing || !canPlaceCaret() || !tap.range.startContainer.isConnected ||
                !tap.editable.isContentEditable ||
                (!activeInEditable && !(tap.count === 2 &&
                    (activeElement === ownerDocument.body || element.contains(activeElement)))) ||
                (!selection?.isCollapsed && !staleSelection) || selection.rangeCount === 0 ||
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
            if (!activeInEditable) {
                tap.editable.focus({preventScroll: true});
            }
            if (tap.word) {
                focusByRange(tap.word);
                requestNativeTextMenu(element, tap.word);
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
                requestNativeTextMenu(element, word);
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
    const doubleClick = (event: MouseEvent) => {
        const tap = previousTap;
        if (event.defaultPrevented || composing || !canPlaceCaret() || !tap || tap.count > 2 ||
            Date.now() - tap.time >= Constants.TIMEOUT_LONGPRESS ||
            Math.hypot(event.clientX - tap.x, event.clientY - tap.y) >= Constants.SIZE_DRAG_THRESHOLD * 4 ||
            !tap.range.startContainer.isConnected || !element.contains(tap.editable) ||
            (event.target as HTMLElement).closest(TOUCH_CARET_EXCLUDED)) {
            return;
        }
        // 原生双击可能取消第二次触摸或在键盘滚动后送达，沿用首次命中的正文补全选词。
        previousTap = {...tap, count: 2};
        pendingTap = previousTap;
        schedule();
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
    const rememberTouchStart = (point: {x: number, y: number}) => {
        const repeated = previousTap && !previousTap.canceled && previousTap.editable === touchCaret.editable &&
            touchCaret.touchTime - previousTap.touchTime >= 0 &&
            touchCaret.touchTime - previousTap.touchTime < Constants.TIMEOUT_LONGPRESS &&
            Math.hypot(point.x - previousTap.x, point.y - previousTap.y) < Constants.SIZE_DRAG_THRESHOLD * 4;
        previousTap = {...(repeated ? previousTap : touchCaret), ...point, time: Date.now(),
            touchTime: touchCaret.touchTime, count: repeated ? previousTap.count + 1 : 1};
        // 按下时记录连续点击，原生手势缺少任一次 touchend 时仍能识别双击。
        if (previousTap.count === 2) {
            pendingTap = previousTap;
            schedule();
        }
    };
    const touchStart = (event: TouchEvent) => {
        cancel();
        touchCaret = undefined;
        const target = event.target as HTMLElement;
        if (event.defaultPrevented || event.touches.length !== 1 || composing || !canPlaceCaret() ||
            target.closest(TOUCH_CARET_EXCLUDED)) {
            if (previousTap) {
                previousTap.canceled = true;
            }
            return;
        }
        const point = {x: event.touches[0].clientX, y: event.touches[0].clientY};
        const touchTime = Number.isFinite(event.timeStamp) ? event.timeStamp : Date.now();
        if (previousTap?.count === 1 && !previousTap.canceled && previousTap.startedUnfocused &&
            touchTime - previousTap.touchTime >= 0 &&
            touchTime - previousTap.touchTime < Constants.TIMEOUT_LONGPRESS &&
            Math.hypot(point.x - previousTap.x, point.y - previousTap.y) < Constants.SIZE_DRAG_THRESHOLD * 4 &&
            previousTap.range.startContainer.isConnected && element.contains(previousTap.editable)) {
            // 键盘唤起后第二次点击可能命中正文空白，双击仍以第一次按下时的字符为目标。
            touchCaret = {...previousTap, time: Date.now(), touchTime};
            rememberTouchStart(point);
            return;
        }
        const editable = target.closest<HTMLElement>("[contenteditable]");
        if (!editable || editable.getAttribute("contenteditable") !== "true" ||
            editable.closest(".protyle-wysiwyg") !== element) {
            return;
        }
        let range = ownerDocument.caretRangeFromPoint(point.x, point.y);
        const cell = target.closest("td, th");
        if (cell && element.contains(cell) && (!range || !cell.contains(range.startContainer))) {
            // 窄单元格和空单元格的坐标可能命中相邻格，保留本次实际点击的单元格。
            range = ownerDocument.createRange();
            range.selectNodeContents(cell);
            range.collapse(true);
        }
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
        const selection = ownerDocument.getSelection();
        const savedSelection = selection?.rangeCount > 0 && !selection.isCollapsed &&
            element.contains(selection.anchorNode) && element.contains(selection.focusNode) ?
            selection.getRangeAt(0).cloneRange() : undefined;
        touchCaret = {editable, range, character: getTouchCharacterRange(range, point),
            startedUnfocused, time: Date.now(), touchTime, selection: savedSelection};
        rememberTouchStart(point);
    };
    const disposeNavigation = bindTouchNavigation(element, (target, point) => {
        cancel();
        const caret = touchCaret;
        touchCaret = undefined;
        if (!caret || composing || !canPlaceCaret() || !caret.range.startContainer.isConnected ||
            !element.contains(caret.editable)) {
            return;
        }
        if (onTap?.(target, point)) {
            return true;
        }
        previousTap.time = Date.now();
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
    const cancelGesture = () => {
        cancel();
        touchCaret = undefined;
        if (previousTap) {
            previousTap.canceled = true;
        }
    };
    const touchMove = (event: TouchEvent) => {
        if (event.touches.length !== 1 || (previousTap &&
            Math.hypot(event.touches[0].clientX - previousTap.x, event.touches[0].clientY - previousTap.y) >=
                Constants.SIZE_DRAG_THRESHOLD)) {
            cancelGesture();
        }
    };
    const cancelEvents = ["touchcancel", "beforeinput", "keydown", "scroll"];
    cancelEvents.forEach(type => element.addEventListener(type, cancelGesture, {capture: true, passive: true}));
    element.addEventListener("pointerdown", cancel, {capture: true, passive: true});
    element.addEventListener("touchmove", touchMove, {capture: true, passive: true});
    element.addEventListener("touchstart", touchStart, {capture: true, passive: true});
    element.addEventListener("compositionstart", compositionStart);
    element.addEventListener("compositionend", compositionEnd);
    element.addEventListener("input", input);
    element.addEventListener("click", click);
    element.addEventListener("dblclick", doubleClick);
    element.addEventListener("focusout", focusOut);
    ownerDocument.addEventListener("selectionchange", selectionChange);
    return () => {
        cancel();
        disposeNativeMenu();
        disposeNavigation();
        cancelEvents.forEach(type => element.removeEventListener(type, cancelGesture, true));
        element.removeEventListener("pointerdown", cancel, true);
        element.removeEventListener("touchmove", touchMove, true);
        element.removeEventListener("touchstart", touchStart, true);
        element.removeEventListener("compositionstart", compositionStart);
        element.removeEventListener("compositionend", compositionEnd);
        element.removeEventListener("input", input);
        element.removeEventListener("click", click);
        element.removeEventListener("dblclick", doubleClick);
        element.removeEventListener("focusout", focusOut);
        ownerDocument.removeEventListener("selectionchange", selectionChange);
    };
};
