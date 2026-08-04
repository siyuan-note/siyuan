import type {App} from "../../index";
import {
    AgentChat,
    type AgentChatNotification,
    type AgentChatStatus,
} from "../../layout/dock/agent/AgentChat";
import {openModel} from "../menu/model";
import {closeModel, closePanel} from "../util/closePanel";
import {showMessage} from "../../dialog/message";
import {sendNotification} from "../../plugin/platformUtils";

let app: App | undefined;
let agentChat: AgentChat | undefined;
let rootElement: HTMLElement | undefined;
let detachedRoot: DocumentFragment | undefined;
let visible = false;
let running = false;
let unread: AgentChatNotification | undefined;

const updateMenuStatus = () => {
    const item = document.getElementById("menuAgentChat");
    if (!item) {
        return;
    }
    const icon = item.querySelector(".b3-menu__icon");
    icon?.classList.toggle("fn__rotate", running);
    const status = item.querySelector('[data-type="agent-status"]');
    if (!status) {
        return;
    }
    status.classList.toggle("fn__none", !unread);
    status.classList.toggle("agent-menu-status--warning", unread === "confirm");
    status.textContent = unread === "confirm" ? window.siyuan.languages.agentConfirmPending : "●";
};

const detach = () => {
    visible = false;
    document.getElementById("model")?.classList.remove("model--agent");
    if (rootElement?.parentElement) {
        detachedRoot = detachedRoot || document.createDocumentFragment();
        detachedRoot.appendChild(rootElement);
    }
};

const notify = (type: AgentChatNotification) => {
    if (visible) {
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
    window.siyuan.mobile.agentChatController = {
        handleBack: handleMobileAgentBack,
        refreshStatus: updateMenuStatus,
    };
};

export const openMobileAgent = (currentApp: App) => {
    ensureAgentChat(currentApp);
    closePanel();
    openModel({
        title: "",
        html: "",
        bindEvent(modelMainElement) {
            modelMainElement.appendChild(rootElement!);
        },
        destroyCallback: detach,
    });
    document.getElementById("model").classList.add("model--agent");
    visible = true;
    unread = undefined;
    updateMenuStatus();
};

export const hideMobileAgent = () => {
    if (!visible) {
        return;
    }
    visible = false;
    document.getElementById("model")?.classList.remove("model--agent");
    closeModel();
};

export const handleMobileAgentBack = () => {
    if (!visible) {
        return false;
    }
    if (agentChat?.back()) {
        return true;
    }
    hideMobileAgent();
    return true;
};

export const insertMobileAgentMentions = (currentApp: App, mentions: Array<{id: string; label: string}>) => {
    if (mentions.length === 0) {
        return;
    }
    openMobileAgent(currentApp);
    agentChat?.insertBlockMentions(mentions);
};

export const isMobileAgentVisible = () => visible;

export const reopenMobileAgent = () => {
    if (app) {
        openMobileAgent(app);
    }
};
