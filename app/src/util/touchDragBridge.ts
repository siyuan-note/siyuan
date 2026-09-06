import {stopScrollAnimation} from "../boot/globalEvent/dragover";
import {Constants} from "../constants";
import {isInAndroid} from "../plugin/platformUtils";
/// #if !BROWSER
import {ipcRenderer} from "electron";
/// #endif
import {
    completeDrag,
    createDragRefreshQueue,
    dispatchWithNativeDragEnabled,
    getDragRelayTypes,
    getWheelScrollDelta,
    hasActiveTouchGesture,
    isDragRelaySource,
    restoreNativeDrag,
    shouldCancelPointerDragAfterWindowExit,
    shouldRequestForeignMouseDrop,
    shouldRequireLongPress,
    shouldSuppressNativeContextMenu,
    suspendNativeDrag,
} from "./touchDragBridgeCore";

// 长按门槛共享状态：触摸后短时间内滑动视为滚动放行原生滚动，长按静止后再滑动才进入拖拽
interface LongPressGate {
    startX: number;
    startY: number;
    touchStartTime: number;
    requireLongPress: boolean;
    longPressCancelled: boolean;
    // 输入源为鼠标：部分平板 WebView 会把鼠标合成成 touch 事件，鼠标无滚动冲突（滚动走滚轮），跳过时间门槛
    // 仅保留位移门槛以区分点击与拖拽，避免点击 + 号/箭头等操作时因抖动误入拖拽
    isMouse: boolean;
}

// 判定一次滑动是否应放行原生滚动（而非进入拖拽）：位移超阈值且在长按门槛内移动，则标记为滚动
// 返回 true 表示应放行滚动（不拖拽），false 表示可进入拖拽
const shouldYieldToScroll = (gate: LongPressGate, clientX: number, clientY: number): boolean => {
    const dx = clientX - gate.startX;
    const dy = clientY - gate.startY;
    if (Math.abs(dx) < Constants.SIZE_DRAG_THRESHOLD && Math.abs(dy) < Constants.SIZE_DRAG_THRESHOLD) {
        // 位移过小，继续等待长按判定
        return true;
    }
    if (gate.isMouse) {
        // 鼠标无滚动冲突（滚动走滚轮），跳过手指的 400ms 长按门槛
        // 但文件树/画廊/列表操作等元素同一手势既可能点击（+ 号、箭头）也可能拖拽，需短暂时间下限区分
        // 避免点击抖动误触发 dragstart → 文档树加 disablehover → + 号消失、子元素 pointer-events:none
        // 块标等 requireLongPress=false 的元素本就是要拖的，按下即拖，与桌面原生一致
        if (gate.requireLongPress) {
            return Date.now() - gate.touchStartTime < Constants.TIMEOUT_MOUSE_DRAG_DELAY;
        }
        return false;
    }
    if (!gate.requireLongPress) {
        return false;
    }
    if (gate.longPressCancelled) {
        // 已判定为滚动
        return true;
    }
    if (Date.now() - gate.touchStartTime < Constants.TIMEOUT_LONGPRESS) {
        // 短时间内滑动，判定为滚动
        gate.longPressCancelled = true;
        return true;
    }
    return false;
};

interface DragPoint {
    clientX: number;
    clientY: number;
    screenX?: number;
    screenY?: number;
    altKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    sequence?: number;
    shiftKey?: boolean;
}

interface SerializedDataTransferItem {
    type: string;
    data: string;
}

interface BlockDragRelayPayload {
    items: SerializedDataTransferItem[];
    dragTitle: string;
    effectAllowed: DataTransfer["effectAllowed"];
}

interface BlockDragRelayMessage {
    phase: "request" | "route" | "enter" | "move" | "leave" | "drop" | "drop-ack" | "complete" | "end";
    dragId: string;
    canceled?: boolean;
    point?: DragPoint;
    payload?: BlockDragRelayPayload;
    remote?: boolean;
    sequence?: number;
    sourceWebContentsId?: number;
}

const dragRelayMimeTypes = {
    block: Constants.SIYUAN_DROP_BLOCK,
    documents: Constants.SIYUAN_DROP_DOCUMENTS,
    file: Constants.SIYUAN_DROP_FILE,
    gutterPrefix: Constants.SIYUAN_DROP_GUTTER,
};

interface DragState {
    dataTransfer: DataTransfer | null;
    dragEnteredEditor?: HTMLElement;
    ghostElement: HTMLElement | null;
    idleTimeout?: number;
    isDragging: boolean;
    draggableElement: HTMLElement;
    inputType: "touch" | "pointer";
    pointerId?: number;
    lastPoint?: DragPoint;
    relayId?: string;
    relayRemote?: boolean;
    relaySequence?: number;
    pendingDropPoint?: DragPoint;
    pendingDropSequence?: number;
    pendingDropTimeout?: number;
    restoreDraggable?: boolean;
}

interface ForeignDragState {
    dataTransfer: DataTransfer;
    dragId: string;
    dropped: boolean;
    dropRequested: boolean;
    idleTimeout?: number;
    lastDragOverElement: Element | null;
    lastPoint?: DragPoint;
}

interface PendingWheelScroll {
    delta: number;
    element: HTMLElement;
    scrollTop: number;
}

let dragState: (DragState & LongPressGate) | null = null;
let lastDragOverElement: Element | null = null;
let foreignDragState: ForeignDragState | null = null;
let pendingWheelScroll: PendingWheelScroll | null = null;
let dragRelaySequence = 0;
const DRAG_IDLE_TIMEOUT = 30000;

let manualState: (LongPressGate) | null = null;

// 最近一次 pointerdown 的输入源，pointerType 是唯一可靠区分 mouse/touch/pen 的字段
let lastPointerType: string = "";

const copyDragPoint = (point: DragPoint): DragPoint => ({
    clientX: point.clientX,
    clientY: point.clientY,
    screenX: point.screenX,
    screenY: point.screenY,
    altKey: !!point.altKey,
    ctrlKey: !!point.ctrlKey,
    metaKey: !!point.metaKey,
    sequence: point.sequence,
    shiftKey: !!point.shiftKey,
});

// 判定当前输入源是否为鼠标：部分平板 WebView 会把鼠标合成成 touch 事件
// pointerType === "mouse" 且接触面积为 0（radiusX/radiusY 为 0）时判定为鼠标
// radiusX > 0 单向可信：非零一定是真手指，据此否决鼠标判断，避免把手指误判成鼠标跳过长按
// 不用 force（iOS 真手指常报 0）、不用 sourceCapabilities（WebKit 不支持）
const isMouseInput = (touch: Touch): boolean => {
    const hasContactArea = (touch.radiusX ?? 0) > 0 || (touch.radiusY ?? 0) > 0;
    return !hasContactArea && lastPointerType === "mouse";
};

// 最近一次输入源是否为鼠标，供 event.ts 的长按菜单合成判断使用
// 鼠标左键长按不应触发右键菜单（触屏长按出菜单的手势专属逻辑），鼠标的菜单由右键触发
export const isLastPointerMouse = (): boolean => {
    return lastPointerType === "mouse";
};

// 触摸起始：先判断是否命中原生 Drag API（draggable="true"），命中则走原生路径；否则判断手动 mousedown 白名单
const handleTouchStart = (e: TouchEvent) => {
    if (e.touches.length !== 1) return;

    const target = e.target as HTMLElement;
    const touch = e.touches[0];

    // 部分 Android WebView 会在鼠标 Pointer 事件后继续合成 Touch 事件，此时沿用候选状态并切换为 Touch 驱动。
    if (dragState?.inputType === "pointer" && isMouseInput(touch)) {
        dragState.inputType = "touch";
        dragState.startX = touch.clientX;
        dragState.startY = touch.clientY;
        dragState.touchStartTime = Date.now();
        return;
    }
    if (dragState || manualState) return;

    // 原生 Drag 路径：元素有 draggable="true" 祖先（如文件树、列表标记、AV 行拖拽），优先走 Drag API
    if (!target.classList.contains("av__widthdrag") && !target.classList.contains("av__freeze-drag")) {
        const draggable = getDraggableAncestor(target);
        if (draggable) {
            dragState = createDragState(draggable, touch, "touch", isMouseInput(touch));
            // WebKit 会接管 draggable 元素的长按并取消触摸序列，临时关闭原生拖拽以保留 touchend。
            suspendNativeDrag(dragState);
            return;
        }
    }

    // 原生 <select> 下拉层由 WebView 以系统 overlay 绘制，合成 mousedown 会干扰其触摸序列导致下拉层闪退
    // https://github.com/siyuan-note/siyuan/issues/17953
    if (target.tagName === "SELECT" || target.tagName === "OPTION" || target.closest("select")) {
        return;
    }
    // 手动 mousedown 路径：dock / outline / resize 把手等自实现拖拽的区域
    if (!target.closest(".dock") &&
        // 弹窗内不能按整个 .b3-dialog 匹配，否则导致闪卡文本扩选失效 https://github.com/siyuan-note/siyuan/issues/18055
        !(target.closest(".b3-dialog") &&  ["resize__move", "resize__rd", "resize__r", "resize__rt",
            "resize__d", "resize__l", "resize__ld", "resize__lt", "resize__t"].some(cls => target.closest("." + cls))) &&
        !target.closest(".sy__outline") &&
        !target.closest(".layout__resize") &&
        !target.closest(".layout__resize--lr") &&
        !target.closest(".layout__dockresize") &&
        !target.closest(".layout__dockresize--lr") &&
        !target.closest(".search__drag") &&
        // 编辑器内部调整大小的控件不使用原生 Drag API。
        !target.closest(".av__widthdrag") &&
        !target.closest(".av__freeze-drag") &&
        !target.closest(".av__drag-fill") &&
        !target.closest(".protyle-action__drag") &&
        !target.closest(".table__resize") &&
        !target.closest(".sb__resize") &&
        !target.closest(".protyle-background__img") &&
        !target.closest(".b3-chip")) return;

    const mouseEvent = new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
        clientX: touch.clientX,
        clientY: touch.clientY,
        button: 0,
        view: window,
    });
    target.dispatchEvent(mouseEvent);
    manualState = {
        startX: touch.clientX,
        startY: touch.clientY,
        touchStartTime: Date.now(),
        requireLongPress: target.closest(".sy__outline") !== null,
        longPressCancelled: false,
        isMouse: isMouseInput(touch),
    };
};

// 触摸移动：根据 dragState/manualState 谁存在分流到原生 Drag 或手动 mousedown 路径
const handleTouchMove = (e: TouchEvent) => {
    // 原生 Drag 路径
    if (dragState) {
        const touch = e.touches[0];
        if (!dragState.isDragging) {
            // 长按门槛：文件树、画廊、列表标记等触摸后短时间滑动视为滚动，放行原生滚动
            if (shouldYieldToScroll(dragState, touch.clientX, touch.clientY)) {
                return;
            }
            e.preventDefault();
            startBridgeDrag(touch);
            return;
        }
        e.preventDefault();
        continueBridgeDrag(touch);
        return;
    }

    // 手动 mousedown 路径
    if (!manualState) return;
    const touch = e.touches[0];
    if (!document.onmousemove || typeof document.onmousemove !== "function") return;

    // 长按门槛：可滚动列表（如大纲）触摸后短时间滑动视为滚动，放行原生滚动，避免滚动变拖拽
    if (shouldYieldToScroll(manualState, touch.clientX, touch.clientY)) {
        return;
    }

    e.preventDefault();
    // 已进入拖拽：置标记使松手时 event.ts 的长按菜单判定提前返回，避免拖拽与菜单同时触发
    window.siyuan.touchDragActive = true;
    const elementUnderFinger = document.elementFromPoint(touch.clientX, touch.clientY);
    if (elementUnderFinger) {
        elementUnderFinger.dispatchEvent(new MouseEvent("mousemove", {
            clientX: touch.clientX,
            clientY: touch.clientY,
            cancelable: true,
            bubbles: true,
        }));
    }
};

// 触摸结束：原生路径派发 drop/dragend，手动路径派发 mouseup 清理
const handleTouchEnd = (e: TouchEvent) => {
    if (dragState) {
        if (dragState.isDragging) {
            e.preventDefault();
        }
        completeBridgeDrag(e.changedTouches[0], false);
        return;
    }
    if (!manualState) return;
    // 派发 mouseup 触发组件（如 Outline.bindSort）注册的 onmouseup 清理回调，并复位状态
    cancelManualTouch();
};

const handleContextMenu = (event: MouseEvent) => {
    // WebView 会在手指仍按住时派发原生长按菜单，菜单遮罩会截获后续 drop。
    // 松手后由 event.ts 合成的 contextmenu 不是可信事件，需要保留以打开正常的长按菜单。
    if (shouldSuppressNativeContextMenu(event.isTrusted, hasActiveTouchGesture([dragState, manualState]))) {
        event.preventDefault();
        event.stopImmediatePropagation();
    }
};

const getDraggableAncestor = (el: Element): HTMLElement | null => {
    let current: HTMLElement | null = el instanceof HTMLElement ? el : el.parentElement;
    while (current) {
        if (current.getAttribute("draggable") === "true") {
            return current;
        }
        if (current === document.body) break;
        current = current.parentElement;
    }
    return null;
};

const createDragState = (draggableElement: HTMLElement, point: DragPoint, inputType: "touch" | "pointer",
                         isMouse: boolean, pointerId?: number): DragState & LongPressGate => {
    return {
        dataTransfer: null,
        ghostElement: null,
        isDragging: false,
        draggableElement,
        inputType,
        pointerId,
        startX: point.clientX,
        startY: point.clientY,
        touchStartTime: Date.now(),
        // 触摸操作和 Android 外接鼠标在文件树、画廊、页签和列表操作中需长按，以避免与滚动冲突。
        requireLongPress: shouldRequireLongPress(draggableElement.closest(".sy__file") !== null ||
            draggableElement.closest(".sy__outline") !== null ||
            draggableElement.closest(".av__gallery-item") !== null ||
            draggableElement.closest(".av__group-title") !== null ||
            draggableElement.closest(".layout-tab-bar") !== null ||
            draggableElement.closest(".protyle-action") !== null, isMouse, !!isInAndroid()),
        longPressCancelled: false,
        isMouse,
    };
};

let suppressMouseClick = false;
let suppressMouseClickPointerId: number | undefined;
let suppressMouseClickTimeout: number | undefined;

const clearMouseClickSuppression = () => {
    suppressMouseClick = false;
    suppressMouseClickPointerId = undefined;
    if (suppressMouseClickTimeout !== undefined) {
        window.clearTimeout(suppressMouseClickTimeout);
        suppressMouseClickTimeout = undefined;
    }
};

const waitForMouseClickSuppression = (pointerId: number) => {
    suppressMouseClick = false;
    suppressMouseClickPointerId = pointerId;
    if (suppressMouseClickTimeout !== undefined) {
        window.clearTimeout(suppressMouseClickTimeout);
        suppressMouseClickTimeout = undefined;
    }
};

const armMouseClickSuppression = () => {
    suppressMouseClick = true;
    suppressMouseClickPointerId = undefined;
    if (suppressMouseClickTimeout !== undefined) {
        window.clearTimeout(suppressMouseClickTimeout);
    }
    suppressMouseClickTimeout = window.setTimeout(clearMouseClickSuppression);
};

const isDesktopBlockGutter = (draggable: HTMLElement) => {
    const gutterElement = draggable.closest(".protyle-gutters");
    const buttonElement = draggable.parentElement;
    return !!gutterElement && buttonElement?.tagName === "BUTTON" && !buttonElement.dataset.rowId;
};

const isDesktopFileTreeItem = (draggable: HTMLElement) => {
    return draggable.closest(".sy__file") !== null &&
        ["navigation-file", "navigation-root"].includes(draggable.dataset.type);
};

const handlePointerDown = (event: PointerEvent) => {
    if (suppressMouseClick || suppressMouseClickPointerId !== undefined) {
        // 上一次取消发生在窗口失焦等未收到 pointerup 的场景，新一轮按下不应继承点击抑制。
        clearMouseClickSuppression();
    }
    if (event.pointerType !== "mouse" || event.button !== 0 || dragState || manualState ||
        !(event.target instanceof Element) ||
        event.target.closest(".av__widthdrag") || event.target.closest(".av__freeze-drag")) {
        return;
    }

    const draggable = getDraggableAncestor(event.target);
    if (!draggable || (!isInAndroid() && !isDesktopBlockGutter(draggable) &&
        !isDesktopFileTreeItem(draggable))) {
        return;
    }

    dragState = createDragState(draggable, event, "pointer", true, event.pointerId);
    // 原生 dragstart 会取消 Pointer 流，临时关闭 draggable 以保留 pointermove 和 pointerup。
    suspendNativeDrag(dragState);
};

const handlePointerMove = (event: PointerEvent) => {
    if (dragState?.inputType !== "pointer" || dragState.pointerId !== event.pointerId) {
        return;
    }
    if ((event.buttons & 1) === 0) {
        if (dragState.relayId) {
            requestBlockDragDrop(event);
        } else {
            completeBridgeDrag(event, true);
        }
        return;
    }
    if (!dragState.isDragging) {
        if (shouldYieldToScroll(dragState, event.clientX, event.clientY)) {
            return;
        }
        event.preventDefault();
        startBridgeDrag(event);
        return;
    }
    event.preventDefault();
    continueBridgeDrag(event);
};

const handlePointerUp = (event: PointerEvent) => {
    if (suppressMouseClickPointerId === event.pointerId) {
        armMouseClickSuppression();
    }
    if (dragState?.inputType !== "pointer" || dragState.pointerId !== event.pointerId) {
        return;
    }
    const isDragging = dragState.isDragging;
    if (isDragging) {
        event.preventDefault();
    }
    if (isDragging && dragState.relayId) {
        requestBlockDragDrop(event);
    } else {
        completeBridgeDrag(event, false);
    }
    if (isDragging) {
        armMouseClickSuppression();
    }
};

const handlePointerCancel = (event: PointerEvent) => {
    if (dragState?.inputType === "pointer" && dragState.pointerId === event.pointerId) {
        completeBridgeDrag(event, true);
    }
    if (suppressMouseClickPointerId === event.pointerId) {
        clearMouseClickSuppression();
    }
};

const handlePointerLeave = (event: PointerEvent) => {
    if (dragState?.inputType === "pointer" && dragState.pointerId === event.pointerId && !dragState.isDragging) {
        completeBridgeDrag(undefined, true);
    }
};

const handleMouseClick = (event: MouseEvent) => {
    if (suppressMouseClick) {
        event.preventDefault();
        event.stopImmediatePropagation();
        clearMouseClickSuppression();
    }
};

const getElementUnderPoint = (point: DragPoint, ghostElement?: HTMLElement | null): Element | null => {
    if (ghostElement) {
        ghostElement.style.display = "none";
    }
    const element = document.elementFromPoint(point.clientX, point.clientY);
    if (ghostElement) {
        ghostElement.style.display = "";
    }
    return element;
};

const positionGhost = (clientX: number, clientY: number) => {
    if (dragState?.ghostElement) {
        // 将拖拽影像偏移到指针旁边，避免被手指遮挡。
        dragState.ghostElement.style.left = `${clientX + 12}px`;
        dragState.ghostElement.style.top = `${clientY + 12}px`;
    }
};

const clearDragoverClasses = () => {
    document.querySelectorAll(".dragover__top, .dragover__bottom, .dragover__left, .dragover__right, .dragover").forEach((item) => {
        item.classList.remove("dragover__top", "dragover__bottom", "dragover__left", "dragover__right", "dragover");
    });
};

const createBridgeDragEvent = (type: string, point: DragPoint, dataTransfer: DataTransfer, bubbles = true) => {
    return new DragEvent(type, {
        bubbles,
        cancelable: true,
        clientX: point.clientX,
        clientY: point.clientY,
        screenX: point.screenX || 0,
        screenY: point.screenY || 0,
        altKey: !!point.altKey,
        ctrlKey: !!point.ctrlKey,
        metaKey: !!point.metaKey,
        shiftKey: !!point.shiftKey,
        dataTransfer,
        view: window,
    });
};

const dispatchBridgeDragOver = (dataTransfer: DataTransfer, point: DragPoint,
                                  previousElement: Element | null, ghostElement?: HTMLElement | null) => {
    const elementUnderPoint = getElementUnderPoint(point, ghostElement);

    // 仅在目标元素的父容器变化时派发 dragenter 和 dragleave，避免同级元素之间移动时闪烁。
    if (elementUnderPoint !== previousElement) {
        const previousContainer = previousElement?.parentElement;
        const currentContainer = elementUnderPoint?.parentElement;
        if (previousContainer !== currentContainer || (!previousContainer && currentContainer) ||
            (previousContainer && !currentContainer)) {
            previousElement?.dispatchEvent(createBridgeDragEvent("dragleave", point, dataTransfer));
            elementUnderPoint?.dispatchEvent(createBridgeDragEvent("dragenter", point, dataTransfer));
        }
    }

    elementUnderPoint?.dispatchEvent(createBridgeDragEvent("dragover", point, dataTransfer));
    return elementUnderPoint;
};

const serializeDataTransfer = (dataTransfer: DataTransfer): BlockDragRelayPayload => {
    const items = getDragRelayTypes(Array.from(dataTransfer.types), dragRelayMimeTypes)
        .map(type => ({
            type,
            data: dataTransfer.getData(type),
        }));
    return {
        items,
        dragTitle: window.siyuan.dragTitle || "",
        effectAllowed: dataTransfer.effectAllowed,
    };
};

const sendBlockDragRelay = (data: object) => {
    /// #if !BROWSER
    ipcRenderer.send(Constants.SIYUAN_BLOCK_DRAG, data);
    /// #endif
};

const isClearlyInsideWindow = (point: DragPoint) => point.clientX > 1 && point.clientY > 1 &&
    point.clientX < window.innerWidth - 1 && point.clientY < window.innerHeight - 1;

const sendBlockDragRelayMove = (point: DragPoint) => {
    if (!dragState?.relayId || dragState.pendingDropPoint) {
        return;
    }
    if (isClearlyInsideWindow(point)) {
        dragState.relayRemote = false;
    }
    dragState.relaySequence = (dragState.relaySequence || 0) + 1;
    const relayPoint = copyDragPoint(point);
    relayPoint.sequence = dragState.relaySequence;
    sendBlockDragRelay({
        phase: "move",
        dragId: dragState.relayId,
        point: relayPoint,
    });
};

const requestBlockDragDrop = (point: DragPoint) => {
    if (!dragState?.relayId || !dragState.dataTransfer || dragState.pendingDropPoint) {
        return;
    }
    dragState.relaySequence = (dragState.relaySequence || 0) + 1;
    const relayPoint = copyDragPoint(point);
    relayPoint.sequence = dragState.relaySequence;
    dragState.pendingDropPoint = copyDragPoint(point);
    dragState.pendingDropSequence = relayPoint.sequence;
    sendBlockDragRelay({
        phase: "drop",
        dragId: dragState.relayId,
        point: relayPoint,
    });
    dragState.pendingDropTimeout = window.setTimeout(() => {
        if (!dragState?.pendingDropPoint || dragState.pendingDropSequence !== relayPoint.sequence) {
            return;
        }
        const pendingPoint = dragState.pendingDropPoint;
        // 主进程未确认落点时不在源窗口补发 drop，避免目标已处理但回执延迟导致重复移动。
        completeBridgeDrag(pendingPoint, false, true);
    }, Constants.TIMEOUT_LOAD);
};

const startBridgeDrag = (point: DragPoint) => {
    if (!dragState) {
        return;
    }
    const dt = new DataTransfer();
    dragState.dataTransfer = dt;
    dragState.isDragging = true;
    dragState.lastPoint = copyDragPoint(point);

    if (dragState.inputType === "pointer" && dragState.pointerId !== undefined) {
        try {
            dragState.draggableElement.setPointerCapture(dragState.pointerId);
        } catch {
            // 指针可能已由系统取消，此时后续 Pointer 事件会负责清理。
        }
    }

    const closestEditorElement = dragState.draggableElement.closest(".protyle-wysiwyg") as HTMLElement;
    dragState.dragEnteredEditor = closestEditorElement ||
        dragState.draggableElement.closest(".protyle")?.querySelector<HTMLElement>(".protyle-wysiwyg");

    window.siyuan.touchDragActive = true;
    window.siyuan.touchDragGhost = null;

    const dragStartEvent = createBridgeDragEvent("dragstart", point, dt);
    // 部分拖拽处理会在 dragstart 中再次检查 draggable 属性，派发合成事件时短暂恢复。
    dispatchWithNativeDragEnabled(dragState, () => dragState.draggableElement.dispatchEvent(dragStartEvent));

    dragState.ghostElement = window.siyuan.touchDragGhost || null;
    if (dragState.ghostElement) {
        dragState.ghostElement.style.pointerEvents = "none";
        dragState.ghostElement.style.zIndex = (++window.siyuan.zIndex).toString();
        // 先定位再显示，避免拖拽影像在错误位置闪现。
        positionGhost(point.clientX, point.clientY);
        dragState.ghostElement.style.opacity = "0.6";
    }

    if (closestEditorElement) {
        closestEditorElement.dispatchEvent(createBridgeDragEvent("dragenter", point, dt, false));
    }

    /// #if !BROWSER
    if (dragState.inputType === "pointer" &&
        isDragRelaySource(Array.from(dt.types), dragRelayMimeTypes)) {
        dragState.relayId = `${Date.now()}-${++dragRelaySequence}`;
        sendBlockDragRelay({phase: "begin", dragId: dragState.relayId});
        sendBlockDragRelayMove(point);
    }
    /// #endif
    resetLocalDragIdleTimeout();
};

const continueBridgeDrag = (point: DragPoint, relay = true) => {
    if (!dragState?.isDragging || !dragState.dataTransfer) {
        return;
    }

    dragState.lastPoint = copyDragPoint(point);
    resetLocalDragIdleTimeout();
    lastDragOverElement = dispatchBridgeDragOver(
        dragState.dataTransfer,
        dragState.lastPoint,
        lastDragOverElement,
        dragState.ghostElement,
    );
    positionGhost(point.clientX, point.clientY);
    if (relay) {
        sendBlockDragRelayMove(point);
    }
};

const dispatchBridgeDrop = (point: DragPoint) => {
    if (!dragState?.isDragging || !dragState.dataTransfer) return;

    const elementUnderPoint = getElementUnderPoint(point, dragState.ghostElement);
    elementUnderPoint?.dispatchEvent(createBridgeDragEvent("drop", point, dragState.dataTransfer));
};

const dispatchBridgeDragEnd = (point?: DragPoint) => {
    if (!dragState?.isDragging || !dragState.dataTransfer) return;

    const dragEndPoint = point || dragState.lastPoint || {clientX: dragState.startX, clientY: dragState.startY};
    const dragEndEvent = createBridgeDragEvent("dragend", dragEndPoint, dragState.dataTransfer);
    if (dragState.dragEnteredEditor && !dragState.dragEnteredEditor.contains(dragState.draggableElement)) {
        dragState.dragEnteredEditor.dispatchEvent(createBridgeDragEvent("dragend", dragEndPoint,
            dragState.dataTransfer, false));
    }
    dragState.draggableElement.dispatchEvent(dragEndEvent);
};

const completeBridgeDrag = (point: DragPoint | undefined, canceled: boolean, remoteDrop = false) => {
    const relayId = dragState?.relayId;
    if (canceled && dragState?.inputType === "pointer" && dragState.isDragging &&
        dragState.pointerId !== undefined) {
        waitForMouseClickSuppression(dragState.pointerId);
    }
    if (dragState?.pendingDropTimeout) {
        window.clearTimeout(dragState.pendingDropTimeout);
    }
    if ((canceled || remoteDrop) && dragState?.dataTransfer && dragState.lastPoint && lastDragOverElement) {
        lastDragOverElement.dispatchEvent(createBridgeDragEvent("dragleave", dragState.lastPoint,
            dragState.dataTransfer));
        lastDragOverElement = null;
    }
    completeDrag(!!dragState?.isDragging, canceled, {
        drop: () => {
            if (point && !remoteDrop) {
                continueBridgeDrag(point, false);
                dispatchBridgeDrop(point);
            }
        },
        dragEnd: () => dispatchBridgeDragEnd(point),
        cleanup: cleanupDrag,
    });
    if (relayId) {
        sendBlockDragRelay({phase: "end", dragId: relayId});
    }
};

const cleanupDrag = () => {
    const completedState = dragState;
    dragState = null;
    stopScrollAnimation();
    clearDragoverClasses();
    dragRefreshQueue.cancel();
    pendingWheelScroll = null;
    stopScrollAfterRefresh = false;

    if (completedState?.idleTimeout) {
        window.clearTimeout(completedState.idleTimeout);
    }
    restoreNativeDrag(completedState);
    if (completedState?.pointerId !== undefined) {
        try {
            if (completedState.draggableElement.hasPointerCapture(completedState.pointerId)) {
                completedState.draggableElement.releasePointerCapture(completedState.pointerId);
            }
        } catch {
            // Pointer 流可能已由系统取消，此时无需再次释放。
        }
    }
    if (completedState?.ghostElement) {
        completedState.ghostElement.remove();
    }

    window.siyuan.touchDragActive = false;
    window.siyuan.touchDragGhost = null;
    lastDragOverElement = null;
};

const resetLocalDragIdleTimeout = () => {
    const currentState = dragState;
    if (!currentState?.isDragging) {
        return;
    }
    if (currentState.idleTimeout) {
        window.clearTimeout(currentState.idleTimeout);
    }
    currentState.idleTimeout = window.setTimeout(() => {
        if (dragState === currentState) {
            completeBridgeDrag(undefined, true);
        }
    }, DRAG_IDLE_TIMEOUT);
};

const createForeignDataTransfer = (payload?: BlockDragRelayPayload) => {
    if (!payload || !Array.isArray(payload.items)) {
        return;
    }
    const dataTransfer = new DataTransfer();
    const relayTypes = getDragRelayTypes(payload.items.map(item => item?.type).filter(type => typeof type === "string"),
        dragRelayMimeTypes);
    payload.items.forEach(item => {
        if (typeof item?.type === "string" && typeof item.data === "string" && relayTypes.includes(item.type)) {
            dataTransfer.setData(item.type, item.data);
        }
    });
    if (!isDragRelaySource(Array.from(dataTransfer.types), dragRelayMimeTypes)) {
        return;
    }
    try {
        dataTransfer.effectAllowed = payload.effectAllowed;
    } catch {
        // 部分 WebView 不允许在合成拖拽上设置 effectAllowed。
    }
    return dataTransfer;
};

const cleanupForeignDrag = (type: "leave" | "end", point?: DragPoint) => {
    if (!foreignDragState) {
        return;
    }
    const dragPoint = point || foreignDragState.lastPoint || {clientX: 0, clientY: 0};
    const target = (foreignDragState.lastDragOverElement?.isConnected ? foreignDragState.lastDragOverElement :
        getElementUnderPoint(dragPoint)) || document.body;
    if (type === "leave" || !foreignDragState.dropped) {
        target.dispatchEvent(createBridgeDragEvent("dragleave", dragPoint, foreignDragState.dataTransfer));
    }
    target.dispatchEvent(createBridgeDragEvent("dragend", dragPoint, foreignDragState.dataTransfer));
    if (foreignDragState.idleTimeout) {
        window.clearTimeout(foreignDragState.idleTimeout);
    }
    stopScrollAnimation();
    clearDragoverClasses();
    dragRefreshQueue.cancel();
    pendingWheelScroll = null;
    stopScrollAfterRefresh = false;
    window.siyuan.dragTitle = "";
    foreignDragState = null;
};

const resetForeignDragIdleTimeout = () => {
    const currentState = foreignDragState;
    if (!currentState) {
        return;
    }
    if (currentState.idleTimeout) {
        window.clearTimeout(currentState.idleTimeout);
    }
    currentState.idleTimeout = window.setTimeout(() => {
        if (foreignDragState === currentState) {
            cleanupForeignDrag("end");
        }
    }, DRAG_IDLE_TIMEOUT);
};

const handleBlockDragRelay = (message: BlockDragRelayMessage) => {
    if (!message || typeof message.dragId !== "string") {
        return;
    }
    if (message.phase === "request") {
        if (dragState?.relayId === message.dragId && dragState.dataTransfer) {
            sendBlockDragRelay({
                phase: "payload",
                dragId: message.dragId,
                payload: serializeDataTransfer(dragState.dataTransfer),
            });
        }
        return;
    }
    if (message.phase === "route") {
        if (dragState?.relayId === message.dragId && dragState.pendingDropPoint &&
            message.sequence === dragState.pendingDropSequence) {
            dragState.relayRemote = !!message.remote;
            const pendingPoint = dragState.pendingDropPoint;
            completeBridgeDrag(pendingPoint, false, !!message.remote);
        } else if (dragState?.relayId === message.dragId && !dragState.pendingDropPoint &&
            message.sequence === dragState.relaySequence) {
            dragState.relayRemote = !!message.remote;
        }
        return;
    }
    if (message.phase === "complete") {
        if (dragState?.relayId === message.dragId) {
            completeBridgeDrag(undefined, !!message.canceled, !!message.remote);
        }
        return;
    }
    if (message.phase === "enter") {
        const dataTransfer = createForeignDataTransfer(message.payload);
        if (!dataTransfer) {
            return;
        }
        if (foreignDragState) {
            cleanupForeignDrag("end");
        }
        window.siyuan.dragElement = undefined;
        window.siyuan.dragTitle = message.payload.dragTitle || "";
        foreignDragState = {
            dataTransfer,
            dragId: message.dragId,
            dropped: false,
            dropRequested: false,
            lastDragOverElement: null,
        };
        resetForeignDragIdleTimeout();
    }
    if (!foreignDragState || foreignDragState.dragId !== message.dragId) {
        return;
    }
    if (message.phase === "move" && message.point) {
        resetForeignDragIdleTimeout();
        foreignDragState.lastPoint = copyDragPoint(message.point);
        foreignDragState.lastDragOverElement = dispatchBridgeDragOver(
            foreignDragState.dataTransfer,
            foreignDragState.lastPoint,
            foreignDragState.lastDragOverElement,
        );
    } else if (message.phase === "leave") {
        cleanupForeignDrag("leave", message.point);
    } else if (message.phase === "drop" && message.point) {
        resetForeignDragIdleTimeout();
        foreignDragState.lastPoint = copyDragPoint(message.point);
        foreignDragState.lastDragOverElement = dispatchBridgeDragOver(
            foreignDragState.dataTransfer,
            foreignDragState.lastPoint,
            foreignDragState.lastDragOverElement,
        );
        const target = getElementUnderPoint(foreignDragState.lastPoint);
        target?.dispatchEvent(createBridgeDragEvent("drop", foreignDragState.lastPoint,
            foreignDragState.dataTransfer));
        foreignDragState.dropped = !!target;
        if (message.sourceWebContentsId !== undefined && message.sequence !== undefined) {
            sendBlockDragRelay({
                phase: "drop-ack",
                dragId: message.dragId,
                sequence: message.sequence,
                sourceWebContentsId: message.sourceWebContentsId,
            });
        }
    } else if (message.phase === "end") {
        cleanupForeignDrag("end", message.point);
    }
};

const handleForeignMouseUp = (event: MouseEvent) => {
    if (!shouldRequestForeignMouseDrop(!!isInAndroid(), event.button, !!foreignDragState,
        !!foreignDragState?.dropRequested)) {
        return;
    }
    foreignDragState.dropRequested = true;
    sendBlockDragRelay({
        phase: "release",
        point: copyDragPoint(event),
    });
};

let stopScrollAfterRefresh = false;
const dragRefreshQueue = createDragRefreshQueue(() => {
    if (pendingWheelScroll) {
        const wheelScroll = pendingWheelScroll;
        pendingWheelScroll = null;
        if (wheelScroll.element.isConnected && wheelScroll.element.scrollTop === wheelScroll.scrollTop) {
            wheelScroll.element.scrollTop += wheelScroll.delta;
        }
    }
    if (dragState?.isDragging && dragState.lastPoint) {
        continueBridgeDrag(dragState.lastPoint, false);
    }
    if (foreignDragState?.lastPoint) {
        foreignDragState.lastDragOverElement = dispatchBridgeDragOver(
            foreignDragState.dataTransfer,
            foreignDragState.lastPoint,
            foreignDragState.lastDragOverElement,
        );
    }
    if (stopScrollAfterRefresh) {
        stopScrollAfterRefresh = false;
        stopScrollAnimation();
    }
}, callback => window.requestAnimationFrame(callback), handle => window.cancelAnimationFrame(handle));

export const refreshSyntheticDragTarget = () => {
    if (dragState?.isDragging || foreignDragState) {
        dragRefreshQueue.schedule();
    }
};

const handleDragWheel = (event: WheelEvent) => {
    if (!dragState?.isDragging && !foreignDragState) {
        return;
    }
    stopScrollAfterRefresh = true;
    stopScrollAnimation();
    const hitElement = getElementUnderPoint(event, dragState?.ghostElement);
    const fileTreeElement = hitElement?.closest(".sy__file");
    const scrollElement = fileTreeElement?.querySelector<HTMLElement>(":scope > .fn__flex-1");
    if (scrollElement && event.deltaY !== 0) {
        const lineHeight = Number.parseFloat(getComputedStyle(scrollElement).lineHeight) || 30;
        const delta = getWheelScrollDelta(event.deltaY, event.deltaMode, lineHeight, scrollElement.clientHeight);
        if (pendingWheelScroll?.element === scrollElement) {
            pendingWheelScroll.delta += delta;
        } else {
            pendingWheelScroll = {
                delta,
                element: scrollElement,
                scrollTop: scrollElement.scrollTop,
            };
        }
    }
    resetLocalDragIdleTimeout();
    resetForeignDragIdleTimeout();
    dragRefreshQueue.schedule();
};

const handleDragScroll = () => {
    refreshSyntheticDragTarget();
};

const handleDragKey = (event: KeyboardEvent) => {
    if (!dragState?.isDragging || !dragState.lastPoint) {
        return;
    }
    event.preventDefault();
    if (!["Alt", "Control", "Meta", "Shift"].includes(event.key)) {
        event.stopImmediatePropagation();
    }
    if (dragState.pendingDropPoint) {
        return;
    }
    if (event.type === "keydown" && event.key === "Escape") {
        completeBridgeDrag(undefined, true);
        return;
    }
    dragState.lastPoint.altKey = event.altKey;
    dragState.lastPoint.ctrlKey = event.ctrlKey;
    dragState.lastPoint.metaKey = event.metaKey;
    dragState.lastPoint.shiftKey = event.shiftKey;
    resetLocalDragIdleTimeout();
    sendBlockDragRelayMove(dragState.lastPoint);
    dragRefreshQueue.schedule();
};

const handleLostPointerCapture = (event: PointerEvent) => {
    if (dragState?.inputType === "pointer" && dragState.pointerId === event.pointerId &&
        !dragState.pendingDropPoint &&
        shouldCancelPointerDragAfterWindowExit(!!isInAndroid(), dragState.isDragging, !!dragState.relayId)) {
        completeBridgeDrag(undefined, true);
    }
};

const handleVisibilityChange = () => {
    if (!document.hidden) {
        return;
    }
    completeBridgeDrag(undefined, true);
    cleanupForeignDrag("end");
};

const handleCancel = () => {
    // touchcancel 时两条路径都需无条件清理（cleanupDrag/cancelManualTouch 内部均做空状态处理）
    completeBridgeDrag(undefined, true);
    cancelManualTouch();
};

// 取消手动桥接（mousedown）路径：派发 mouseup 以触发各组件注册的清理回调（如 Outline.bindSort 的 mouseup 会清空 document.onmousemove 等），并复位状态
// event.ts 的 touchend 会无条件前置调用它，确保 Outline.bindSort 等注册的 onmousemove/onmouseup 不残留，避免被后续事件误触发（创建拖拽 ghost、启动滚动动画等）
export const cancelManualTouch = () => {
    if (manualState && document.onmouseup && typeof document.onmouseup === "function") {
        document.onmouseup(new MouseEvent("mouseup", {bubbles: true}));
    }
    manualState = null;
    window.siyuan.touchDragActive = false;
};

let bridgeInitialized = false;

export const initTouchDragBridge = () => {
    if (bridgeInitialized) {
        return;
    }
    bridgeInitialized = true;

    // 所有平台都需记录输入源，供 Touch 回调识别鼠标合成事件。
    document.addEventListener("pointerdown", (event: PointerEvent) => {
        lastPointerType = event.pointerType;
    }, {capture: true, passive: true});

    let enablePointerBridge = !!isInAndroid();
    /// #if !BROWSER
    enablePointerBridge = true;
    ipcRenderer.on(Constants.SIYUAN_BLOCK_DRAG, (event, message: BlockDragRelayMessage) => {
        handleBlockDragRelay(message);
    });
    /// #endif
    if (enablePointerBridge) {
        // Android 外接鼠标、桌面普通块标和文档树由 Pointer 路径驱动，避免原生 dragstart 取消事件流。
        document.addEventListener("pointerdown", handlePointerDown, {capture: true, passive: true});
        document.addEventListener("pointermove", handlePointerMove, {capture: true, passive: false});
        document.addEventListener("pointerup", handlePointerUp, {capture: true, passive: false});
        document.addEventListener("pointercancel", handlePointerCancel, {capture: true, passive: true});
        document.documentElement.addEventListener("pointerleave", handlePointerLeave, {passive: true});
        document.addEventListener("lostpointercapture", handleLostPointerCapture, {capture: true, passive: true});
        document.addEventListener("click", handleMouseClick, {capture: true, passive: false});
        document.addEventListener("mouseup", handleForeignMouseUp, {capture: true, passive: true});
        window.addEventListener("blur", () => {
            if (dragState?.inputType === "pointer" &&
                shouldCancelPointerDragAfterWindowExit(!!isInAndroid(), dragState.isDragging,
                    !!dragState.relayId)) {
                completeBridgeDrag(undefined, true);
            }
        });
    }

    document.addEventListener("wheel", handleDragWheel, {capture: true, passive: true});
    document.addEventListener("scroll", handleDragScroll, {capture: true, passive: true});
    document.addEventListener("keydown", handleDragKey, {capture: true});
    document.addEventListener("keyup", handleDragKey, {capture: true});
    document.addEventListener("visibilitychange", handleVisibilityChange);

    // 触摸事件桥接：原生 Drag API（draggable="true"）与手动 mousedown 拖拽（dock/outline/resize 把手）统一入口
    document.addEventListener("touchstart", handleTouchStart, {passive: false});
    document.addEventListener("touchmove", handleTouchMove, {passive: false});
    document.addEventListener("touchend", handleTouchEnd);
    document.addEventListener("touchcancel", handleCancel);
    document.addEventListener("contextmenu", handleContextMenu, {capture: true});
};
