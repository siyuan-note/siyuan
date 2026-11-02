import * as electron from "electron";
import {getWindowByContentId} from "./windowLookup";
import {getWindowKernelTarget, isWindowInitialized} from "./windowRegistry";
import type {BrowserWindow, Rectangle} from "electron";
import {Channel} from "../shared/channels";

type DragPoint = {
    screenX: number;
    screenY: number;
    clientX: number;
    clientY: number;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    sequence: number;
    shiftKey: boolean;
};

type DragPayload = {
    items: {type: string; data: string}[];
    dragTitle: string;
    effectAllowed?: string;
};

type DragSession = {
    dragId: string;
    sourceWebContentsId: number;
    kernelOrigin: string;
    point?: DragPoint;
    payload?: DragPayload;
    payloadRequested?: boolean;
    targetWebContentsId?: number;
    dropping?: boolean;
    dropTargetWebContentsId?: number;
    dropSent?: boolean;
    pendingDropSequence?: number;
    waitingForDropPayload?: boolean;
    cursorPollInterval?: NodeJS.Timeout;
};

type BlockDragRequest = Record<string, unknown>;

/** 已通过校验的拖拽消息：dragId 一定是非空字符串。 */
type DragMessage = BlockDragRequest & {dragId: string};

const blockDragCursorPollInterval = 16;

// 拖拽会话只在主进程内使用，不需要共享到 runtime。
const sessions = new Map<string, DragSession>();

// 窗口获得焦点的先后顺序，只用于多个候选目标窗口时挑选最近活跃的一个；
// 由 windowLifecycle 在窗口创建与获得焦点时调用 touchWindowFocus 维护。
const windowFocusOrder = new Map<number, number>();
let windowFocusSequence = 0;

const touchWindowFocus = (webContentsId: number): void => {
    windowFocusOrder.set(webContentsId, ++windowFocusSequence);
};

const getSessionKey = (sourceWebContentsId: number, dragId: string): string =>
    sourceWebContentsId + ":" + dragId;

const getDragWindow = (webContentsId: number): BrowserWindow | undefined => {
    const window = getWindowByContentId(webContentsId);
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) {
        return;
    }
    return window;
};

const sendMessage = (webContentsId: number, data: Record<string, unknown>): boolean => {
    const targetWindow = getDragWindow(webContentsId);
    if (!targetWindow) {
        return false;
    }
    try {
        targetWindow.webContents.send(Channel.SIYUAN_BLOCK_DRAG, data);
        return true;
    } catch {
        return false;
    }
};

const normalizePoint = (point: BlockDragRequest | undefined): DragPoint | undefined => {
    const candidate = point as unknown as DragPoint;
    if (!candidate || typeof candidate !== "object" || !Number.isFinite(candidate.screenX) ||
        !Number.isFinite(candidate.screenY)) {
        return;
    }
    return {
        ...candidate,
        screenX: candidate.screenX,
        screenY: candidate.screenY,
        clientX: Number.isFinite(candidate.clientX) ? candidate.clientX : 0,
        clientY: Number.isFinite(candidate.clientY) ? candidate.clientY : 0,
        altKey: !!candidate.altKey,
        ctrlKey: !!candidate.ctrlKey,
        metaKey: !!candidate.metaKey,
        sequence: Number.isSafeInteger(candidate.sequence) ? candidate.sequence : 0,
        shiftKey: !!candidate.shiftKey,
    };
};

// 跨 BrowserWindow 拖拽时以主进程获取的全局指针位置为准，避免渲染进程失焦后上报的 screen 坐标被窗口边界截断。
const updateCursorPoint = (dragSession: DragSession, point: DragPoint | undefined): void => {
    if (!point) {
        return;
    }
    const cursorPoint = electron.screen.getCursorScreenPoint();
    dragSession.point = {
        ...point,
        screenX: cursorPoint.x,
        screenY: cursorPoint.y,
    };
};

const normalizePayload = (payload: BlockDragRequest | undefined): DragPayload | undefined => {
    const candidate = payload as unknown as DragPayload;
    if (!candidate || typeof candidate !== "object" || !Array.isArray(candidate.items) ||
        !candidate.items.every((item) => item && typeof item.type === "string" && typeof item.data === "string")) {
        return;
    }
    const normalizedPayload: DragPayload = {
        items: candidate.items.map((item) => ({type: item.type, data: item.data})),
        dragTitle: typeof candidate.dragTitle === "string" ? candidate.dragTitle : "",
    };
    if (typeof candidate.effectAllowed === "string") {
        normalizedPayload.effectAllowed = candidate.effectAllowed;
    }
    return normalizedPayload;
};

const isPointInBounds = (point: DragPoint, bounds: Rectangle): boolean => {
    return point.screenX >= bounds.x && point.screenX < bounds.x + bounds.width &&
        point.screenY >= bounds.y && point.screenY < bounds.y + bounds.height;
};

const getTarget = (dragSession: DragSession, expectedTargetWebContentsId?: number):
    {webContentsId: number; point: DragPoint} | undefined => {
    if (!dragSession.point) {
        return;
    }
    const sourceWindow = getDragWindow(dragSession.sourceWebContentsId);
    if (!sourceWindow) {
        return;
    }
    const sourceContainsPoint = isPointInBounds(dragSession.point, sourceWindow.getBounds());
    const candidates = electron.BrowserWindow.getAllWindows().filter((item: BrowserWindow) => {
        if (item.isDestroyed() || item.webContents.isDestroyed() ||
            item.webContents.id === dragSession.sourceWebContentsId ||
            !isWindowInitialized(item.webContents.id) || !item.isVisible() || item.isMinimized()) {
            return false;
        }
        if (expectedTargetWebContentsId !== undefined && item.webContents.id !== expectedTargetWebContentsId) {
            return false;
        }
        const kernelTarget = getWindowKernelTarget(item.webContents.id);
        return kernelTarget?.origin === dragSession.kernelOrigin && isPointInBounds(dragSession.point as DragPoint,
            item.getContentBounds());
    });
    candidates.sort((first: BrowserWindow, second: BrowserWindow) => {
        const alwaysOnTopDiff = Number(second.isAlwaysOnTop()) - Number(first.isAlwaysOnTop());
        if (alwaysOnTopDiff !== 0) {
            return alwaysOnTopDiff;
        }
        return (windowFocusOrder.get(second.webContents.id) || 0) - (windowFocusOrder.get(first.webContents.id) || 0);
    });
    const targetWindow = candidates[0];
    if (!targetWindow || (expectedTargetWebContentsId === undefined && sourceContainsPoint &&
        (sourceWindow.isAlwaysOnTop() || !targetWindow.isAlwaysOnTop()))) {
        // 普通目标窗口位于源窗口后方时，不应让指针穿透源窗口。
        return;
    }
    const contentBounds = targetWindow.getContentBounds();
    const zoomFactor = targetWindow.webContents.getZoomFactor() || 1;
    return {
        webContentsId: targetWindow.webContents.id,
        point: {
            ...(dragSession.point as DragPoint),
            clientX: ((dragSession.point as DragPoint).screenX - contentBounds.x) / zoomFactor,
            clientY: ((dragSession.point as DragPoint).screenY - contentBounds.y) / zoomFactor,
        },
    };
};

const leaveTarget = (dragSession: DragSession): void => {
    if (!dragSession.targetWebContentsId) {
        return;
    }
    sendMessage(dragSession.targetWebContentsId, {
        phase: "leave",
        dragId: dragSession.dragId,
    });
    dragSession.targetWebContentsId = undefined;
};

const sendRoute = (dragSession: DragSession, remote: boolean,
    sequence: number | undefined = dragSession.point?.sequence): void => {
    const sourceWindow = getDragWindow(dragSession.sourceWebContentsId);
    sendMessage(dragSession.sourceWebContentsId, {
        phase: "route",
        dragId: dragSession.dragId,
        remote,
        outsideSource: !sourceWindow || !dragSession.point ||
            !isPointInBounds(dragSession.point, sourceWindow.getContentBounds()),
        sequence,
    });
};

const routeMove = (dragSession: DragSession, notifySource = true, expectedTargetWebContentsId?: number):
    {target: {webContentsId: number; point: DragPoint}; ready: boolean} | undefined => {
    const target = getTarget(dragSession, expectedTargetWebContentsId);
    if (!target) {
        leaveTarget(dragSession);
        if (notifySource) {
            sendRoute(dragSession, false);
        }
        return;
    }
    if (!dragSession.payload) {
        if (!dragSession.payloadRequested && sendMessage(dragSession.sourceWebContentsId, {
            phase: "request",
            dragId: dragSession.dragId,
        })) {
            dragSession.payloadRequested = true;
        }
        if (notifySource) {
            sendRoute(dragSession, true);
        }
        return {target, ready: false};
    }
    if (dragSession.targetWebContentsId !== target.webContentsId) {
        leaveTarget(dragSession);
        dragSession.targetWebContentsId = target.webContentsId;
        if (!sendMessage(target.webContentsId, {
            phase: "enter",
            dragId: dragSession.dragId,
            point: target.point,
            payload: dragSession.payload,
        })) {
            dragSession.targetWebContentsId = undefined;
            if (notifySource) {
                sendRoute(dragSession, false);
            }
            return;
        }
    }
    if (!sendMessage(target.webContentsId, {
        phase: "move",
        dragId: dragSession.dragId,
        point: target.point,
    })) {
        dragSession.targetWebContentsId = undefined;
        if (notifySource) {
            sendRoute(dragSession, false);
        }
        return;
    }
    if (notifySource) {
        sendRoute(dragSession, true);
    }
    return {target, ready: true};
};

const startCursorPolling = (sessionKey: string, dragSession: DragSession): void => {
    dragSession.cursorPollInterval = setInterval(() => {
        if (sessions.get(sessionKey) !== dragSession || dragSession.dropping || !dragSession.point) {
            return;
        }
        const cursorPoint = electron.screen.getCursorScreenPoint();
        if (cursorPoint.x === dragSession.point.screenX && cursorPoint.y === dragSession.point.screenY) {
            return;
        }
        dragSession.point = {
            ...dragSession.point,
            screenX: cursorPoint.x,
            screenY: cursorPoint.y,
        };
        routeMove(dragSession);
    }, blockDragCursorPollInterval);
};

const finishSession = (sessionKey: string, dragSession: DragSession): void => {
    if (dragSession.cursorPollInterval) {
        clearInterval(dragSession.cursorPollInterval);
    }
    if (dragSession.targetWebContentsId) {
        sendMessage(dragSession.targetWebContentsId, {
            phase: "end",
            dragId: dragSession.dragId,
        });
    }
    sessions.delete(sessionKey);
};

const dispatchDrop = (dragSession: DragSession): void => {
    const dragRoute = routeMove(dragSession, false, dragSession.dropTargetWebContentsId);
    if (dragRoute?.target && !dragRoute.ready) {
        dragSession.waitingForDropPayload = true;
        return;
    }
    dragSession.waitingForDropPayload = false;
    if (dragRoute?.ready && dragRoute.target.webContentsId === dragSession.targetWebContentsId &&
        dragSession.payload) {
        if (sendMessage(dragRoute.target.webContentsId, {
            phase: "drop",
            dragId: dragSession.dragId,
            point: dragRoute.target.point,
            payload: dragSession.payload,
            sequence: dragSession.pendingDropSequence,
            sourceWebContentsId: dragSession.sourceWebContentsId,
        })) {
            dragSession.dropSent = true;
            return;
        }
        leaveTarget(dragSession);
    }
    const dropSequence = dragSession.pendingDropSequence;
    dragSession.pendingDropSequence = undefined;
    if (dragSession.dropTargetWebContentsId !== undefined) {
        sendMessage(dragSession.sourceWebContentsId, {
            phase: "complete",
            dragId: dragSession.dragId,
            canceled: true,
        });
        finishSession(getSessionKey(dragSession.sourceWebContentsId, dragSession.dragId), dragSession);
        return;
    }
    sendRoute(dragSession, false, dropSequence);
};

const dropFromTarget = (targetWebContentsId: number, data: BlockDragRequest): void => {
    const targetKernel = getWindowKernelTarget(targetWebContentsId);
    const point = normalizePoint(data.point as BlockDragRequest | undefined);
    if (!targetKernel || !isWindowInitialized(targetWebContentsId) || !point) {
        return;
    }
    for (const dragSession of sessions.values()) {
        if (dragSession.sourceWebContentsId === targetWebContentsId || dragSession.dropping ||
            dragSession.kernelOrigin !== targetKernel.origin) {
            continue;
        }
        updateCursorPoint(dragSession, {
            ...point,
            sequence: dragSession.point?.sequence || 0,
        });
        const target = getTarget(dragSession, targetWebContentsId);
        if (!target) {
            continue;
        }
        dragSession.dropping = true;
        dragSession.dropTargetWebContentsId = targetWebContentsId;
        dragSession.pendingDropSequence = dragSession.point?.sequence || 0;
        dispatchDrop(dragSession);
        return;
    }
};

// 目标渲染上下文失效后保留源窗口的拖拽会话，以便指针继续进入其他窗口。
const cleanupBlockDragSessions = (webContentsId: number): void => {
    for (const [sessionKey, dragSession] of sessions) {
        if (dragSession.sourceWebContentsId === webContentsId) {
            finishSession(sessionKey, dragSession);
        } else if (dragSession.targetWebContentsId === webContentsId) {
            dragSession.targetWebContentsId = undefined;
            if (dragSession.dropping) {
                if (dragSession.pendingDropSequence !== undefined) {
                    sendRoute(dragSession, !!dragSession.dropSent, dragSession.pendingDropSequence);
                    dragSession.pendingDropSequence = undefined;
                }
            } else {
                routeMove(dragSession);
            }
        }
    }
};

const cleanupBlockDragWindow = (webContentsId: number): void => {
    windowFocusOrder.delete(webContentsId);
    cleanupBlockDragSessions(webContentsId);
};

// 渲染进程发来的拖拽消息。四个入口各自只做一件事：
// release 与 drop-ack 由目标窗口发起，begin 开一次拖拽，其余消息交给源会话推进。
const handleDragMessage = (webContentsId: number, data: BlockDragRequest): void => {
    if (!data || typeof data !== "object") {
        return;
    }
    if (data.phase === "release") {
        dropFromTarget(webContentsId, data);
        return;
    }
    if (typeof data.dragId !== "string" || !data.dragId ||
        !["begin", "move", "payload", "drop", "drop-ack", "end"].includes(data.phase as string)) {
        return;
    }
    if (data.phase === "drop-ack") {
        acknowledgeDrop(webContentsId, data as DragMessage);
        return;
    }
    if (data.phase === "begin") {
        beginDragSession(webContentsId, data as DragMessage);
        return;
    }
    const dragSession = sessions.get(getSessionKey(webContentsId, data.dragId));
    if (!dragSession) {
        return;
    }
    advanceDragSession(webContentsId, data as DragMessage, dragSession);
};

// 目标窗口确认已收到投放：载荷已由目标承接则结束本次拖拽，否则把会话交回源窗口继续路由。
const acknowledgeDrop = (webContentsId: number, data: DragMessage): void => {
    if (!Number.isSafeInteger(data.sourceWebContentsId) || !Number.isSafeInteger(data.sequence)) {
        return;
    }
    const sourceSessionKey = getSessionKey(data.sourceWebContentsId as number, data.dragId);
    const sourceDragSession = sessions.get(sourceSessionKey);
    if (!sourceDragSession || sourceDragSession.targetWebContentsId !== webContentsId ||
        sourceDragSession.pendingDropSequence !== data.sequence) {
        return;
    }
    sourceDragSession.pendingDropSequence = undefined;
    sourceDragSession.waitingForDropPayload = false;
    if (sourceDragSession.dropTargetWebContentsId !== undefined) {
        sendMessage(sourceDragSession.sourceWebContentsId, {
            phase: "complete",
            dragId: sourceDragSession.dragId,
            remote: true,
        });
        finishSession(sourceSessionKey, sourceDragSession);
        return;
    }
    sendRoute(sourceDragSession, true, data.sequence as number);
};

// 一次拖拽只能属于已初始化且已登记内核的窗口；同窗口的旧拖拽先收尾。
const beginDragSession = (webContentsId: number, data: DragMessage): void => {
    const kernelTarget = getWindowKernelTarget(webContentsId);
    if (!kernelTarget || !isWindowInitialized(webContentsId)) {
        return;
    }
    for (const [activeSessionKey, activeSession] of sessions) {
        if (activeSession.sourceWebContentsId === webContentsId) {
            finishSession(activeSessionKey, activeSession);
        }
    }
    const dragSession: DragSession = {
        dragId: data.dragId,
        sourceWebContentsId: webContentsId,
        kernelOrigin: kernelTarget.origin,
        point: normalizePoint(data.point as BlockDragRequest | undefined),
        payload: normalizePayload(data.payload as BlockDragRequest | undefined),
        payloadRequested: false,
        targetWebContentsId: undefined,
    };
    const sessionKey = getSessionKey(webContentsId, data.dragId);
    sessions.set(sessionKey, dragSession);
    startCursorPolling(sessionKey, dragSession);
};

// 已在进行的拖拽：先更新光标与载荷，再按阶段推进。
const advanceDragSession = (webContentsId: number, data: DragMessage, dragSession: DragSession): void => {
    const sessionKey = getSessionKey(webContentsId, data.dragId);
    // 已进入投放阶段后只接受结束、或等待中的载荷补齐。
    if (dragSession.dropping && data.phase !== "end" &&
        !(data.phase === "payload" && dragSession.waitingForDropPayload)) {
        return;
    }
    const point = normalizePoint(data.point as BlockDragRequest | undefined);
    if (point) {
        updateCursorPoint(dragSession, point);
    }
    if (data.payload !== undefined) {
        const payload = normalizePayload(data.payload as BlockDragRequest | undefined);
        if (payload) {
            dragSession.payload = payload;
            dragSession.payloadRequested = false;
        }
    }
    switch (data.phase) {
        case "move":
            routeMove(dragSession);
            break;
        case "payload":
            if (dragSession.dropping) {
                dispatchDrop(dragSession);
            } else {
                routeMove(dragSession);
            }
            break;
        case "drop":
            dragSession.dropping = true;
            dragSession.pendingDropSequence = dragSession.point?.sequence;
            dispatchDrop(dragSession);
            break;
        case "end":
            finishSession(sessionKey, dragSession);
            break;
    }
};

export {cleanupBlockDragSessions, cleanupBlockDragWindow, handleDragMessage, touchWindowFocus};
