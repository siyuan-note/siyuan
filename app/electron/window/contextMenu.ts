import * as electron from "electron";
import {writeLog} from "../shared/runtime";
import type {BrowserWindow, ContextMenuParams, Event as ElectronEvent, MenuItemConstructorOptions,
    WebContents} from "electron";
import {Channel} from "../shared/channels";

type ContextMenuRequest = {requestedAt?: number; items?: unknown[]};

// 渲染进程发送的坐标都带 requestedAt，用于与原生菜单事件对时。
type SpellcheckPosition = {x: number; y: number; requestedAt: number};

type MenuContext = {contextId: number; params: ContextMenuParams; createdAt: number; delivered: boolean};

// 右键菜单的挂起请求与最近一次原生菜单上下文都只在本模块内使用。
let contextSequence = 0;
const contexts = new Map<number, MenuContext>();
const pendingSpellcheckRequests = new Map<number, SpellcheckPosition>();
const pendingNativeContextMenuRequests = new Map<number, ContextMenuRequest>();
const boundContents = new Set<number>();

const NATIVE_TEXT_CONTEXT_MENU_ROLES = new Set([
    "undo", "redo", "cut", "copy", "paste", "pasteAndMatchStyle", "delete", "selectAll",
]);

// 配对窗期：渲染进程的菜单请求要在这个时间内到达才算同一次右键。
const REQUEST_MATCH_WINDOW_MS = 200;

// 渲染进程的请求必须晚于原生菜单事件，且间隔在一秒内，避免把旧请求套到新菜单上。
const isMatchingRequest = (context: MenuContext, request: ContextMenuRequest | SpellcheckPosition): boolean =>
    typeof request.requestedAt === "number" && Number.isFinite(request.requestedAt) &&
    context.createdAt >= request.requestedAt &&
    context.createdAt - request.requestedAt < 1000;

// 原生文本菜单项直接按构造选项描述，Electron 负责创建实例。
const getNativeTextContextMenuItems = (contents: WebContents, request: ContextMenuRequest = {},
    params?: ContextMenuParams): MenuItemConstructorOptions[] => {
    const items: MenuItemConstructorOptions[] = [];
    if (!Array.isArray(request.items)) {
        return items;
    }
    const misspelledWord = params?.misspelledWord;
    request.items.forEach((rawItem) => {
        const item = rawItem as {type?: string; role?: string; label?: string};
        if (!item || typeof item !== "object") {
            return;
        }
        if (item.type === "addToDictionary") {
            if (!misspelledWord) {
                return;
            }
            (params?.dictionarySuggestions || []).forEach((suggestion: string) => {
                items.push({
                    label: suggestion,
                    click: () => contents.replaceMisspelling(suggestion),
                });
            });
            items.push({
                label: item.label,
                click: () => {
                    if (!contents.session.addWordToSpellCheckerDictionary(misspelledWord)) {
                        writeLog("failed to add word to spell checker dictionary");
                    }
                },
            }, {type: "separator"});
            return;
        }
        if (item.type === "separator") {
            items.push({type: "separator"});
            return;
        }
        if (!NATIVE_TEXT_CONTEXT_MENU_ROLES.has(item.role as string)) {
            return;
        }
        items.push({
            role: item.role as MenuItemConstructorOptions["role"],
            label: item.label,
        });
    });
    return items;
};

const popupNativeTextContextMenu = (contents: WebContents, context: MenuContext | undefined,
    request: ContextMenuRequest): void => {
    const params = context?.params;
    const template = getNativeTextContextMenuItems(contents, request, params);
    const menu = electron.Menu.buildFromTemplate(template);
    const options: Electron.PopupOptions = {
        window: electron.BrowserWindow.fromWebContents(contents) as BrowserWindow,
    };
    if (params) {
        options.x = params.x;
        options.y = params.y;
        options.sourceType = params.menuSourceType;
        if (params.frame) {
            options.frame = params.frame;
        }
    }
    menu.popup(options);
};

// 原生菜单事件先到、渲染进程的请求后到；两者匹配后只处理一次。
const dispatchRequests = (contents: WebContents): void => {
    const context = contexts.get(contents.id);
    if (!context || context.delivered) {
        return;
    }
    const spellcheckRequest = pendingSpellcheckRequests.get(contents.id);
    if (spellcheckRequest && isMatchingRequest(context, spellcheckRequest)) {
        context.delivered = true;
        pendingSpellcheckRequests.delete(contents.id);
        contents.send(Channel.SIYUAN_SPELLCHECK_CONTEXT, {
            contextId: context.contextId,
            x: spellcheckRequest.x,
            y: spellcheckRequest.y,
            misspelledWord: context.params.misspelledWord,
            dictionarySuggestions: context.params.dictionarySuggestions,
        });
        return;
    }
    const nativeRequest = pendingNativeContextMenuRequests.get(contents.id);
    if (nativeRequest && isMatchingRequest(context, nativeRequest)) {
        context.delivered = true;
        pendingNativeContextMenuRequests.delete(contents.id);
        popupNativeTextContextMenu(contents, context, nativeRequest);
    }
};

const bindSpellcheckContextMenu = (contents: WebContents): void => {
    if (boundContents.has(contents.id)) {
        return;
    }
    boundContents.add(contents.id);
    contents.on("context-menu", (event: ElectronEvent, params: ContextMenuParams) => {
        const context: MenuContext = {
            contextId: ++contextSequence,
            params,
            createdAt: Date.now(),
            delivered: false,
        };
        contexts.set(contents.id, context);
        dispatchRequests(contents);
        setTimeout(() => {
            if (contexts.get(contents.id) === context && !context.delivered) {
                contexts.delete(contents.id);
            }
        }, REQUEST_MATCH_WINDOW_MS);
    });
    contents.once("destroyed", () => {
        boundContents.delete(contents.id);
        contexts.delete(contents.id);
        pendingSpellcheckRequests.delete(contents.id);
        pendingNativeContextMenuRequests.delete(contents.id);
    });
};

// 顶栏空白处是窗口拖拽区域，右键会被系统当作非客户区并弹出系统菜单，这里转交渲染进程显示自定义菜单
// https://www.electronjs.org/docs/latest/api/base-window#event-system-context-menu-windows-linux
const bindTopBarContextMenu = (win: BrowserWindow): void => {
    win.on("system-context-menu", (event: ElectronEvent, point: {x: number; y: number}) => {
        const bounds = win.getContentBounds();
        const dipPoint = electron.screen.screenToDipPoint(point);
        const zoom = win.webContents.getZoomFactor();
        const x = (dipPoint.x - bounds.x) / zoom;
        const y = (dipPoint.y - bounds.y) / zoom;
        // 顶栏高度以内（覆盖融合顶栏）转交渲染进程，其余保留系统菜单
        if (y < 0 || y > 42) {
            return;
        }
        event.preventDefault();
        win.webContents.send(Channel.SIYUAN_TOPBAR_CONTEXT_MENU, {x, y});
    });
};

// 渲染进程请求原生文本菜单或拼写建议；两者互斥，后到者覆盖先到者。
const requestContextMenu = (contents: WebContents, request: ContextMenuRequest): void => {
    pendingSpellcheckRequests.delete(contents.id);
    pendingNativeContextMenuRequests.set(contents.id, request);
    dispatchRequests(contents);
    setTimeout(() => {
        if (pendingNativeContextMenuRequests.get(contents.id) === request) {
            pendingNativeContextMenuRequests.delete(contents.id);
            if (!contents.isDestroyed()) {
                popupNativeTextContextMenu(contents, undefined, request);
            }
        }
    }, 100);
};

const requestSpellcheckContext = (contents: WebContents, position: SpellcheckPosition): void => {
    pendingNativeContextMenuRequests.delete(contents.id);
    pendingSpellcheckRequests.set(contents.id, position);
    dispatchRequests(contents);
    setTimeout(() => {
        if (pendingSpellcheckRequests.get(contents.id) === position) {
            pendingSpellcheckRequests.delete(contents.id);
        }
    }, REQUEST_MATCH_WINDOW_MS);
};

// 拼写建议只能作用于仍在显示的那次右键菜单，且建议必须来自系统给的候选词。
const applySpellcheckAction = (contents: WebContents, data: {contextId?: unknown; action?: unknown;
    suggestion?: unknown}): boolean => {
    const context = contexts.get(contents.id);
    if (!context || context.contextId !== data.contextId || !context.params.misspelledWord) {
        return false;
    }
    if (data.action === "replace") {
        if (typeof data.suggestion !== "string" ||
            !context.params.dictionarySuggestions.includes(data.suggestion)) {
            return false;
        }
        contents.replaceMisspelling(data.suggestion);
        contexts.delete(contents.id);
        return true;
    }
    if (data.action === "addToDictionary") {
        const result = contents.session.addWordToSpellCheckerDictionary(context.params.misspelledWord);
        contexts.delete(contents.id);
        return result;
    }
    return false;
};

export {
    bindSpellcheckContextMenu, bindTopBarContextMenu, requestContextMenu, requestSpellcheckContext,
    applySpellcheckAction,
};
