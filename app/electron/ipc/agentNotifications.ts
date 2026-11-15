import {Notification} from "electron";
import type {BrowserWindow, WebContents} from "electron";
import {Channel} from "../shared/channels";
import {getWindowKernelTarget} from "../window/windowRegistry";
import {showWindow} from "../window/windowVisibility";
import {isAgentNotificationID, parseAgentNotificationTarget} from "../../src/layout/dock/agent/agentNotificationTarget";

const owners = new Map<number, Map<string, Notification>>();
const keyFor = (target: {sessionID: string; kind: string; interactionID: string}) => JSON.stringify([
    target.sessionID, target.kind, target.interactionID,
]);

export const handleAgentNotification = (window: BrowserWindow, sender: WebContents, data: Record<string, unknown>) => {
    if (window.isDestroyed() || sender.isDestroyed() || window.webContents !== sender) {
        return;
    }
    const target = parseAgentNotificationTarget(data.target);
    if (data.target !== undefined && !target) {
        return;
    }
    let notifications = owners.get(sender.id);
    if (data.action === "clear") {
        if (!notifications || !isAgentNotificationID(data.sessionID)) {
            return;
        }
        for (const [key, notification] of notifications) {
            const current = JSON.parse(key) as string[];
            if (current[0] === data.sessionID && (!target || key === keyFor(target))) {
                notifications.delete(key);
                notification.close();
            }
        }
        return;
    }
    const origin = getWindowKernelTarget(sender.id)?.origin;
    if (data.action !== "show" || !target || !origin || typeof data.title !== "string" ||
        !data.title || data.title.length > 256) {
        return;
    }
    if (!notifications) {
        notifications = new Map();
        owners.set(sender.id, notifications);
        sender.once("destroyed", () => {
            const current = owners.get(sender.id);
            owners.delete(sender.id);
            current?.forEach(notification => notification.close());
            current?.clear();
        });
    }
    const owned = notifications;
    const key = keyFor(target);
    owned.get(key)?.close();
    const notification = new Notification({title: data.title, timeoutType: "default"});
    owned.set(key, notification);
    const remove = () => {
        if (owned.get(key) === notification) {
            owned.delete(key);
        }
    };
    notification.once("click", () => {
        remove();
        notification.close();
        if (window.isDestroyed() || sender.isDestroyed() || window.webContents !== sender ||
            getWindowKernelTarget(sender.id)?.origin !== origin) {
            return;
        }
        showWindow(window);
        window.focus();
        sender.send(Channel.SIYUAN_AGENT_NOTIFICATION, target);
    });
    notification.once("failed", remove);
    // Windows 超时隐藏后通知仍可能留在通知中心，需要保留点击路由直到交互完成或用户移除。
    notification.on("close", event => {
        if (event.reason === "userCanceled") {
            remove();
        }
    });
    notification.show();
};
