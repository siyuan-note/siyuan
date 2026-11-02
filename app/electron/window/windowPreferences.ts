// 主窗口与独立文档窗口共用的 webPreferences。两者的信任边界必须一致：本机内核窗口沿用插件 webview，
// 远程内核窗口禁止嵌入页面并启用网页安全策略。
import type {Session, WebPreferences} from "electron";
import type {KernelTarget} from "../shared/types";

// 远程内核使用独立的会话分区，本机内核沿用默认会话。
const kernelWindowPreferences = (kernelTarget: KernelTarget,
    getRemoteSession: (target: KernelTarget) => Session): WebPreferences => {
    const remote = kernelTarget.mode === "remote";
    return {
        nodeIntegration: true,
        nodeIntegrationInSubFrames: false,
        nodeIntegrationInWorker: false,
        webviewTag: !remote,
        webSecurity: remote,
        ...(remote ? {session: getRemoteSession(kernelTarget)} : {}),
        contextIsolation: false,
        // 桌面端禁止自动播放多媒体 https://github.com/siyuan-note/siyuan/issues/7587
        autoplayPolicy: "user-gesture-required",
    };
};

export {kernelWindowPreferences};
