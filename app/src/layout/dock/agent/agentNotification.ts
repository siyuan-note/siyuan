/// #if !BROWSER
import {ipcRenderer} from "electron";
import {Constants} from "../../../constants";
/// #endif
import {sendNotification} from "../../../plugin/platformUtils";
import type {AgentNotificationTarget} from "./agentNotificationTarget";

export const notifyAgentInteraction = (title: string, target: AgentNotificationTarget) => {
    /// #if !BROWSER
    if (process.platform === "win32") {
        ipcRenderer.send(Constants.SIYUAN_CMD, {cmd: "agentNotification", action: "show", title, target});
        return;
    }
    /// #endif
    void sendNotification({title, timeoutType: "default"});
};

export const clearAgentInteractionNotifications = (sessionID: string, target?: AgentNotificationTarget) => {
    /// #if !BROWSER
    if (process.platform === "win32") {
        ipcRenderer.send(Constants.SIYUAN_CMD, {cmd: "agentNotification", action: "clear", sessionID, target});
    }
    /// #endif
};
