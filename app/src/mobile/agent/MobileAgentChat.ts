import type {App} from "../../index";
import {
    AgentChat,
    type AgentChatNotification,
    type AgentChatStatus,
} from "../../layout/dock/agent/AgentChat";
import {closePanel} from "../util/closePanel";
import {showMessage} from "../../dialog/message";
import {sendNotification} from "../../plugin/platformUtils";
import {isDisabledFeature} from "../../protyle/util/compatibility";
import {openDock} from "../dock/util";

let app: App | undefined;
let agentChat: AgentChat | undefined;
let rootElement: HTMLElement | undefined;
let detachedRoot: DocumentFragment | undefined;
let running = false;
let unread: AgentChatNotification | undefined;

const updateMenuStatus = () => {
    const item = document.getElementById("menuAgentChat");
    if (item) {
        const icon = item.querySelector(".b3-menu__icon");
        icon?.classList.toggle("fn__rotate", running);
        const status = item.querySelector('[data-type="agent-status"]');
        status?.classList.toggle("fn__none", !unread);
        status?.classList.toggle("agent-menu-status--warning", unread === "confirm");
        if (status) {
            status.textContent = unread === "confirm" ? window.siyuan.languages.agentConfirmPending : "●";
        }
    }
    const tabElement = document.querySelector('[data-type="sidebar-agent-tab"]');
    tabElement?.classList.toggle("fn__rotate", running);
    tabElement?.classList.toggle("agent-menu-status--warning", unread === "confirm");
    if (tabElement) {
        const label = unread === "confirm" ? window.siyuan.languages.agentNotifyConfirm :
            (unread === "done" ? window.siyuan.languages.agentNotifyDone : window.siyuan.languages.agentChat);
        tabElement.setAttribute("aria-label", label);
    }
};

const isAgentSidebarVisible = () => {
    const panelElement = rootElement?.closest('[data-type="sidebar-agent"]') as HTMLElement | null;
    const sidebarElement = panelElement?.closest(".side-panel") as HTMLElement | null;
    return Boolean(panelElement && !panelElement.classList.contains("fn__none") && sidebarElement?.style.transform);
};

const notify = (type: AgentChatNotification) => {
    if (isAgentSidebarVisible()) {
        return;
    }
    unread = type;
    updateMenuStatus();
    const title = type === "confirm" ?
        window.siyuan.languages.agentNotifyConfirm : window.siyuan.languages.agentNotifyDone;
    if (!document.hasFocus() || document.hidden) {
        void sendNotification({title, timeoutType: "default"});
    } else {
        showMessage(title, 3000, "info");
    }
};

const setStatus = (status: AgentChatStatus) => {
    running = status === "running";
    updateMenuStatus();
};

const ensureAgentChat = (currentApp: App) => {
    app = currentApp;
    if (agentChat && rootElement) {
        return;
    }
    rootElement = document.createElement("div");
    rootElement.className = "fn__flex-1";
    detachedRoot = document.createDocumentFragment();
    detachedRoot.appendChild(rootElement);
    agentChat = new AgentChat(currentApp, {
        element: rootElement,
        mobile: true,
        mobileSidebar: true,
        close: hideMobileAgent,
        openAiSetting: () => {
            hideMobileAgent();
            void import("../menu").then(({openMobileSetting}) => openMobileSetting(currentApp, "ai", reopenMobileAgent));
        },
        onNavigate: hideMobileAgent,
        notify,
        onStatusChange: setStatus,
    });
    window.siyuan.mobile.agentChat = agentChat;
    window.siyuan.mobile.docks.agent = agentChat;
    window.siyuan.mobile.agentChatController = {
        handleBack: handleMobileAgentBack,
        refreshStatus: updateMenuStatus,
    };
};

export const activateMobileAgent = (currentApp: App, element: HTMLElement) => {
    if (window.siyuan.config.readonly || window.siyuan.isPublish || isDisabledFeature("ai")) {
        return;
    }
    ensureAgentChat(currentApp);
    if (rootElement?.parentElement !== element) {
        element.appendChild(rootElement!);
    }
    unread = undefined;
    updateMenuStatus();
};

export const openMobileAgent = (currentApp: App) => {
    if (window.siyuan.config.readonly || window.siyuan.isPublish || isDisabledFeature("ai")) {
        return;
    }
    ensureAgentChat(currentApp);
    closePanel();
    openDock("agent");
};

export const hideMobileAgent = () => {
    if (!isAgentSidebarVisible()) {
        return;
    }
    closePanel();
};

export const handleMobileAgentBack = () => {
    if (!isAgentSidebarVisible()) {
        return false;
    }
    if (agentChat?.back()) {
        return true;
    }
    hideMobileAgent();
    return true;
};

export const insertMobileAgentMentions = (currentApp: App, mentions: Array<{id: string; label: string}>) => {
    if (mentions.length === 0 || isDisabledFeature("ai")) {
        return;
    }
    openMobileAgent(currentApp);
    agentChat?.insertBlockMentions(mentions);
};

export const isMobileAgentVisible = () => isAgentSidebarVisible();

export const reopenMobileAgent = () => {
    if (app) {
        openMobileAgent(app);
    }
};
