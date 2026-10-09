import {Constants} from "../constants";
import {matchHotKey} from "../protyle/util/hotKey";
import {isInIOS} from "../protyle/util/compatibility";
import {getKeymapBindings} from "./keymapBindings";
import {fetchSyncPost} from "./fetch";
import {withFetchTimeout} from "./fetchTimeout";
import type {SystemKeyboardLogEntryInput, SystemKeyboardLogEventInput} from "../types/api";

const MAX_RECORDS = 1000;
const MAX_PENDING = 200;
const BATCH_SIZE = 50;
const session = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const events = new WeakMap<KeyboardEvent, number>();
let enabled = false;
let sequence = 0;
let eventSequence = 0;
let activeEvent = 0;
let pending: SystemKeyboardLogEntryInput[] = [];
let timer: number;
let sending: Promise<void>;
let failures = 0;

const record = (entry: Omit<SystemKeyboardLogEntryInput, "seq" | "time">) => {
    if (!enabled || sequence >= MAX_RECORDS) {
        return;
    }
    pending.push({...entry, seq: ++sequence, time: Date.now()});
    // 网络不可用时限制内存占用，保留最近的诊断记录。
    if (pending.length > MAX_PENDING) {
        pending.shift();
    }
    if (!timer && !sending && failures < 3) {
        timer = window.setTimeout(() => {
            timer = undefined;
            void flushKeyboardDiagnostics();
        }, 200);
    }
};

// 将已采集的记录写入系统日志，导出前等待当前批次和后续批次完成。
export const flushKeyboardDiagnostics = async () => {
    clearTimeout(timer);
    timer = undefined;
    if (sending) {
        await sending;
        if (pending.length && failures < 3) {
            await flushKeyboardDiagnostics();
        }
        return;
    }
    if (!pending.length || failures >= 3) {
        return;
    }
    sending = (async () => {
        while (pending.length && failures < 3) {
            const entries = pending.splice(0, BATCH_SIZE);
            try {
                const response = await withFetchTimeout((signal) => fetchSyncPost(
                    "/api/system/appendKeyboardLog", {session, entries}, undefined, false, signal), undefined, 3000);
                if (response.code !== 0) {
                    throw new Error("keyboard diagnostic rejected");
                }
                failures = 0;
            } catch {
                failures++;
                pending = [...entries, ...pending].slice(-MAX_PENDING);
                break;
            }
        }
    })();
    await sending;
    sending = undefined;
    if (pending.length && failures < 3) {
        timer = window.setTimeout(() => {
            timer = undefined;
            void flushKeyboardDiagnostics();
        }, 1000);
    }
};

const snapshot = (event: KeyboardEvent): SystemKeyboardLogEventInput => {
    const target = event.target instanceof HTMLElement ? event.target : undefined;
    return {
        // 只保留目标快捷键和修饰键分类，不记录任意字符或组合输入内容。
        key: ["f", "F", "p", "P", "Meta", "Control", "Unidentified", "Process"].includes(event.key) ? event.key : "Other",
        code: ["KeyF", "KeyP", "MetaLeft", "MetaRight", "ControlLeft", "ControlRight"].includes(event.code) ? event.code : "Other",
        keyCode: event.keyCode,
        meta: event.metaKey,
        ctrl: event.ctrlKey,
        alt: event.altKey,
        shift: event.shiftKey,
        composing: event.isComposing,
        repeat: event.repeat,
        trusted: event.isTrusted,
        defaultPrevented: event.defaultPrevented,
        cancelBubble: event.cancelBubble,
        target: target?.tagName === "INPUT" ? "input" : target?.tagName === "TEXTAREA" ? "textarea" :
            target?.closest(".protyle-wysiwyg") ? "editor" : target === document.body ? "body" : "other",
        matchSearch: matchHotKey(window.siyuan.config.keymap.general.search, event),
        matchGlobalSearch: matchHotKey(window.siyuan.config.keymap.general.globalSearch, event),
    };
};

export const logKeyboardDiagnostic = (stage: string, event: KeyboardEvent, detail = "") => {
    const id = events.get(event);
    if (id) {
        record({stage, event: id, detail, keyboard: snapshot(event)});
    }
};

// 在同步分发时保存按键编号，使异步接口返回仍能关联原始按键。
export const createKeyboardSearchTrace = (command: string) => {
    const event = activeEvent;
    const tracked = enabled && ["search", "globalSearch"].includes(command);
    return (stage: string, detail = "", responseCode?: number) => {
        if (tracked) {
            record({stage, event, command, detail, ...(responseCode === undefined ? {} : {responseCode})});
        }
    };
};

export const initKeyboardDiagnostics = (frontend: "desktop" | "mobile") => {
    if (enabled || window.siyuan.isPublish || !isInIOS()) {
        return;
    }
    enabled = true;
    record({stage: "environment", environment: {
        version: Constants.SIYUAN_VERSION,
        userAgent: navigator.userAgent.slice(0, 512),
        platform: navigator.platform.slice(0, 64),
        frontend,
        search: getKeymapBindings(window.siyuan.config.keymap.general.search).slice(0, 8).map(key => key.slice(0, 20)),
        globalSearch: getKeymapBindings(window.siyuan.config.keymap.general.globalSearch).slice(0, 8).map(key => key.slice(0, 20)),
    }});
    const capture = (event: KeyboardEvent) => {
        if (sequence >= MAX_RECORDS || !(event.metaKey || event.ctrlKey || event.keyCode === 229 ||
            [70, 80, 91, 93].includes(event.keyCode) || ["KeyF", "KeyP"].includes(event.code) ||
            ["f", "F", "p", "P", "Meta", "Control"].includes(event.key))) {
            return;
        }
        const id = ++eventSequence;
        events.set(event, id);
        if (event.type === "keydown") {
            activeEvent = id;
        }
        logKeyboardDiagnostic("capture", event, event.type);
        // 等待整个事件分发结束后记录最终状态，保留各处理器使用的按键编号。
        window.setTimeout(() => {
            logKeyboardDiagnostic("settled", event, event.type);
            if (activeEvent === id) {
                activeEvent = 0;
            }
        }, 0);
    };
    // 捕获阶段先于编辑器，阻止冒泡的按键仍留下原始状态。
    window.addEventListener("keydown", capture, true);
    window.addEventListener("keyup", capture, true);
    ["compositionstart", "compositionend"].forEach(stage => {
        window.addEventListener(stage, () => record({stage, event: activeEvent}), true);
    });
};
