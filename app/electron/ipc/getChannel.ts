// `siyuan-get` 通道：渲染进程按 cmd 字符串请求主进程能力。各领域的处理器在同目录的
// clipboard / windowCommands / systemSettings / connectionCommands 中，这里只做远程内核拦截、
// 上下文组装与分派。
import {writeLog} from "../shared/runtime";
import {getWindowByContentId} from "../window/windowLookup";
import {getWindowKernelTarget, isWindowInitialized} from "../window/windowRegistry";
import {clipboardHandlers} from "./clipboard";
import {connectionHandlers} from "./connectionCommands";
import {systemSettingHandlers} from "./systemSettings";
import {windowCommandHandlers} from "./windowCommands";
import type {IpcMainInvokeEvent} from "electron";
import type {GetHandler, GetRequest} from "./getContract";

// 远程内核窗口不得触达本机文件、剪贴板与代理设置：命中即记录并返回固定值。
const IGNORED_FILE_CLIPBOARD = "ignored local file clipboard processing in remote kernel mode";
// 原生剪贴板格式（公式、Office、WPS）同样属于本地机密。
const IGNORED_NATIVE_CLIPBOARD = "ignored local native clipboard processing in remote kernel mode";

const REMOTE_BLOCKED: Map<string, {log: string; value: unknown}> = new Map([
    ["beginRichClipboard", {log: IGNORED_FILE_CLIPBOARD, value: false}],
    ["completeRichClipboard", {log: IGNORED_FILE_CLIPBOARD, value: false}],
    ["cancelRichClipboard", {log: IGNORED_FILE_CLIPBOARD, value: false}],
    ["clipboardRead", {log: IGNORED_FILE_CLIPBOARD, value: false}],
    ["clipboardReadFiles", {log: IGNORED_FILE_CLIPBOARD, value: false}],
    ["clipboardReadMathML", {log: IGNORED_NATIVE_CLIPBOARD, value: ""}],
    ["clipboardReadOffice", {log: IGNORED_NATIVE_CLIPBOARD, value: ""}],
    ["clipboardReadWPS", {log: IGNORED_NATIVE_CLIPBOARD, value: ""}],
    ["showOpenDialog", {log: "ignored local open dialog in remote kernel mode", value: {canceled: true, filePaths: []}}],
    ["showSaveDialog", {log: "ignored local save dialog in remote kernel mode", value: {canceled: true, filePath: ""}}],
    ["printToPDF", {log: "ignored local PDF export in remote kernel mode", value: undefined}],
    ["setProxy", {log: "ignored applying a server proxy to the remote client", value: false}],
]);

const handlers: Map<string, GetHandler> = new Map(Object.entries({
    ...clipboardHandlers,
    ...connectionHandlers,
    ...systemSettingHandlers,
    ...windowCommandHandlers,
}));

const handleGet = async (event: IpcMainInvokeEvent, data: GetRequest): Promise<unknown> => {
    const kernelTarget = getWindowKernelTarget(event.sender.id);
    const remoteSender = kernelTarget?.mode === "remote";
    if (remoteSender) {
        const blocked = REMOTE_BLOCKED.get(data.cmd);
        if (blocked) {
            writeLog(blocked.log);
            return blocked.value;
        }
    }
    const handler = handlers.get(data.cmd);
    if (!handler) {
        return;
    }
    return handler({
        event,
        data,
        window: getWindowByContentId(event.sender.id),
        kernelTarget,
        isMainFrame: event.senderFrame === event.sender.mainFrame,
        initialized: isWindowInitialized(event.sender.id),
        remoteSender,
    });
};

export {handleGet};
