import {stopScrollAnimation} from "../boot/globalEvent/dragover";
import {Constants} from "../constants";
import {isInAndroid} from "../plugin/platformUtils";

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
}

interface DragState {
    dataTransfer: DataTransfer | null;
    ghostElement: HTMLElement | null;
    isDragging: boolean;
    draggableElement: HTMLElement;
    inputType: "touch" | "pointer";
    pointerId?: number;
    restoreDraggable?: boolean;
}

let dragState: (DragState & LongPressGate) | null = null;
let lastDragOverElement: Element | null = null;

let manualState: (LongPressGate) | null = null;

// 最近一次 pointerdown 的输入源，pointerType 是唯一可靠区分 mouse/touch/pen 的字段
let lastPointerType: string = "";

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
        dragState.requireLongPress = requiresLongPress(dragState.draggableElement);
        return;
    }
    if (dragState || manualState) return;

    // 原生 Drag 路径：元素有 draggable="true" 祖先（如文件树、列表标记、AV 行拖拽），优先走 Drag API
    if (!target.classList.contains("av__widthdrag")) {
        const draggable = getDraggableAncestor(target);
        if (draggable) {
            dragState = createDragState(draggable, touch, "touch", isMouseInput(touch));
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
            endBridgeDrag(e.changedTouches[0]);
        }
        cleanupDrag();
        return;
    }
    if (!manualState) return;
    // 派发 mouseup 触发组件（如 Outline.bindSort）注册的 onmouseup 清理回调，并复位状态
    cancelManualTouch();
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

const requiresLongPress = (draggableElement: HTMLElement) => {
    return draggableElement.closest(".sy__file") !== null ||
        draggableElement.closest(".sy__outline") !== null ||
        draggableElement.closest(".av__gallery-item") !== null ||
        draggableElement.closest(".layout-tab-bar") !== null ||
        draggableElement.closest(".protyle-action") !== null;
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
        // Touch 操作文件树、画廊、页签和列表时需长按，以避免与滚动冲突；Pointer 鼠标仅使用位移门槛。
        requireLongPress: inputType === "touch" && requiresLongPress(draggableElement),
        longPressCancelled: false,
        isMouse,
    };
};

let suppressMouseClick = false;

const handlePointerDown = (event: PointerEvent) => {
    if (event.pointerType !== "mouse" || event.button !== 0 || dragState || manualState ||
        !(event.target instanceof Element) || event.target.closest(".av__widthdrag")) {
        return;
    }

    const draggable = getDraggableAncestor(event.target);
    if (!draggable) {
        return;
    }

    dragState = createDragState(draggable, event, "pointer", true, event.pointerId);
    // Android WebView 会在原生 dragstart 后取消 Pointer 流，临时关闭 draggable 以保留 pointermove 和 pointerup。
    draggable.setAttribute("draggable", "false");
    dragState.restoreDraggable = true;
};

const handlePointerMove = (event: PointerEvent) => {
    if (dragState?.inputType !== "pointer" || dragState.pointerId !== event.pointerId) {
        return;
    }
    if ((event.buttons & 1) === 0) {
        cleanupDrag();
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
    if (dragState?.inputType !== "pointer" || dragState.pointerId !== event.pointerId) {
        return;
    }
    const isDragging = dragState.isDragging;
    if (isDragging) {
        event.preventDefault();
        endBridgeDrag(event);
    }
    cleanupDrag();
    if (isDragging) {
        suppressMouseClick = true;
        setTimeout(() => {
            suppressMouseClick = false;
        });
    }
};

const handlePointerCancel = (event: PointerEvent) => {
    if (dragState?.inputType === "pointer" && dragState.pointerId === event.pointerId) {
        cleanupDrag();
    }
};

const handleMouseClick = (event: MouseEvent) => {
    if (suppressMouseClick) {
        event.preventDefault();
        event.stopImmediatePropagation();
        suppressMouseClick = false;
    }
};

const getElementUnderPoint = (clientX: number, clientY: number): Element | null => {
    if (dragState?.ghostElement) {
        dragState.ghostElement.style.display = "none";
    }
    const el = document.elementFromPoint(clientX, clientY);
    if (dragState?.ghostElement) {
        dragState.ghostElement.style.display = "";
    }
    return el;
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

const startBridgeDrag = (touch: DragPoint) => {
    const dt = new DataTransfer();
    dragState.dataTransfer = dt;
    dragState.isDragging = true;

    const editorElement = dragState.draggableElement.closest(".protyle-wysiwyg") as HTMLElement;

    window.siyuan.touchDragActive = true;
    window.siyuan.touchDragGhost = null;

    const dragStartEvent = new DragEvent("dragstart", {
        bubbles: true,
        cancelable: true,
        clientX: touch.clientX,
        clientY: touch.clientY,
        dataTransfer: dt,
        view: window,
    });
    dragState.draggableElement.dispatchEvent(dragStartEvent);

    dragState.ghostElement = window.siyuan.touchDragGhost || null;
    if (dragState.ghostElement) {
        dragState.ghostElement.style.pointerEvents = "none";
        dragState.ghostElement.style.zIndex = (++window.siyuan.zIndex).toString();
        // 先定位再显示，避免拖拽影像在错误位置闪现。
        positionGhost(touch.clientX, touch.clientY);
        dragState.ghostElement.style.opacity = "0.6";
    }

    if (editorElement) {
        const dragEnterEvent = new DragEvent("dragenter", {
            bubbles: false,
            cancelable: true,
            clientX: touch.clientX,
            clientY: touch.clientY,
            dataTransfer: dt,
            view: window,
        });
        editorElement.dispatchEvent(dragEnterEvent);
    }
};

const continueBridgeDrag = (touch: DragPoint) => {
    if (!dragState.isDragging) return;

    const elementUnderTouch = getElementUnderPoint(touch.clientX, touch.clientY);

    // 仅在目标元素的父容器变化时派发 dragenter 和 dragleave，避免同级元素之间移动时闪烁。
    if (elementUnderTouch !== lastDragOverElement) {
        const prevContainer = lastDragOverElement?.parentElement;
        const currContainer = elementUnderTouch?.parentElement;
        if (prevContainer !== currContainer || (!prevContainer && currContainer) || (prevContainer && !currContainer)) {
            if (lastDragOverElement) {
                const dragLeaveEvent = new DragEvent("dragleave", {
                    bubbles: true,
                    cancelable: true,
                    clientX: touch.clientX,
                    clientY: touch.clientY,
                    dataTransfer: dragState.dataTransfer,
                    view: window,
                });
                lastDragOverElement.dispatchEvent(dragLeaveEvent);
            }
            if (elementUnderTouch) {
                const dragEnterEvent = new DragEvent("dragenter", {
                    bubbles: true,
                    cancelable: true,
                    clientX: touch.clientX,
                    clientY: touch.clientY,
                    dataTransfer: dragState.dataTransfer,
                    view: window,
                });
                elementUnderTouch.dispatchEvent(dragEnterEvent);
            }
        }
        lastDragOverElement = elementUnderTouch;
    }

    if (elementUnderTouch) {
        const dragOverEvent = new DragEvent("dragover", {
            bubbles: true,
            cancelable: true,
            clientX: touch.clientX,
            clientY: touch.clientY,
            dataTransfer: dragState.dataTransfer,
            view: window,
        });
        elementUnderTouch.dispatchEvent(dragOverEvent);
    }

    positionGhost(touch.clientX, touch.clientY);
};

const endBridgeDrag = (touch: DragPoint) => {
    if (!dragState.isDragging) return;

    const elementUnderTouch = getElementUnderPoint(touch.clientX, touch.clientY);
    if (elementUnderTouch) {
        const dropEvent = new DragEvent("drop", {
            bubbles: true,
            cancelable: true,
            clientX: touch.clientX,
            clientY: touch.clientY,
            dataTransfer: dragState.dataTransfer,
            view: window,
        });
        elementUnderTouch.dispatchEvent(dropEvent);
    }

    const dragEndEvent = new DragEvent("dragend", {
        bubbles: true,
        cancelable: true,
        clientX: touch.clientX,
        clientY: touch.clientY,
        dataTransfer: dragState.dataTransfer,
        view: window,
    });
    dragState.draggableElement.dispatchEvent(dragEndEvent);
};

const cleanupDrag = () => {
    stopScrollAnimation();
    clearDragoverClasses();

    if (dragState?.restoreDraggable) {
        dragState.draggableElement.setAttribute("draggable", "true");
    }
    if (dragState?.ghostElement) {
        dragState.ghostElement.remove();
    }

    window.siyuan.touchDragActive = false;
    window.siyuan.touchDragGhost = null;
    dragState = null;
    lastDragOverElement = null;
};

const handleCancel = () => {
    // touchcancel 时两条路径都需无条件清理（cleanupDrag/cancelManualTouch 内部均做空状态处理）
    cleanupDrag();
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

export const initTouchDragBridge = () => {
    // 所有平台都需记录输入源，供 Touch 回调识别鼠标合成事件。
    document.addEventListener("pointerdown", (event: PointerEvent) => {
        lastPointerType = event.pointerType;
    }, {capture: true, passive: true});

    if (isInAndroid()) {
        // Android 外接鼠标由 Pointer 路径驱动，避免原生 Drag API 在 dragstart 后取消事件流且不派发 drop。
        document.addEventListener("pointerdown", handlePointerDown, {capture: true, passive: true});
        document.addEventListener("pointermove", handlePointerMove, {capture: true, passive: false});
        document.addEventListener("pointerup", handlePointerUp, {capture: true, passive: false});
        document.addEventListener("pointercancel", handlePointerCancel, {capture: true, passive: true});
        document.addEventListener("click", handleMouseClick, {capture: true, passive: false});
        window.addEventListener("blur", () => {
            if (dragState?.inputType === "pointer") {
                cleanupDrag();
            }
        });
    }

    // 触摸事件桥接：原生 Drag API（draggable="true"）与手动 mousedown 拖拽（dock/outline/resize 把手）统一入口
    document.addEventListener("touchstart", handleTouchStart, {passive: false});
    document.addEventListener("touchmove", handleTouchMove, {passive: false});
    document.addEventListener("touchend", handleTouchEnd);
    document.addEventListener("touchcancel", handleCancel);
};
