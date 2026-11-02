// `siyuan-get` 通道的处理器契约。各领域模块只实现处理函数，分派与远程内核拦截留在 getChannel.ts。
import type {BrowserWindow, IpcMainInvokeEvent} from "electron";
import type {KernelTarget} from "../shared/types";

type GetRequest = {cmd: string; [key: string]: unknown};

type GetContext = {
    event: IpcMainInvokeEvent;
    data: GetRequest;
    /** 发送方所在的窗口，找不到时为 undefined。 */
    window: BrowserWindow | undefined;
    kernelTarget: KernelTarget | undefined;
    /** 只接受顶层框架的请求，子框架不能借主进程能力。 */
    isMainFrame: boolean;
    initialized: boolean;
    remoteSender: boolean;
};

type GetHandler = (context: GetContext) => unknown;

export type {GetHandler, GetRequest};
