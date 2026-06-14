import {Tab} from "../Tab";
import {Model} from "../Model";
import {App} from "../../index";
import {fetchAgentSSE, IEditorContext, ISSEResult} from "../../util/agentSSE";
import {mountComposer} from "./AgentComposer";
import {getAllEditor} from "../getAll";
import "./frontendActions";
import {listActions, lookupAction} from "./frontendActions";
import {AgentSession, SessionStore} from "./SessionStore";
import {AgentSessionPanel} from "./AgentSessionPanel";
import {getDockByType} from "../tabUtil";
import {updateHotkeyAfterTip} from "../../protyle/util/compatibility";
import {escapeAriaLabel, escapeHtml} from "../../util/escape";
import {fetchPost} from "../../util/fetch";
import {confirmDialog} from "../../dialog/confirmDialog";
import {showMessage} from "../../dialog/message";
import * as dayjs from "dayjs";
import {sendNotification} from "../../plugin/platformUtils";
import {
    bindThinkingCardToggle,
    createThinkingCardElement,
    postRender,
    renderQuestionCardHTML,
    renderRetryCardHTML,
    renderTodoList,
    renderToolsLineHTML,
    renderWelcomeHTML
} from "./AgentMessageRenderer";

// Limit on the number of visible block IDs injected into the system prompt to control token usage.
// Mirrors kernel/agent/agent.go maxVisibleBlockIDs.
const maxVisibleBlockIDs = 50;

type EntryBase = { id?: string };

type SessionEntry =
    | (EntryBase & { type: "user"; content: string; timestamp?: number })
    | (EntryBase & {
    type: "thinking";
    steps: Array<{
        reasoning: string;
        reasoningContent: string;
        toolNames?: string[];
        content?: string
    }>;
    duration?: number
})
    | (EntryBase & {
    type: "assistant";
    content: string;
    toolCalls?: Array<{ name: string; arguments: Record<string, unknown>; result?: string }>;
    promptTokens?: number;
    completionTokens?: number;
    duration?: number;
    timestamp?: number
})
    | (EntryBase & { type: "confirm"; name: string; args: Record<string, unknown>; confirmID: string; status?: string })
    | (EntryBase & { type: "snapshot"; snapshotID: string })
    | (EntryBase & { type: "rollback"; snapshotID: string });

export class AgentChat extends Model {
    private messagesContainer: HTMLElement;
    private composerHost: HTMLElement;
    private composer: ReturnType<typeof mountComposer> | null = null;
    private sendBtn: HTMLElement;
    private stopBtn: HTMLElement;
    private newSessionBtn: HTMLElement;
    private titleElement: HTMLElement;
    private sessionMenuBtn: HTMLElement;
    private sessionPanel: AgentSessionPanel;
    private sessionId = "";
    private sessionTitle = "";
    private entries: SessionEntry[] = [];
    private hasTitled = false;
    private isStreaming = false;
    private currentAIElement: HTMLElement | null = null;
    private currentAssistantEntryId = "";
    private currentThinkingEntryId = "";
    private lute: Lute;
    private currentContent = "";
    private fullContent = "";
    private sessionPromptTokens = 0;
    private sessionCompletionTokens = 0;
    private sessionTotalDuration = 0;
    private responsePromptTokens = 0;
    private responseCompletionTokens = 0;
    private sessionCreatedAt = 0;
    private requestStartTime = 0;
    private tokenDisplayEl: HTMLElement;
    private defaultTitle = "";
    private currentToolCalls: Array<{ name: string; arguments: Record<string, unknown>; result?: string }> = [];
    private abortController: AbortController | null = null;
    private currentThinkingText = "";
    private currentThinkingReasoning = "";
    private currentThinkingReasoningContent = "";
    // thinking step 只保留工具名列表（去重：arguments/result 仅在 assistant entry 存一份），
    // 不再保存 text（"已思考：Xs" 由 i18n 在渲染时从 duration 生成）。
    private currentThinkingSteps: Array<{
        reasoning: string;
        reasoningContent: string;
        toolNames?: string[];
        content?: string
    }> = [];
    // 当前请求的思考耗时（秒）。持久化为 entry.duration，"已思考"文本不落盘。
    private currentThinkingDuration = 0;
    private currentThinkingStepContent = "";
    private pendingConfirms: SessionEntry[] = [];
    private renderedToolNames: Record<string, boolean> = {};
    private hasInterveningCard = false;
    private modelTrigger: HTMLElement;
    private selectedModel: string;
    private modelMenu: HTMLElement | null = null;
    private modelMenuIndex = 0;
    private modelOptions: Array<{ id: string; name: string }> = [];
    private userScrolledUp = false;
    private programmaticScroll = false;
    private stickResizeObserver: ResizeObserver | null = null;
    private scrollBottomBtn: HTMLElement;
    private navRail: HTMLElement;
    private navExpandTimer = 0;

    constructor(app: App, tab: Tab) {
        super({app: app});
        this.parent = tab;
        this.lute = Lute.New();
        this.defaultTitle = window.siyuan.languages.agentChat || "Agent";
        this.sessionTitle = this.defaultTitle;
        this.initUI();
        this.bindEvents();
    }

    private initUI() {
        const panel = this.parent.panelElement;
        panel.classList.add("fn__flex-column", "file-tree", "sy__agentChat", "dockPanel");

        const L = window.siyuan.languages;

        panel.innerHTML = '<div class="agent-chat fn__flex-column fn__flex-1">' +
            '<div class="block__icons fn__hidescrollbar">' +
            '<div class="block__logo fn__flex-1 agent-chat__title">' + (L.agentChat || "Agent") + "</div>" +
            '<span data-type="new-session" class="block__icon ariaLabel" data-position="north" aria-label="' + (L.agentNewSession || "New Session") + '">' +
            '<svg><use xlink:href="#iconAdd"></use></svg>' +
            "</span>" +
            '<span class="fn__space"></span>' +
            '<span data-type="session-menu" class="block__icon ariaLabel" data-position="north" aria-label="' + L.manageSessions + '">' +
            '<svg><use xlink:href="#iconFolderClock"></use></svg>' +
            "</span>" +
            '<span class="fn__space"></span>' +
            '<span data-type="min" class="block__icon ariaLabel" data-position="north" aria-label="' + window.siyuan.languages.min + updateHotkeyAfterTip(window.siyuan.config.keymap.general.closeTab.custom) + '">' +
            '<svg><use xlink:href="#iconMin"></use></svg>' +
            "</span>" +
            "</div>" +
        '<div class="agent-chat__messages-wrap">' +
            '<div class="agent-chat__messages fn__flex-1"></div>' +
            '<span class="agent-chat__scroll-bottom ariaLabel" data-position="west" aria-label="' + L.scrollToBottom + '"><svg><use xlink:href="#iconArrowDown"></use></svg></span>' +
        "</div>" +
        '<div class="agent-chat__input-area">' +
            '<div class="agent-chat__composer-host"></div>' +
            '<div class="agent-chat__buttons">' +
            '<span class="agent-chat__model-trigger" tabindex="0"><span class="agent-chat__model-label"></span><svg><use xlink:href="#iconUp"></use></svg></span>' +
            '<span class="agent-chat__tokens fn__none"></span>' +
            '<span class="fn__flex-1"></span>' +
            '<button class="agent-chat__send b3-button b3-button--text b3-tooltips b3-tooltips__n" aria-label="' + (L.agentSend || "Send") + '"><svg><use xlink:href="#iconCirclePlay"></use></svg></button>' +
            '<button class="agent-chat__stop b3-button b3-button--cancel fn__none b3-tooltips b3-tooltips__n" aria-label="' + (L.agentStop || "Stop") + '"><svg><use xlink:href="#iconCircleStop"></use></svg></button>' +
            "</div>" +
            "</div>" +
        '<div class="agent-chat__preview-notice">' + (L.featurePreview || "") + "</div>" +
            "</div>";

        this.messagesContainer = panel.querySelector(".agent-chat__messages") as HTMLElement;
        this.composerHost = panel.querySelector(".agent-chat__composer-host") as HTMLElement;
        this.sendBtn = panel.querySelector(".agent-chat__send") as HTMLElement;
        this.stopBtn = panel.querySelector(".agent-chat__stop") as HTMLElement;
        this.newSessionBtn = panel.querySelector('.block__icon[data-type="new-session"]') as HTMLElement;
        this.sessionMenuBtn = panel.querySelector('.block__icon[data-type="session-menu"]') as HTMLElement;
        this.titleElement = panel.querySelector(".agent-chat__title") as HTMLElement;
        this.tokenDisplayEl = panel.querySelector(".agent-chat__tokens") as HTMLElement;
        this.modelTrigger = panel.querySelector(".agent-chat__model-trigger") as HTMLElement;
        this.scrollBottomBtn = panel.querySelector(".agent-chat__scroll-bottom") as HTMLElement;
        this.messagesContainer.addEventListener("scroll", () => {
            if (this.programmaticScroll) { return; }
            const { scrollTop, scrollHeight, clientHeight } = this.messagesContainer;
            const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
            // Hysteresis: only mark as scrolled-up when clearly above bottom (>=60),
            // and only return to sticky when really at the bottom (<=10).
            // This prevents the follow state from rapidly toggling while streaming
            // causes scrollHeight to grow asynchronously.
            if (!this.userScrolledUp) {
                this.userScrolledUp = distanceFromBottom >= 60;
            } else if (distanceFromBottom <= 10) {
                this.userScrolledUp = false;
            }
            this.scrollBottomBtn.classList.toggle("agent-chat__scroll-bottom--visible", this.userScrolledUp);
            this.updateActiveMarker();
        }, {passive: true});

        const messagesWrap = panel.querySelector(".agent-chat__messages-wrap") as HTMLElement;
        this.initNavRail(messagesWrap);

        this.initModelSelect();

        this.composer = mountComposer(this.composerHost, () => {
            this.sendMessage();
        });
        this.sessionPanel = new AgentSessionPanel(
            this.sessionMenuBtn,
            this.parent.panelElement,
            () => this.sessionId,
            () => this.defaultTitle,
            {
                onSwitch: (id) => this.switchSession(id),
                onDelete: (id) => this.deleteSession(id),
                onRename: async (id, title) => {
                    await SessionStore.rename(id, title);
                    if (id === this.sessionId) {
                        this.sessionTitle = title;
                        this.titleElement.textContent = title;
                    }
                },
            }
        );
        this.initSessions();
    }

    private initModelSelect() {
        const aiConfig = window.siyuan.config.ai;
        this.modelOptions = [];
        for (const prov of aiConfig.providers || []) {
            for (const m of prov.models || []) {
                const displayName = m.displayName || m.name;
                if (!displayName) {
                    continue;
                }
                this.modelOptions.push({ id: m.id || m.name, name: displayName });
            }
        }
        if (this.modelOptions.length > 0) {
            this.selectedModel = this.modelOptions[0].id;
        }
        this.updateModelLabel();
        this.modelTrigger.addEventListener("click", (e: MouseEvent) => {
            e.stopPropagation();
            if (this.modelMenu) {
                this.closeModelMenu();
            } else {
                this.openModelMenu();
            }
        });
        this.modelTrigger.addEventListener("keydown", (e: KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                if (this.modelMenu) {
                    const option = this.modelOptions[this.modelMenuIndex];
                    if (option) {
                        this.selectedModel = option.id;
                        this.updateModelLabel();
                    }
                    this.closeModelMenu();
                } else {
                    this.openModelMenu();
                }
            } else if (e.key === "ArrowDown") {
                e.preventDefault();
                if (!this.modelMenu) { this.openModelMenu(); return; }
                this.modelMenuIndex = (this.modelMenuIndex + 1) % this.modelOptions.length;
                this.updateModelMenuHighlight();
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                if (!this.modelMenu) { this.openModelMenu(); return; }
                this.modelMenuIndex = (this.modelMenuIndex - 1 + this.modelOptions.length) % this.modelOptions.length;
                this.updateModelMenuHighlight();
            } else if (e.key === "Escape" && this.modelMenu) {
                this.closeModelMenu();
            }
        });
    }

    private updateModelLabel() {
        const label = this.modelTrigger.querySelector(".agent-chat__model-label") as HTMLElement;
        const option = this.modelOptions.find((o) => o.id === this.selectedModel);
        if (label && option) { label.textContent = option.name; }
    }

    private openModelMenu() {
        this.closeModelMenu();
        this.modelMenuIndex = this.modelOptions.findIndex((o) => o.id === this.selectedModel);
        if (this.modelMenuIndex < 0) { this.modelMenuIndex = 0; }
        const menu = document.createElement("div");
        menu.className = "agent-chat__model-menu b3-menu";
        let html = '<div class="b3-menu__items">';
        for (let i = 0; i < this.modelOptions.length; i++) {
            const o = this.modelOptions[i];
            const isSelected = o.id === this.selectedModel;
            html += '<div class="agent-chat__model-item b3-menu__item' + (isSelected ? " b3-menu__item--current" : "") + '" data-i="' + i + '" data-id="' + o.id + '">' +
                '<span class="b3-menu__label">' + escapeHtml(o.name) + "</span>" +
                '<svg class="agent-chat__model-check"><use xlink:href="#iconSelect"></use></svg>' +
            "</div>";
        }
        html += "</div>";
        menu.innerHTML = html;
        this.modelTrigger.appendChild(menu);
        this.modelMenu = menu;
        this.updateModelMenuHighlight();
        menu.addEventListener("click", (e: MouseEvent) => {
            e.stopPropagation();
            const item = (e.target as HTMLElement).closest(".agent-chat__model-item") as HTMLElement;
            if (item) {
                this.selectedModel = item.getAttribute("data-id") || this.selectedModel;
                this.updateModelLabel();
                this.closeModelMenu();
            }
        });
        setTimeout(() => {
            document.addEventListener("click", this.closeModelMenuHandler);
        }, 10);
    }

    private closeModelMenuHandler = () => {
        this.closeModelMenu();
        document.removeEventListener("click", this.closeModelMenuHandler);
    };

    private closeModelMenu() {
        if (this.modelMenu) {
            this.modelMenu.remove();
            this.modelMenu = null;
        }
        document.removeEventListener("click", this.closeModelMenuHandler);
    }

    private updateModelMenuHighlight() {
        if (!this.modelMenu) { return; }
        const items = this.modelMenu.querySelectorAll(".agent-chat__model-item");
        for (let i = 0; i < items.length; i++) {
            items[i].classList.toggle("b3-menu__item--highlight", i === this.modelMenuIndex);
        }
        const current = items[this.modelMenuIndex] as HTMLElement;
        if (current) { current.scrollIntoView({ block: "nearest" }); }
    }

    private getSelectedModel(): string {
        return this.selectedModel;
    }

    private showWelcome() {
        this.messagesContainer.innerHTML = renderWelcomeHTML();
        const examples = this.messagesContainer.querySelectorAll(".agent-welcome__example");
        examples.forEach((example) => {
            const ex = example as HTMLElement;
            ex.addEventListener("click", () => {
                const text = ex.getAttribute("data-text") || "";
                if (text && this.composer) {
                    this.messagesContainer.innerHTML = "";
                    const userEntryId = SessionStore.newSessionId();
                    this.entries.push({id: userEntryId, type: "user", content: text, timestamp: Date.now()});
                    this.appendUserMessage(text, Date.now(), userEntryId);
                    this.rebuildNavMarkers();
                    this.tryGenerateTitle();
                    this.setStreaming(true);
                    this.abortController = new AbortController();
                    const requestSessionId = this.sessionId;
                    this.requestStartTime = Date.now();
                    this.currentThinkingDuration = 0;
                    fetchAgentSSE(text, window.siyuan.config.appearance.lang, [],
                        (event: ISSEResult) => {
                            if (this.sessionId !== requestSessionId) {
                                return;
                            }
                            this.handleSSEEvent(event);
                        },
                        (err: Error) => {
                            if (this.sessionId !== requestSessionId) {
                                return;
                            }
                            this.handleError(err);
                        },
                        this.abortController.signal,
                        this.sessionId,
                        this.getSelectedModel());
                }
            });
        });
    }

    private initNavRail(wrap: HTMLElement) {
        this.navRail = document.createElement("div");
        this.navRail.className = "agent-chat__nav-rail";

        this.navRail.addEventListener("mouseenter", () => {
            this.navExpandTimer = window.setTimeout(() => {
                this.navRail.classList.add("agent-chat__nav-rail--expanded");
            }, 200);
        });
        this.navRail.addEventListener("mouseleave", () => {
            clearTimeout(this.navExpandTimer);
            this.navRail.classList.remove("agent-chat__nav-rail--expanded");
        });
        this.navRail.addEventListener("click", (e: MouseEvent) => {
            const marker = (e.target as HTMLElement).closest(".agent-chat__nav-rail-marker") as HTMLElement;
            if (!marker) { return; }
            this.jumpToMessage(marker.dataset.messageId || "");
        });

        wrap.appendChild(this.navRail);
    }

    private rebuildNavMarkers() {
        this.navRail.innerHTML = "";
        const userEntries = this.entries.filter((e): e is { id?: string; type: "user"; content: string; timestamp?: number } => e.type === "user");
        if (userEntries.length === 0) { return; }

        const gap = Math.max(0.5, Math.min(3, 40 / userEntries.length));
        this.navRail.style.setProperty("--nav-gap", gap + "px");

        for (const entry of userEntries) {
            const marker = document.createElement("div");
            marker.className = "agent-chat__nav-rail-marker ariaLabel";
            marker.dataset.messageId = entry.id || "";
            marker.setAttribute("data-position", "west");
            marker.setAttribute("aria-label", escapeAriaLabel(escapeHtml(entry.content)));
            marker.textContent = entry.content.slice(0, 120);
            this.navRail.appendChild(marker);
        }
        this.updateActiveMarker();
    }

    private updateActiveMarker() {
        const userMsgs = this.messagesContainer.querySelectorAll(".agent-chat__msg--user[data-message-id]");
        if (userMsgs.length === 0) { return; }
        const threshold = this.messagesContainer.scrollTop + 50;
        let activeId = "";
        for (let i = 0; i < userMsgs.length; i++) {
            if ((userMsgs[i] as HTMLElement).offsetTop <= threshold) {
                activeId = userMsgs[i].getAttribute("data-message-id") || "";
            } else {
                break;
            }
        }
        if (!activeId && userMsgs.length > 0) {
            activeId = userMsgs[0].getAttribute("data-message-id") || "";
        }
        const markers = this.navRail.children;
        for (let i = 0; i < markers.length; i++) {
            markers[i].classList.toggle("agent-chat__nav-rail-marker--active",
                markers[i].getAttribute("data-message-id") === activeId);
        }
    }

    private jumpToMessage(messageId: string) {
        if (!messageId) { return; }
        const el = this.messagesContainer.querySelector('[data-message-id="' + messageId + '"]') as HTMLElement;
        if (!el) { return; }
        el.scrollIntoView({behavior: "smooth", block: "center"});
        el.classList.add("agent-chat__msg--jumped");
        setTimeout(() => {
            el.classList.remove("agent-chat__msg--jumped");
        }, 1500);
    }

    private bindEvents() {
        this.sendBtn.addEventListener("click", (e: MouseEvent) => {
            e.stopPropagation();
            this.sendMessage();
        });
        this.stopBtn.addEventListener("click", (e: MouseEvent) => {
            e.stopPropagation();
            void this.stopGeneration();
        });
        this.newSessionBtn.addEventListener("click", (e: MouseEvent) => {
            e.stopPropagation();
            this.createSession();
        });
        this.sessionMenuBtn.addEventListener("click", (e: MouseEvent) => {
            e.stopPropagation();
            this.sessionPanel.toggle();
        });

        this.parent.panelElement.addEventListener("click", (e: MouseEvent) => {
            const t = e.target as HTMLElement;
            let target = t;
            while (target && !target.isEqualNode(this.parent.panelElement)) {
                if (target.classList.contains("block__icon")) {
                    const type = target.getAttribute("data-type");
                    if (type === "min") {
                        e.stopPropagation();
                        getDockByType("agentChat").toggleModel("agentChat", false, true);
                        return;
                    }
                    break;
                }
                target = target.parentElement;
            }
            if (t.closest(".block__icons")) {
                return;
            }
            if (t.closest(".agent-chat__msg")) {
                return;
            }
            if (t.closest(".agent-chat__header")) {
                return;
            }
            if (t.closest(".agent-session-popup")) {
                return;
            }
            if (t.closest(".agent-chat__model-trigger") || t.closest(".agent-chat__model-menu")) {
                return;
            }
            if (this.composer) {
                this.composer.focus();
            }
        });
        this.scrollBottomBtn.addEventListener("click", () => {
            this.scrollToBottom(true);
        });
    }

    private async initSessions() {
        const list = await SessionStore.init();
        if (list.length > 0) {
            list.sort((a, b) => b.createdAt - a.createdAt);
            const last = list[0];
            const session = await SessionStore.load(last.id);
            if (session) {
                this.sessionId = session.id;
                this.sessionCreatedAt = session.createdAt || Date.now();
                this.sessionTitle = session.title;
                this.entries = this.buildEntriesFromSession(session);
                this.hasTitled = session.titled !== false;
                this.sessionPromptTokens = session.promptTokens || 0;
                this.sessionCompletionTokens = session.completionTokens || 0;
                this.sessionTotalDuration = session.totalDuration || 0;
                if (session.model) {
                    this.selectedModel = session.model;
                    this.updateModelLabel();
                }
                if (this.composer) {
                    this.composer.restoreHistory(session.messageHistory || []);
                }
                this.titleElement.textContent = session.title;
                this.updateTokenDisplay();
                this.renderLoadedSession(session);
                this.rebuildNavMarkers();
                this.scrollToBottom(true);
                return;
            }
        }
        this.sessionId = SessionStore.newSessionId();
        this.sessionCreatedAt = Date.now();
        this.sessionTitle = this.defaultTitle;
        this.entries = [];
        this.showWelcome();
        this.scrollToBottom(true);
    }

    private async saveSession() {
        if (this.entries.length === 0) {
            return;
        }
        const session: AgentSession = {
            id: this.sessionId,
            title: this.sessionTitle,
            titled: this.hasTitled,
            entries: this.entries.slice(),
            promptTokens: this.sessionPromptTokens,
            completionTokens: this.sessionCompletionTokens,
            totalDuration: this.sessionTotalDuration,
            createdAt: this.sessionCreatedAt,
            updatedAt: Date.now(),
            messageHistory: this.composer?.getHistory() || [],
            model: this.getSelectedModel(),
        };
        await SessionStore.save(session);
    }

    private async switchSession(id: string) {
        this.setStreaming(false);
        this.finishActiveThinking();
        this.flushThinkingStep();
        await this.saveSession();
        const session = await SessionStore.load(id);
        if (!session) {
            return;
        }
        this.sessionId = session.id;
        if (this.composer) {
            this.composer.clearHistory();
            this.composer.restoreHistory(session.messageHistory || []);
        }
        this.sessionCreatedAt = session.createdAt || Date.now();
        this.sessionTitle = session.title;
        this.titleElement.textContent = session.title || this.defaultTitle;
        this.entries = this.buildEntriesFromSession(session);
        this.hasTitled = session.titled !== false;
        this.currentAIElement = null;
        this.currentContent = "";
        this.fullContent = "";
        this.sessionPromptTokens = session.promptTokens || 0;
        this.sessionCompletionTokens = session.completionTokens || 0;
        this.sessionTotalDuration = session.totalDuration || 0;
        if (session.model) {
            this.selectedModel = session.model;
            this.updateModelLabel();
        }
        if (this.tokenDisplayEl) {
            this.updateTokenDisplay();
        }
        this.messagesContainer.classList.add("agent-chat__messages--switching");
        this.messagesContainer.addEventListener("transitionend", () => {
            this.messagesContainer.innerHTML = "";
            this.titleElement.textContent = session.title;
            this.renderLoadedSession(session);
            this.rebuildNavMarkers();
            this.scrollToBottom(true);
            this.messagesContainer.classList.remove("agent-chat__messages--switching");
        }, {once: true});
    }

    private appendPersistedAssistant(content: string, promptTokens?: number, completionTokens?: number, duration?: number, timestamp?: number, entryId?: string) {
        if (!content || !content.trim()) {
            return;
        }
        const el = document.createElement("div");
        el.className = "agent-chat__msg agent-chat__msg--ai";
        if (entryId) {
            el.setAttribute("data-message-id", entryId);
        }
        el.innerHTML = '<div class="agent-chat__body">' + (this.lute.MarkdownStr("", content) || escapeHtml(content)) + "</div>";
        this.messagesContainer.appendChild(el);
        postRender(el);
        this.addCopyButton(el, content, promptTokens, completionTokens, duration, timestamp);
    }

    private appendPersistedToolCalls(content: string, toolCalls: Array<{
        name: string;
        arguments: Record<string, unknown>;
        result?: string
    }>, promptTokens?: number, completionTokens?: number, duration?: number, timestamp?: number, entryId?: string) {
        let hasRendered = false;
        for (let i = 0; i < toolCalls.length; i++) {
            const tc = toolCalls[i];
            if (tc.result && tc.name === "todo_write") {
                const rel = document.createElement("div");
                rel.className = "agent-chat__msg agent-chat__msg--tool";
                if (entryId) {
                    rel.setAttribute("data-message-id", entryId);
                }
                rel.innerHTML = renderTodoList(tc.result);
                this.messagesContainer.appendChild(rel);
                hasRendered = true;
            }
        }
        if (content && content.trim()) {
            this.appendPersistedAssistant(content, promptTokens, completionTokens, duration, timestamp, entryId);
            hasRendered = true;
        }
        if (!hasRendered) {
            return;
        }
    }

    private appendPersistedConfirm(entry: {
        id?: string;
        name: string;
        args: Record<string, unknown>;
        confirmID: string;
        status?: string
    }) {
        const L = window.siyuan.languages;
        const el = document.createElement("div");
        el.className = "agent-chat__msg agent-chat__msg--confirm agent-chat__msg--confirmed";
        if (entry.id) {
            el.setAttribute("data-message-id", entry.id);
        }
        const argsStr = JSON.stringify(entry.args, null, 2);
        const desc = (L.agentConfirmDesc || "Agent: {category} operation").replace("{category}", escapeHtml(this.toolCategory(entry.name)));
        let statusLabel = "";
        if (entry.status === "approved") {
            statusLabel = L.agentConfirmApprove || "Approved";
        } else if (entry.status === "rejected") {
            statusLabel = L.agentConfirmReject || "Rejected";
        } else if (entry.status === "always") {
            statusLabel = L.agentConfirmAlways || "Session Allow";
        }
        el.innerHTML = '<div class="agent-chat__confirm-card">' +
            '<div class="agent-chat__confirm-header"><svg class="agent-chat__confirm-icon"><use xlink:href="#iconInfo"></use></svg> ' + desc + "</div>" +
            '<pre class="agent-chat__confirm-args">' + escapeHtml(argsStr) + "</pre>" +
            (statusLabel ? '<div class="agent-chat__confirm-actions"><span class="agent-chat__confirm-done">' + statusLabel + "</span></div>" : "") +
            "</div>";
        this.messagesContainer.appendChild(el);
    }

    private renderLoadedSession(session: AgentSession) {
        for (let i = 0; i < session.entries.length; i++) {
            const entry = session.entries[i];
            const entryId = (entry as { id?: string }).id;
            switch (entry.type) {
                case "user":
                    this.appendUserMessage((entry as { content: string }).content, (entry as { timestamp?: number }).timestamp, entryId);
                    break;
                case "thinking":
                    if (entry.steps && entry.steps.length > 0) {
                        // 老数据兼容：旧 step 可能含 text（"已思考：Xs"）和 toolCalls（{name,result}），
                        // 这里归一化为新格式（toolNames + entry.duration）。
                        const rawEntry = entry as {
                            steps: Array<{
                                reasoning: string;
                                reasoningContent?: string;
                                toolNames?: string[];
                                toolCalls?: Array<{ name: string; result?: string }>;
                                text?: string;
                                content?: string
                            }>;
                            duration?: number
                        };
                        const normSteps = rawEntry.steps.map(s => ({
                            reasoning: s.reasoning || "",
                            reasoningContent: s.reasoningContent || "",
                            toolNames: (s.toolNames && s.toolNames.length > 0)
                                ? s.toolNames
                                : (s.toolCalls ? s.toolCalls.map(t => t.name) : undefined),
                            content: s.content,
                        }));
                        // entry.duration 优先；否则尝试从最后一个 step.text 提取（老格式）。
                        let dur: number | undefined = rawEntry.duration;
                        if (dur === undefined) {
                            const lastText = rawEntry.steps[rawEntry.steps.length - 1]?.text;
                            if (lastText) {
                                const m = lastText.match(/([\d.]+)\s*s/i);
                                if (m) { dur = parseFloat(m[1]); }
                            }
                        }
                        this.renderMergedThinkingCard(normSteps, entryId, dur);
                    }
                    break;
                case "assistant":
                    const a = entry as { content: string; toolCalls?: Array<{ name: string; arguments: Record<string, unknown>; result?: string }>; promptTokens?: number; completionTokens?: number; duration?: number; timestamp?: number };
                    if (a.toolCalls && a.toolCalls.length > 0) {
                        this.appendPersistedToolCalls(a.content, a.toolCalls, a.promptTokens, a.completionTokens, a.duration, a.timestamp, entryId);
                    } else {
                        this.appendPersistedAssistant(a.content, a.promptTokens, a.completionTokens, a.duration, a.timestamp, entryId);
                    }
                    break;
                case "confirm":
                    this.appendPersistedConfirm(entry as unknown as {
                        id?: string;
                        name: string;
                        args: Record<string, unknown>;
                        confirmID: string;
                        status?: string
                    });
                    break;
                case "snapshot":
                    this.appendSnapshotInfo((entry as { snapshotID: string }).snapshotID, entryId);
                    break;
                case "rollback":
                    this.appendRollbackInfo((entry as { snapshotID: string }).snapshotID, entryId);
                    break;
            }
        }
    }

    private buildEntriesFromSession(session: AgentSession): SessionEntry[] {
        if (session.messages && session.messages.length > 0) {
            const entriesLen = session.entries ? session.entries.length : 0;
            if (session.messages.length > entriesLen) {
                const entries: SessionEntry[] = [];
                for (let i = 0; i < session.messages.length; i++) {
                    const msg = session.messages[i];
                    if (msg.role === "user") {
                        entries.push({id: SessionStore.newSessionId(), type: "user", content: msg.content});
                    } else if (msg.role === "assistant") {
                        entries.push({
                            id: SessionStore.newSessionId(),
                            type: "assistant",
                            content: msg.content,
                            toolCalls: msg.toolCalls ? msg.toolCalls.map(tc => ({
                                name: tc.name,
                                arguments: tc.arguments || {},
                                result: tc.result,
                            })) : undefined,
                        });
                    }
                }
                return entries;
            }
        }
        if (session.entries && session.entries.length > 0) {
            return session.entries as any as SessionEntry[];
        }
        return [];
    }

    private async createSession() {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
        this.setStreaming(false);
        this.finishActiveThinking();
        this.flushThinkingStep();
        await this.saveSession();
        this.sessionId = SessionStore.newSessionId();
        this.sessionCreatedAt = Date.now();
        if (this.composer) {
            this.composer.clearHistory();
        }
        this.sessionTitle = this.defaultTitle;
        this.entries = [];
        this.hasTitled = false;
        this.currentAIElement = null;
        this.currentContent = "";
        this.fullContent = "";
        this.sessionPromptTokens = 0;
        this.sessionCompletionTokens = 0;
        this.sessionTotalDuration = 0;
        this.responsePromptTokens = 0;
        this.responseCompletionTokens = 0;
        this.currentToolCalls = [];
        this.renderedToolNames = {};
        this.hasInterveningCard = false;
        if (this.tokenDisplayEl) {
            this.tokenDisplayEl.classList.add("fn__none");
        }
        this.messagesContainer.innerHTML = "";
        this.currentThinkingSteps = [];
        this.currentThinkingStepContent = "";
        this.pendingConfirms = [];
        this.rebuildNavMarkers();
        this.titleElement.textContent = this.defaultTitle;
        if (this.composer) {
            this.composer.clear();
        }
        if (this.composer) {
            this.composer.focus();
        }
        this.showWelcome();
        this.scrollToBottom(true);
    }

    private async deleteSession(id: string) {
        const wasCurrent = id === this.sessionId;
        if (wasCurrent) {
            const result = await SessionStore.list({page: 1, pageSize: 2});
            const list = result.sessions.filter(s => s.id !== id);
            if (list.length > 0) {
                await this.switchSession(list[0].id);
                await SessionStore.remove(id);
            } else {
                this.entries = [];
                this.sessionId = SessionStore.newSessionId();
                await this.createSession();
                await SessionStore.remove(id);
            }
        } else {
            await SessionStore.remove(id);
        }
    }

    private async sendMessage() {
        if (!this.composer) {
            return;
        }
        const sendData = this.composer.getSendData();
        const text = sendData.text;
        const refs = sendData.references;
        const editorContext = this.captureEditorContext();
        const pluginActions = listActions()
            .filter(a => a.name.startsWith("plugin__") && a.description)
            .map(a => ({name: a.name, description: a.description as string}));
        if (!text || this.isStreaming) {
            return;
        }

        this.setStreaming(true);
        this.clearThinking();
        this.hasInterveningCard = false;
        this.composer.clear();

        const userEntryId = SessionStore.newSessionId();
        this.entries.push({id: userEntryId, type: "user", content: text, timestamp: Date.now()});
        if (this.entries.length === 1) {
            this.messagesContainer.innerHTML = "";
        }
        this.appendUserMessage(text, Date.now(), userEntryId);
        this.rebuildNavMarkers();
        this.tryGenerateTitle();
        if (this.composer) {
            this.composer.pushHistory(text);
        }
        await this.saveSession();

        this.requestStartTime = Date.now();
        this.currentThinkingDuration = 0;

        this.abortController = new AbortController();
        const requestSessionId = this.sessionId;

        await fetchAgentSSE(
            text,
            window.siyuan.config.appearance.lang,
            refs,
            (event: ISSEResult) => {
                if (this.sessionId !== requestSessionId) {
                    return;
                }
                return this.handleSSEEvent(event);
            },
            (err: Error) => {
                if (this.sessionId !== requestSessionId) {
                    return;
                }
                return this.handleError(err);
            },
            this.abortController.signal,
            this.sessionId,
            this.getSelectedModel(),
            undefined,
            editorContext,
            pluginActions,
        );
    }

    // Capture a read-only snapshot of the user's editor to inject into the system prompt.
    // Strategy: scan ALL editors. Prefer one that (a) is visible and (b) has selected blocks; 
    // this directly targets "user selected blocks here" regardless of which window has focus.
    // Falls back to the editor hosting the DOM selection, then the most-recently-activated tab.
    private captureEditorContext(): IEditorContext | undefined {
        /// #if MOBILE
        const mobEditor = window.siyuan.mobile.editor || window.siyuan.mobile.popEditor;
        if (mobEditor?.protyle && !mobEditor.protyle.element.classList.contains("fn__none")) {
            return this.readEditorContext(mobEditor);
        }
        return undefined;
        /// #else
        const allEditor = getAllEditor();
        if (!allEditor || allEditor.length === 0) {
            return undefined;
        }
        const isEditable = (e: { protyle: { element: HTMLElement } }) =>
            !e.protyle.element.classList.contains("fn__none") &&
            e.protyle.element.closest(".layout__center") !== null;

        // Aggregate selected block IDs across ALL editors (user may have selected blocks
        // in one editor while a different one is "active").
        let allSelected: string[] = [];
        allEditor.forEach(e => {
            e.protyle?.wysiwyg?.element?.querySelectorAll("[data-node-id].protyle-wysiwyg--select")
                ?.forEach(el => {
                    const id = (el as HTMLElement).getAttribute("data-node-id");
                    if (id) { allSelected.push(id); }
                });
        });
        allSelected = Array.from(new Set(allSelected));

        // Candidate selection, in priority order:
        let candidate: { protyle: { block?: { id?: string; rootID?: string }; wysiwyg?: { element?: HTMLElement }; element: HTMLElement; model?: { parent?: { headElement?: HTMLElement } } } } | undefined;

        // 1) An editable editor that has its own selected blocks.
        candidate = allEditor.find(e => isEditable(e) &&
            !!e.protyle?.wysiwyg?.element?.querySelector(".protyle-wysiwyg--select"));
        // 2) The editor hosting the current DOM selection.
        if (!candidate) {
            const domSel = window.getSelection();
            const range = domSel && domSel.rangeCount > 0 ? domSel.getRangeAt(0) : null;
            if (range) {
                candidate = allEditor.find(e => e.protyle.element.contains(range.startContainer));
            }
        }
        // 3) The most-recently-activated focused document tab (data-activetime).
        if (!candidate) {
            let activeTime = 0;
            allEditor.forEach(e => {
                let head = e.protyle.model?.parent?.headElement;
                if (!head && e.protyle.element.getBoundingClientRect().height > 0) {
                    const tabBody = e.protyle.element.closest(".fn__flex-1[data-id]");
                    if (tabBody) {
                        head = document.querySelector(
                            `.layout-tab-bar .item[data-id="${tabBody.getAttribute("data-id")}"]`);
                    }
                }
                if (head && head.classList.contains("item--focus") &&
                    parseInt(head.dataset.activetime || "0") > activeTime) {
                    activeTime = parseInt(head.dataset.activetime || "0");
                    candidate = e;
                }
            });
        }
        // 4) Any visible (non-fn__none) editor.
        if (!candidate) {
            candidate = allEditor.find(e => !e.protyle.element.classList.contains("fn__none"));
        }

        const ctx = candidate ? this.readEditorContext(candidate) : undefined;
        // Even if no candidate editor was located, surface the globally-collected selections.
        if ((!ctx || !ctx.selectedBlockIDs || ctx.selectedBlockIDs.length === 0) && allSelected.length > 0) {
            const merged: IEditorContext = ctx ? {...ctx} : {};
            merged.selectedBlockIDs = allSelected;
            return merged;
        }
        return ctx;
        /// #endif
    }

    private readEditorContext(editor: {
        protyle: {
            block?: { id?: string; rootID?: string };
            wysiwyg?: { element?: HTMLElement };
            contentElement?: HTMLElement;
            notebookId?: string;
            title?: { editElement?: HTMLElement };
        };
    }): IEditorContext | undefined {
        const p = editor.protyle;
        if (!p) {
            return undefined;
        }
        const activeDocID = p.block?.rootID;
        const focusedBlockID = p.block?.id;
        const activeDocTitle = p.title?.editElement?.textContent?.trim() || undefined;
        const notebookID = p.notebookId || undefined;

        const selectedBlockIDs: string[] = [];
        p.wysiwyg?.element?.querySelectorAll("[data-node-id].protyle-wysiwyg--select")
            ?.forEach(el => {
                const id = (el as HTMLElement).getAttribute("data-node-id");
                if (id) { selectedBlockIDs.push(id); }
            });

        // Visible blocks: top-level [data-node-id] children whose bounding rect intersects
        // the scroll container viewport. Long docs are lazily loaded, so wysiwyg.element's
        // children are already the loaded subset; this further narrows to what is on screen.
        const visibleBlockIDs: string[] = [];
        const scrollContainer = (p.contentElement || p.wysiwyg?.element?.parentElement as HTMLElement | undefined);
        if (scrollContainer && p.wysiwyg?.element) {
            const view = scrollContainer.getBoundingClientRect();
            const children = p.wysiwyg.element.children;
            for (let i = 0; i < children.length; i++) {
                const child = children[i] as HTMLElement;
                const id = child.getAttribute("data-node-id");
                if (!id) { continue; }
                const rect = child.getBoundingClientRect();
                if (rect.height === 0) { continue; }
                if (rect.bottom >= view.top && rect.top <= view.bottom) {
                    visibleBlockIDs.push(id);
                }
                if (visibleBlockIDs.length >= maxVisibleBlockIDs) { break; }
            }
        }

        if (!activeDocID && !activeDocTitle && !notebookID &&
            !focusedBlockID && selectedBlockIDs.length === 0 && visibleBlockIDs.length === 0) {
            return undefined;
        }
        const ctx: IEditorContext = {};
        if (activeDocID) { ctx.activeDocID = activeDocID; }
        if (activeDocTitle) { ctx.activeDocTitle = activeDocTitle; }
        if (notebookID) { ctx.notebookID = notebookID; }
        if (focusedBlockID && focusedBlockID !== activeDocID) { ctx.focusedBlockID = focusedBlockID; }
        if (selectedBlockIDs.length > 0) { ctx.selectedBlockIDs = selectedBlockIDs; }
        if (visibleBlockIDs.length > 0) { ctx.visibleBlockIDs = visibleBlockIDs; }
        return ctx;
    }

    private async handleSSEEvent(event: ISSEResult) {
        try {
            switch (event.type) {
                case "content":
                    this.appendToken(event.token);
                    break;
                case "thinking":
                    this.appendThinking(event.reasoning);
                    break;
                case "tool_call":
                    this.currentToolCalls.push({name: event.name, arguments: event.arguments});
                    break;
                case "confirm":
                    this.appendConfirm(event.name, event.arguments, event.confirmID);
                    break;
                case "tool_result":
                    if (this.currentToolCalls.length > 0) {
                        this.currentToolCalls[this.currentToolCalls.length - 1].result = event.result;
                    }
                    this.appendToolResult(event.name, event.result);
                    break;
                case "done":
                    this.flushTokenUpdate();
                    await this.finishResponse();
                    break;
                case "usage":
                    this.appendUsage(event.promptTokens, event.completionTokens);
                    break;
                case "error":
                    this.appendError(event.message);
                    this.setStreaming(false);
                    await this.saveSession();
                    break;
                case "retry":
                    this.appendRetry(event.attempt, event.maxRetries);
                    break;
                case "question":
                    this.appendQuestion(event.questionID, event.arguments);
                    break;
                case "reasoning":
                    this.appendReasoning(event.token);
                    break;
                case "snapshot":
                    {
                        const snapshotEntryId = SessionStore.newSessionId();
                        this.entries.push({id: snapshotEntryId, type: "snapshot", snapshotID: event.snapshotID});
                        this.appendSnapshotInfo(event.snapshotID, snapshotEntryId);
                    }
                    break;
                case "frontend_tool_call":
                    this.handleFrontendToolCall(event.callID, event.arguments);
                    break;
            }
        } catch (e) {
            console.error("agent SSE event handler error:", e, event);
            this.setStreaming(false);
        }
    }

    private async handleError(err: Error) {
        this.flushTokenUpdate();
        this.appendError(err.message);
        this.setStreaming(false);
        await this.saveSession();
    }

    private appendUserMessage(text: string, timestamp?: number, entryId?: string) {
        const el = document.createElement("div");
        el.className = "agent-chat__msg agent-chat__msg--user";
        if (entryId) {
            el.setAttribute("data-message-id", entryId);
        }
        let html = '<div class="agent-chat__body">' + escapeHtml(text) + "</div>";
        html += '<div class="agent-chat__msg-actions">';
        if (timestamp) {
            html += '<span class="agent-chat__msg-meta agent-chat__msg-time">' + this.formatMessageTime(timestamp) + "</span>";
        }
        html += '<span class="block__icon block__icon--show ariaLabel" data-position="north" aria-label="' + window.siyuan.languages.copy + '"><svg><use xlink:href="#iconCopy"></use></svg></span>' +
        "</div>";
        el.innerHTML = html;
        el.querySelector(".block__icon")?.addEventListener("click", (e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(text).then(() => {
                showMessage(window.siyuan.languages.copied, 2000);
            }).catch(() => {
                showMessage(window.siyuan.languages.copied, 2000);
            });
        });
        this.messagesContainer.appendChild(el);
        this.scrollToBottom(true);
    }

    private createAIMessagePlaceholder(): HTMLElement {
        this.currentContent = "";
        this.currentAssistantEntryId = SessionStore.newSessionId();
        const el = document.createElement("div");
        el.className = "agent-chat__msg agent-chat__msg--ai";
        el.setAttribute("data-message-id", this.currentAssistantEntryId);
        el.innerHTML = '<div class="agent-chat__body agent-chat__body--streaming"></div>';
        this.messagesContainer.appendChild(el);
        this.scrollToBottom();
        this.observeStickTarget(el);
        return el;
    }

    private pendingTokenUpdate = false;
    private rafId = 0;

    private appendToken(token: string) {
        this.currentContent += token;
        this.fullContent += token;

        const thinkBody = this.messagesContainer.querySelector(".agent-chat__msg--thinking:not(.agent-chat__msg--thinking-done) .agent-chat__thinking-body");
        if (thinkBody) {
            let chatEl = thinkBody.querySelector(".agent-chat__thinking-chat--streaming") as HTMLElement;
            if (!chatEl) {
                chatEl = document.createElement("div");
                chatEl.className = "agent-chat__thinking-chat agent-chat__thinking-chat--streaming";
                thinkBody.appendChild(chatEl);
            }
            chatEl.innerHTML = this.lute.MarkdownStr("", this.currentContent) || escapeHtml(this.currentContent);
            postRender(chatEl);
            this.scrollToBottom();
            return;
        }

        if (!this.currentAIElement) {
            this.currentAIElement = this.createAIMessagePlaceholder();
        }

        if (!this.pendingTokenUpdate) {
            this.pendingTokenUpdate = true;
            this.rafId = requestAnimationFrame(() => {
                this.pendingTokenUpdate = false;
                const bodyEl = this.currentAIElement?.querySelector(".agent-chat__body") as HTMLElement;
                if (bodyEl) {
                    bodyEl.innerHTML = this.lute.MarkdownStr("", this.currentContent) || escapeHtml(this.currentContent);
                    postRender(bodyEl);
                    void bodyEl.offsetHeight; // force reflow
                    this.scrollToBottom();
                }
            });
        }
    }

    private flushTokenUpdate() {
        if (this.pendingTokenUpdate) {
            this.pendingTokenUpdate = false;
            cancelAnimationFrame(this.rafId);
            const bodyEl = this.currentAIElement?.querySelector(".agent-chat__body") as HTMLElement;
            if (bodyEl) {
                bodyEl.innerHTML = this.lute.MarkdownStr("", this.currentContent) || escapeHtml(this.currentContent);
                postRender(bodyEl);
            }
        }
    }

    private appendToolResult(name: string, result: string) {
        if (name !== "todo_write") {
            return;
        }

        const el = document.createElement("div");
        el.className = "agent-chat__msg agent-chat__msg--tool";
        el.innerHTML = renderTodoList(result);
        this.insertBeforeAI(el);
        this.scrollToBottom(true);
        this.hasInterveningCard = true;
    }

    private appendThinking(reasoning: string) {
        const L = window.siyuan.languages;
        if (this.currentThinkingText) {
            // step 不再保存 text（渲染时由 duration 经 i18n 生成），
            // 工具调用只留名字（arguments/result 在 assistant entry 存一份）。
            const toolNames = this.currentToolCalls.map(function (t) {
                return t.name;
            });
            this.currentThinkingSteps.push({
                reasoning: this.currentThinkingReasoning,
                reasoningContent: this.currentThinkingReasoningContent,
                toolNames: toolNames.length > 0 ? toolNames : undefined,
            });
        }
        this.currentThinkingText = "";
        this.currentThinkingReasoning = reasoning;
        this.currentThinkingReasoningContent = "";
        let text = L.agentThinking || "Thinking...";

        this.currentThinkingText = text;

        let detailLines = "";
        if (reasoning === "processing" && this.currentToolCalls.length > 0) {
            const newTools: Array<{ name: string }> = [];
            for (let i = 0; i < this.currentToolCalls.length; i++) {
                const tc = this.currentToolCalls[i];
                if (!this.renderedToolNames[tc.name]) {
                    this.renderedToolNames[tc.name] = true;
                    newTools.push({name: tc.name});
                }
            }
            if (newTools.length > 0) {
                detailLines += renderToolsLineHTML(newTools);
            }
        }

        if (reasoning === "processing" && this.currentAIElement) {
            if (this.currentContent) {
                const bodyEl = this.currentAIElement.querySelector(".agent-chat__body") as HTMLElement;
                if (bodyEl) {
                    bodyEl.classList.remove("agent-chat__body--streaming");
                }
                this.attachStepContent(this.currentContent);
                this.currentAIElement.remove();
            } else {
                this.currentAIElement.remove();
            }
        this.currentAIElement = null;
        this.currentAssistantEntryId = "";
        this.currentThinkingEntryId = "";
        this.currentContent = "";
        } else if (reasoning === "processing" && this.currentContent) {
            this.attachStepContent(this.currentContent);
            this.currentContent = "";
            const streamingEl = this.messagesContainer.querySelector(".agent-chat__msg--thinking:not(.agent-chat__msg--thinking-done) .agent-chat__thinking-chat--streaming") as HTMLElement;
            if (streamingEl) {
                streamingEl.classList.remove("agent-chat__thinking-chat--streaming");
            }
        }

        if (reasoning === "processing" && this.hasInterveningCard) {
            const L = window.siyuan.languages;
            const oldCards = this.messagesContainer.querySelectorAll(".agent-chat__msg--thinking:not(.agent-chat__msg--thinking-done)");
            for (let i = 0; i < oldCards.length; i++) {
                const card = oldCards[i] as HTMLElement;
                card.classList.add("agent-chat__msg--thinking-done");
                const dot = card.querySelector(".agent-chat__thinking-dot");
                if (dot) {
                    dot.classList.add("fn__none");
                }
                const txtEl = card.querySelector(".agent-chat__thinking-text");
                if (txtEl) {
                    txtEl.textContent = L.agentThinking || "Thinking...";
                }
            }
            if (this.currentThinkingStepContent && this.currentThinkingSteps.length > 0) {
                this.currentThinkingSteps[this.currentThinkingSteps.length - 1].content = this.currentThinkingStepContent;
                this.currentThinkingStepContent = "";
            }
            if (this.currentThinkingSteps.length > 0) {
                this.entries.push({id: this.currentThinkingEntryId || undefined, type: "thinking", steps: this.currentThinkingSteps.slice(), duration: this.currentThinkingDuration || undefined});
                this.currentThinkingSteps = [];
                this.currentThinkingEntryId = "";
            }
            // 卡片边界：一张思考卡片已落盘，重置工具名去重表，使下一张卡片独立显示本轮工具
            // （与重载路径 renderMergedThinkingCard 的单卡片局部去重 seenTools 对齐）。
            this.renderedToolNames = {};
            // Flush tool calls as assistant entry
            if (this.currentToolCalls.length > 0) {
                this.entries.push({id: SessionStore.newSessionId(), type: "assistant", content: "", toolCalls: this.currentToolCalls.slice()});
                this.currentToolCalls = [];
            }
            // Flush pending confirms
            if (this.pendingConfirms.length > 0) {
                for (const c of this.pendingConfirms) {
                    this.entries.push(c);
                }
                this.pendingConfirms = [];
            }
            this.hasInterveningCard = false;
        }

        const existingCard = this.messagesContainer.querySelector(".agent-chat__msg--thinking:not(.agent-chat__msg--thinking-done)") as HTMLElement;
        const existingBody = existingCard?.querySelector(".agent-chat__thinking-body");
        if (existingBody) {
            const textEl = existingCard.querySelector(".agent-chat__thinking-text");
            if (textEl) {
                textEl.textContent = text;
            }
            if (detailLines) {
                existingBody.innerHTML += detailLines;
            }
            this.scrollToBottom();
            return;
        }
        if (existingCard) {
            existingCard.remove();
        }

        const bodyHTML = '<div class="agent-chat__thinking-body">' +
            detailLines +
            "</div>";

        const el = document.createElement("div");
        el.className = "agent-chat__msg agent-chat__msg--thinking";
        if (!this.currentThinkingEntryId) {
            this.currentThinkingEntryId = SessionStore.newSessionId();
        }
        el.setAttribute("data-message-id", this.currentThinkingEntryId);
        el.innerHTML = '<div class="agent-chat__thinking-card">' +
            '<div class="agent-chat__thinking-header">' +
            '<span class="agent-chat__thinking-arrow">' +
            '<svg class="agent-chat__thinking-arrow--expand fn__none"><use xlink:href="#iconExpand"></use></svg>' +
            '<svg class="agent-chat__thinking-arrow--contract fn__none"><use xlink:href="#iconContract"></use></svg>' +
            "</span>" +
            '<span class="agent-chat__thinking-dot"></span>' +
            '<span class="agent-chat__thinking-text">' + escapeHtml(text) + "</span>" +
            "</div>" +
            bodyHTML +
            "</div>";

        bindThinkingCardToggle(el);
        this.insertBeforeAI(el);
        this.scrollToBottom();
        this.observeStickTarget(el);
    }

    private appendReasoning(token: string) {
        const isNewRound = this.currentThinkingReasoningContent.length === 0;
        this.currentThinkingReasoningContent += token;
        const thinkingElems = this.messagesContainer.querySelectorAll(".agent-chat__msg--thinking:not(.agent-chat__msg--thinking-done) .agent-chat__thinking-body");
        if (thinkingElems.length === 0) {
            return;
        }
        const thinking = thinkingElems[thinkingElems.length - 1];
        let reasoningEl: HTMLElement;
        if (isNewRound) {
            reasoningEl = document.createElement("div");
            reasoningEl.className = "agent-chat__thinking-reasoning-text";
            thinking.appendChild(reasoningEl);
        } else {
            const allReasoning = thinking.querySelectorAll(".agent-chat__thinking-reasoning-text");
            reasoningEl = allReasoning[allReasoning.length - 1] as HTMLElement;
            if (!reasoningEl) {
                reasoningEl = document.createElement("div");
                reasoningEl.className = "agent-chat__thinking-reasoning-text";
                thinking.appendChild(reasoningEl);
            }
        }
        reasoningEl.textContent += token;
    }

    private addCopyButton(el: HTMLElement, contentOverride?: string, promptTokens?: number, completionTokens?: number, durationMs?: number, timestamp?: number) {
        const content = contentOverride || this.fullContent || el.querySelector(".agent-chat__body")?.textContent || "";
        const L = window.siyuan.languages;

        const actions = document.createElement("div");
        actions.className = "agent-chat__msg-actions";

        if (timestamp) {
            const timeSpan = document.createElement("span");
            timeSpan.className = "agent-chat__msg-meta agent-chat__msg-time--ai";
            timeSpan.textContent = this.formatMessageTime(timestamp);
            actions.appendChild(timeSpan);
        }

        if (promptTokens !== undefined && completionTokens !== undefined && (promptTokens + completionTokens > 0 || (durationMs && durationMs > 0))) {
            const total = promptTokens + completionTokens;
            let text = "";
            if (total > 0) {
                text = total >= 1000 ? (total / 1000).toFixed(1) + "k" : total.toString();
            }
            if (durationMs) {
                let seconds = Math.floor(durationMs / 1000);
                const minutes = Math.floor(seconds / 60);
                seconds = seconds % 60;
                if (text) { text += " \u00B7 "; }
                text += (minutes > 0 ? minutes + "m" : "") + seconds + "s";
            }
            const stats = document.createElement("span");
            stats.className = "agent-chat__msg-meta agent-chat__msg-stats";
            stats.textContent = text;
            actions.appendChild(stats);
        }

        const copyBtn = document.createElement("span");
        copyBtn.className = "block__icon block__icon--show ariaLabel";
        copyBtn.setAttribute("data-position", "north");
        copyBtn.setAttribute("aria-label", L.copy);
        copyBtn.innerHTML = '<svg><use xlink:href="#iconCopy"></use></svg>';
        copyBtn.addEventListener("click", (e: Event) => {
            e.stopPropagation();
            navigator.clipboard.writeText(content).then(() => {
                showMessage(window.siyuan.languages.copied, 2000);
            }).catch(() => {
                showMessage(window.siyuan.languages.copied, 2000);
            });
        });
        actions.appendChild(copyBtn);

        const regenBtn = document.createElement("span");
        regenBtn.className = "block__icon block__icon--show ariaLabel";
        regenBtn.setAttribute("data-position", "north");
        regenBtn.setAttribute("aria-label", L.agentRegenerate);
        regenBtn.innerHTML = '<svg><use xlink:href="#iconRefresh"></use></svg>';
        regenBtn.addEventListener("click", (e: Event) => {
            e.stopPropagation();
            this.regenerateResponse();
        });
        actions.appendChild(regenBtn);

        el.appendChild(actions);
    }

    private async regenerateResponse() {
        if (this.isStreaming) {
            return;
        }
        // Pop all entries after the last user entry
        while (this.entries.length > 0 && this.entries[this.entries.length - 1].type !== "user") {
            this.entries.pop();
        }
        // Remove all AI/tool/thinking/error DOM after last user message
        const all = this.messagesContainer.querySelectorAll(".agent-chat__msg");
        for (let i = all.length - 1; i >= 0; i--) {
            if (all[i].classList.contains("agent-chat__msg--user")) {
                break;
            }
            all[i].remove();
        }
        this.currentAIElement = null;
        this.observeStickTarget(null);
        this.currentContent = "";
        this.fullContent = "";
        this.currentToolCalls = [];
        this.renderedToolNames = {};
        this.hasInterveningCard = false;
        this.currentThinkingSteps = [];
        this.currentThinkingStepContent = "";
        this.currentThinkingText = "";
        this.currentThinkingReasoning = "";
        this.currentThinkingReasoningContent = "";
        this.rebuildNavMarkers();

        // Re-submit
        this.setStreaming(true);
        const lastUserEntry = this.entries[this.entries.length - 1];
        const lastUserText = lastUserEntry.type === "user" ? lastUserEntry.content : "";
        this.abortController = new AbortController();
        const requestSessionId = this.sessionId;
        await fetchAgentSSE(
            lastUserText,
            window.siyuan.config.appearance.lang,
            [],
            (event: ISSEResult) => {
                if (this.sessionId !== requestSessionId) {
                    return;
                }
                return this.handleSSEEvent(event);
            },
            (err: Error) => {
                if (this.sessionId !== requestSessionId) {
                    return;
                }
                return this.handleError(err);
            },
            this.abortController.signal,
            this.sessionId,
            this.getSelectedModel(),
            true,
        );
    }

    private async finishResponse() {
        this.finishActiveThinking();
        const savedContent = this.currentContent;
        const savedFullContent = this.fullContent;
        const ts = Date.now();
        const dur = this.requestStartTime ? Date.now() - this.requestStartTime : 0;
        const rPromptTokens = this.responsePromptTokens;
        const rCompletionTokens = this.responseCompletionTokens;
        if (!this.currentAIElement && savedContent) {
            const thinkBody = this.messagesContainer.querySelector(".agent-chat__msg--thinking:not(.agent-chat__msg--thinking-done) .agent-chat__thinking-body");
            if (thinkBody) {
                const streamingEl = thinkBody.querySelector(".agent-chat__thinking-chat--streaming") as HTMLElement;
                if (streamingEl) {
                    streamingEl.remove();
                }
            }
            this.currentAssistantEntryId = SessionStore.newSessionId();
            const el = document.createElement("div");
            el.className = "agent-chat__msg agent-chat__msg--ai";
            el.setAttribute("data-message-id", this.currentAssistantEntryId);
            el.innerHTML = '<div class="agent-chat__body">' + (this.lute.MarkdownStr("", savedContent) || escapeHtml(savedContent)) + "</div>";
            this.messagesContainer.appendChild(el);
            postRender(el);
            this.currentAIElement = el;
            this.currentContent = savedContent;
            this.fullContent = savedFullContent;
            this.addCopyButton(el, undefined, rPromptTokens, rCompletionTokens, dur, ts);
            this.scrollToBottom(true);
        }
        this.flushThinkingStep();
        if (this.pendingConfirms.length > 0) {
            for (const c of this.pendingConfirms) {
                this.entries.push(c);
            }
            this.pendingConfirms = [];
        }
        if (this.currentContent) {
            this.entries.push({
                id: this.currentAssistantEntryId || undefined,
                type: "assistant",
                content: this.currentContent,
                toolCalls: this.currentToolCalls.length > 0 ? this.currentToolCalls.slice() : undefined,
                promptTokens: rPromptTokens || undefined,
                completionTokens: rCompletionTokens || undefined,
                duration: dur || undefined,
                timestamp: ts,
            });
        } else if (this.currentToolCalls.length > 0) {
            this.entries.push({id: SessionStore.newSessionId(), type: "assistant", content: "", toolCalls: this.currentToolCalls.slice()});
        }
        this.currentAIElement = null;
        this.observeStickTarget(null);
        this.currentAssistantEntryId = "";
        this.currentContent = "";
        this.fullContent = "";
        this.currentToolCalls = [];
        this.renderedToolNames = {};
        if (this.requestStartTime) {
            this.sessionTotalDuration += Date.now() - this.requestStartTime;
            this.requestStartTime = 0;
        }
        this.responsePromptTokens = 0;
        this.responseCompletionTokens = 0;
        this.updateTokenDisplay();
        this.setStreaming(false);
        await this.saveSession();
        this.rebuildNavMarkers();
        if (savedContent && (!document.hasFocus() || document.hidden)) {
            const L = window.siyuan.languages;
            sendNotification({title: L.agentNotifyDone, timeoutType: "default"});
        }
    }

    // 把上一轮在思考卡片内显示过的 content 归属到刚 push 的最后一个 step，
    // 并清空 currentThinkingStepContent。这样每个 step 的 content 都能正确归属到自己的轮次，
    // 而不会被 flushThinkingStep 错挂到下一轮的 step（导致重载后 content 位置错位）。
    private attachStepContent(content: string) {
        if (content && this.currentThinkingSteps.length > 0) {
            this.currentThinkingSteps[this.currentThinkingSteps.length - 1].content = content;
        }
        this.currentThinkingStepContent = "";
    }

    private flushThinkingStep() {
        if (this.currentThinkingText) {
            const toolNames = this.currentToolCalls.map(function (t) {
                return t.name;
            });
            this.currentThinkingSteps.push({
                reasoning: this.currentThinkingReasoning,
                reasoningContent: this.currentThinkingReasoningContent,
                toolNames: toolNames.length > 0 ? toolNames : undefined,
                content: this.currentThinkingStepContent,
            });
            this.currentThinkingText = "";
            this.currentThinkingStepContent = "";
        }
        if (this.currentThinkingSteps.length > 0) {
            this.entries.push({
                id: this.currentThinkingEntryId || undefined,
                type: "thinking",
                steps: this.currentThinkingSteps.slice(),
                duration: this.currentThinkingDuration || undefined,
            });
            this.currentThinkingSteps = [];
            this.currentThinkingEntryId = "";
            // 卡片边界：与 appendThinking 的 hasInterveningCard 分支一致，重置工具名去重表。
            this.renderedToolNames = {};
        }
    }

    private tryGenerateTitle() {
        if (this.hasTitled) { return; }
        this.hasTitled = true;
        const userEntry = this.entries.find((e): e is { type: "user"; content: string } => e.type === "user");
        const userMsg = userEntry?.content?.slice(0, 500) || "";
        fetch("/api/ai/agent/title", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({message: userMsg, model: this.getSelectedModel(), language: window.siyuan.config.appearance.lang}),
        }).then((resp) => resp.json()).then((data) => {
            if (data.code === 0 && data.data && data.data !== this.sessionTitle) {
                this.sessionTitle = data.data;
                this.titleElement.textContent = data.data;
                this.saveSession();
            }
        }).catch((e) => {
            console.error("agent title request error:", e);
        });
    }

    private async appendError(message: string) {
        this.finishActiveThinking();
        this.clearThinking();
        if (this.currentAIElement && !this.currentContent) {
            this.currentAIElement.remove();
        }
        this.currentAIElement = null;
        const el = document.createElement("div");
        el.className = "agent-chat__msg agent-chat__msg--error";
        el.innerHTML = '<div class="agent-chat__body agent-chat__body--error"><svg class="agent-chat__error-icon"><use xlink:href="#iconTriangleAlert"></use></svg><span>' + escapeHtml(message) + "</span></div>";
        this.messagesContainer.appendChild(el);
        this.scrollToBottom(true);
        this.flushThinkingStep();
        await this.saveSession();
    }

    private appendRetry(attempt: number, maxRetries: number) {
        this.finishActiveThinking();
        this.currentThinkingSteps = [];
        this.currentThinkingStepContent = "";
        this.renderedToolNames = {};
        this.clearThinking();
        const el = document.createElement("div");
        el.className = "agent-chat__msg agent-chat__msg--thinking";
        el.innerHTML = renderRetryCardHTML(attempt, maxRetries);
        this.insertBeforeAI(el);
        this.scrollToBottom(true);
        this.hasInterveningCard = true;
    }

    private appendSnapshotInfo(snapshotID: string, entryId?: string) {
        const L = window.siyuan.languages;
        const shortID = snapshotID.length > 7 ? snapshotID.substring(0, 7) : snapshotID;
        const el = document.createElement("div");
        el.className = "agent-chat__msg agent-chat__msg--snapshot";
        if (entryId) {
            el.setAttribute("data-message-id", entryId);
        }
        el.innerHTML = '<div class="agent-chat__snapshot-body">' +
            '<span class="agent-chat__snapshot-icon"><svg><use xlink:href="#iconHistory"></use></svg></span>' +
            '<span class="agent-chat__snapshot-text">' + escapeHtml((L.snapshotAutoCreated || "Auto snapshot created") + " " + shortID) + "</span>" +
            '<button class="b3-button b3-button--text agent-chat__snapshot-rollback b3-tooltips b3-tooltips__n" aria-label="' + (L.rollback || "Rollback") + '"><svg><use xlink:href="#iconUndo"></use></svg></button>' +
            "</div>";
        const rollbackBtn = el.querySelector(".agent-chat__snapshot-rollback") as HTMLButtonElement;
        rollbackBtn.addEventListener("click", () => {
            const confirmText = (L.rollbackConfirm || "Rollback cannot be undone").replace("${name}", L.dataSnapshot || "Snapshot").replace("${time}", shortID);
            confirmDialog("⚠️ " + (L.rollback || "Rollback"), confirmText, () => {
                fetchPost("/api/repo/checkoutRepo", {id: snapshotID, sessionID: this.sessionId}, () => {});
            });
        });
        this.insertBeforeAI(el);
        this.scrollToBottom(true);
        this.hasInterveningCard = true;
    }

    private appendRollbackInfo(snapshotID: string, entryId?: string) {
        const L = window.siyuan.languages;
        const shortID = snapshotID.length > 7 ? snapshotID.substring(0, 7) : snapshotID;
        const el = document.createElement("div");
        el.className = "agent-chat__msg agent-chat__msg--snapshot";
        if (entryId) {
            el.setAttribute("data-message-id", entryId);
        }
        el.innerHTML = '<div class="agent-chat__snapshot-body">' +
            '<span class="agent-chat__snapshot-icon"><svg><use xlink:href="#iconHistory"></use></svg></span>' +
            '<span class="agent-chat__snapshot-text">' + escapeHtml((L.rollbackCompleted || "Rollback completed") + " " + shortID) + "</span>" +
            "</div>";
        this.messagesContainer.appendChild(el);
        this.scrollToBottom(true);
    }

    private async stopGeneration() {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
        this.flushTokenUpdate();
        this.finishActiveThinking();
        const savedContent = this.currentContent;
        const savedFullContent = this.fullContent;
        const ts = Date.now();
        const dur = this.requestStartTime ? Date.now() - this.requestStartTime : 0;
        const rPromptTokens = this.responsePromptTokens;
        const rCompletionTokens = this.responseCompletionTokens;
        if (!this.currentAIElement && savedContent) {
            const thinkBody = this.messagesContainer.querySelector(".agent-chat__msg--thinking:not(.agent-chat__msg--thinking-done) .agent-chat__thinking-body");
            if (thinkBody) {
                const streamingEl = thinkBody.querySelector(".agent-chat__thinking-chat--streaming") as HTMLElement;
                if (streamingEl) {
                    streamingEl.remove();
                }
            }
            this.currentAssistantEntryId = SessionStore.newSessionId();
            const el = document.createElement("div");
            el.className = "agent-chat__msg agent-chat__msg--ai";
            el.setAttribute("data-message-id", this.currentAssistantEntryId);
            el.innerHTML = '<div class="agent-chat__body">' + (this.lute.MarkdownStr("", savedContent) || escapeHtml(savedContent)) + "</div>";
            this.messagesContainer.appendChild(el);
            postRender(el);
            this.currentAIElement = el;
            this.currentContent = savedContent;
            this.fullContent = savedFullContent;
            this.addCopyButton(el, undefined, rPromptTokens, rCompletionTokens, dur, ts);
            this.scrollToBottom(true);
        }
        this.flushThinkingStep();
        if (this.currentContent) {
            this.entries.push({
                id: this.currentAssistantEntryId || undefined,
                type: "assistant",
                content: this.currentContent,
                toolCalls: this.currentToolCalls.length > 0 ? this.currentToolCalls.slice() : undefined,
                promptTokens: rPromptTokens || undefined,
                completionTokens: rCompletionTokens || undefined,
                duration: dur || undefined,
                timestamp: ts,
            });
        }
        this.currentAIElement = null;
        this.observeStickTarget(null);
        this.currentAssistantEntryId = "";
        this.currentContent = "";
        this.fullContent = "";
        this.currentToolCalls = [];
        this.renderedToolNames = {};
        if (this.requestStartTime) {
            this.sessionTotalDuration += Date.now() - this.requestStartTime;
            this.requestStartTime = 0;
        }
        this.responsePromptTokens = 0;
        this.responseCompletionTokens = 0;
        this.updateTokenDisplay();
        this.setStreaming(false);
        await this.saveSession();
        this.rebuildNavMarkers();
    }

    private insertBeforeAI(el: HTMLElement) {
        if (this.currentAIElement) {
            this.messagesContainer.insertBefore(el, this.currentAIElement);
        } else {
            this.messagesContainer.appendChild(el);
        }
    }

    private async appendConfirm(name: string, args: Record<string, unknown>, confirmID: string) {
        this.finishActiveThinking();
        this.flushThinkingStep();
        const L = window.siyuan.languages;
        const el = document.createElement("div");
        el.className = "agent-chat__msg agent-chat__msg--confirm";
        const argsStr = JSON.stringify(args, null, 2);
        const desc = (L.agentConfirmDesc || "Agent: {category} operation").replace("{category}", escapeHtml(this.toolCategory(name)));
        el.innerHTML = '<div class="agent-chat__confirm-card">' +
            '<div class="agent-chat__confirm-header"><svg class="agent-chat__confirm-icon"><use xlink:href="#iconInfo"></use></svg> ' + desc + "</div>" +
            '<pre class="agent-chat__confirm-args">' + escapeHtml(argsStr) + "</pre>" +
            '<div class="agent-chat__confirm-actions">' +
            '<button class="b3-button b3-button--cancel agent-chat__confirm-reject">' + (L.agentConfirmReject || "Reject") + "</button>" +
            '<button class="b3-button b3-button--text agent-chat__confirm-approve">' + (L.agentConfirmApprove || "Approve") + "</button>" +
            '<button class="b3-button b3-button--text agent-chat__confirm-always ariaLabel" data-position="n" aria-label="' + (L.agentConfirmAlwaysDesc || "Session Allow") + '">' + (L.agentConfirmAlways || "Session Allow") + "</button>" +
            "</div>" +
            "</div>";
        const approveBtn = el.querySelector(".agent-chat__confirm-approve");
        if (approveBtn) {
            approveBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                el.classList.add("agent-chat__msg--confirmed");
                const btns = el.querySelector(".agent-chat__confirm-actions") as HTMLElement;
                if (btns) {
                    btns.innerHTML = '<span class="agent-chat__confirm-done">' + (L.agentConfirmApprove || "Approved") + "</span>";
                }
                this.postConfirm(confirmID, true);
            });
        }
        const rejectBtn = el.querySelector(".agent-chat__confirm-reject");
        if (rejectBtn) {
            rejectBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                el.classList.add("agent-chat__msg--confirmed");
                const btns = el.querySelector(".agent-chat__confirm-actions") as HTMLElement;
                if (btns) {
                    btns.innerHTML = '<span class="agent-chat__confirm-done">' + (L.agentConfirmReject || "Rejected") + "</span>";
                }
                this.postConfirm(confirmID, false);
            });
        }
        const alwaysBtn = el.querySelector(".agent-chat__confirm-always");
        if (alwaysBtn) {
            alwaysBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                el.classList.add("agent-chat__msg--confirmed");
                const btns = el.querySelector(".agent-chat__confirm-actions") as HTMLElement;
                if (btns) {
                    btns.innerHTML = '<span class="agent-chat__confirm-done">' + (L.agentConfirmAlways || "Session Allow") + "</span>";
                }
                this.postConfirm(confirmID, true, true);
            });
        }
        this.insertBeforeAI(el);
        this.scrollToBottom(true);
        this.hasInterveningCard = true;
        const confirmEntryId = SessionStore.newSessionId();
        el.setAttribute("data-message-id", confirmEntryId);
        this.pendingConfirms.push({id: confirmEntryId, type: "confirm", name, args, confirmID, status: "pending"});
        if (!document.hasFocus() || document.hidden) {
            sendNotification({title: L.agentNotifyConfirm, body: "", timeoutType: "default"});
        }
    }

    private async postConfirm(confirmID: string, approved: boolean, always?: boolean) {
        const body: Record<string, unknown> = {confirmID: confirmID, approved: approved};
        if (always) {
            body.always = true;
        }
        try {
            const resp = await fetch("/api/ai/agent/confirm", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify(body),
            });
            if (!resp.ok) {
                console.error("agent confirm request failed:", resp.status);
            }
        } catch (e) {
            console.error("agent confirm request error:", e);
        }
        const entry = this.entries.find(e => e.type === "confirm" && e.confirmID === confirmID) as {
            status?: string
        } | undefined;
        if (entry) {
            entry.status = always ? "always" : (approved ? "approved" : "rejected");
        }
        await this.saveSession();
    }

    private async handleFrontendToolCall(callID: string, args: Record<string, unknown>) {
        // Resolve the action name ("frontend" tool calls carry the action in args.action).
        const action = (args.action as string | undefined) || "";
        const handler = lookupAction(action);
        if (!handler) {
            await this.postFrontendResult(callID, `Unknown frontend action: ${action}`, true);
            return;
        }
        try {
            const outcome = await handler.handler(args, this.app);
            const result = outcome.result || "";
            const error = outcome.error || "";
            await this.postFrontendResult(callID, error ? error : result, !!error);
        } catch (e) {
            await this.postFrontendResult(callID, `Frontend action threw: ${(e as Error).message}`, true);
        }
    }

    private async postFrontendResult(callID: string, result: string, isError: boolean) {
        try {
            const resp = await fetch("/api/ai/agent/frontendToolResult", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({callID, result, isError}),
            });
            if (!resp.ok) {
                console.error("agent frontend result request failed:", resp.status);
            }
        } catch (e) {
            console.error("agent frontend result request error:", e);
        }
    }

    private appendQuestion(questionID: string, args: Record<string, unknown>) {
        this.finishActiveThinking();
        this.flushThinkingStep();
        const L = window.siyuan.languages;
        const rawQuestions = args.questions as Array<Record<string, unknown>>;
        if (!rawQuestions || rawQuestions.length === 0) {
            return;
        }

        const el = document.createElement("div");
        el.className = "agent-chat__msg agent-chat__msg--question";
        el.setAttribute("data-question-id", questionID);

        el.innerHTML = renderQuestionCardHTML(rawQuestions, questionID);

        el.querySelectorAll(".agent-chat__question-option").forEach((option) => {
            const input = option.querySelector("input") as HTMLInputElement;
            if (!input) return;
            let wasChecked = false;
            option.addEventListener("mousedown", () => {
                wasChecked = input.checked;
            });
            option.addEventListener("click", (e) => {
                if (input.type === "radio" && wasChecked) {
                    e.preventDefault();
                    input.checked = false;
                }
            });
        });

        const submitBtn = el.querySelector(".agent-chat__question-submit-btn");
        if (submitBtn) {
            submitBtn.addEventListener("click", () => {
                const answers: string[] = [];
                for (let qi = 0; qi < rawQuestions.length; qi++) {
                    const optEl = el.querySelector('.agent-chat__question-options[data-qi="' + qi + '"]');
                    if (optEl) {
                        const selected = optEl.querySelectorAll("input:checked") as NodeListOf<HTMLInputElement>;
                        for (let si = 0; si < selected.length; si++) {
                            answers.push(selected[si].value);
                        }
                    }
                    const customInput = el.querySelector('.agent-chat__question-custom[data-qi="' + qi + '"]') as HTMLInputElement;
                    if (customInput && customInput.value.trim()) {
                        answers.push(customInput.value.trim());
                    }
                }
                el.classList.add("agent-chat__msg--confirmed");
                const actions = el.querySelector(".agent-chat__question-submit");
                if (actions) {
                    (actions as HTMLElement).innerHTML = '<span class="agent-chat__confirm-done">' + (L.agentQuestionSubmitted || "Submitted") + "</span>";
                }
                this.postQuestionAnswer(questionID, answers);
            });
        }

        this.insertBeforeAI(el);
        this.scrollToBottom(true);
        this.hasInterveningCard = true;
    }

    private async postQuestionAnswer(questionID: string, answers: string[]) {
        try {
            const resp = await fetch("/api/ai/agent/question", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({questionID: questionID, answers: answers}),
            });
            if (!resp.ok) {
                console.error("agent question request failed:", resp.status);
            }
        } catch (e) {
            console.error("agent question request error:", e);
        }
    }

    private renderSingleThinkingCard(step: {
        reasoning: string;
        text: string;
        toolNames?: string[];
        reasoningContent: string
    }) {
        const el = createThinkingCardElement(step);
        bindThinkingCardToggle(el);
        this.messagesContainer.appendChild(el);
    }

    private renderMergedThinkingCard(steps: Array<{
        reasoning: string;
        reasoningContent: string;
        toolNames?: string[];
        content?: string
    }>, entryId?: string, duration?: number) {
        if (!steps || steps.length === 0) { return; }
        let detail = "";
        const seenTools: Record<string, boolean> = {};
        for (let i = 0; i < steps.length; i++) {
            const step = steps[i];
            if (step.content) {
                detail += '<div class="agent-chat__thinking-chat">' + (this.lute.MarkdownStr("", step.content) || escapeHtml(step.content)) + "</div>";
            }
            if (step.reasoningContent) {
                detail += '<div class="agent-chat__thinking-reasoning-text">' + escapeHtml(step.reasoningContent) + "</div>";
            }
            // 工具行放在该步 reasoning 之后，对齐实时流式渲染中
            // 「reasoning/content 先到、工具行在下一轮 thinking 时补到末尾」的实际呈现。
            const names = step.toolNames && step.toolNames.length > 0
                ? step.toolNames
                : undefined;
            if (names && names.length > 0) {
                const newTools = names.filter(n => !seenTools[n]);
                if (newTools.length > 0) {
                    detail += "<div class=\"agent-chat__thinking-tools-line\"><span class=\"agent-chat__thinking-summary\">Tool calls:</span>";
                    for (let j = 0; j < newTools.length; j++) {
                        seenTools[newTools[j]] = true;
                        detail += '<span class="agent-chat__thinking-tool">' + escapeHtml(newTools[j]) + "</span>";
                    }
                    detail += "</div>";
                }
            }
        }

        const headerText = this.formatThinkingHeader(duration);

        const el = document.createElement("div");
        el.className = "agent-chat__msg agent-chat__msg--thinking agent-chat__msg--thinking-done";
        if (entryId) {
            el.setAttribute("data-message-id", entryId);
        }
        el.innerHTML = '<div class="agent-chat__thinking-card">' +
            '<div class="agent-chat__thinking-header">' +
            '<span class="agent-chat__thinking-arrow">' +
            '<svg class="agent-chat__thinking-arrow--expand"><use xlink:href="#iconExpand"></use></svg>' +
            '<svg class="agent-chat__thinking-arrow--contract fn__none"><use xlink:href="#iconContract"></use></svg>' +
            "</span>" +
            '<span class="agent-chat__thinking-dot fn__none"></span>' +
            '<span class="agent-chat__thinking-text">' + escapeHtml(headerText) + "</span>" +
            "</div>" +
            '<div class="agent-chat__thinking-body">' +
            detail +
            "</div>" +
            "</div>";

        bindThinkingCardToggle(el);
        this.messagesContainer.appendChild(el);
        postRender(el);
    }

    // 由 duration 经 i18n 生成"已思考：Xs"标题文本；无 duration 时回退到"思考中..."。
    private formatThinkingHeader(duration?: number): string {
        const L = window.siyuan.languages;
        if (duration && duration > 0) {
            return L.agentThinkingDoneTime ? L.agentThinkingDoneTime.replace("%s", duration.toFixed(1) + "s") : (L.agentThinking || "Thinking...");
        }
        return L.agentThinking || "Thinking...";
    }

    private updateTokenDisplay() {
        if (!this.tokenDisplayEl) {
            return;
        }
        const total = this.sessionPromptTokens + this.sessionCompletionTokens;
        if (total === 0 && this.sessionTotalDuration === 0) {
            return;
        }
        let text = total >= 1000 ? (total / 1000).toFixed(1) + "k" : total.toString();
        if (this.sessionTotalDuration > 0) {
            let seconds = Math.floor(this.sessionTotalDuration / 1000);
            const minutes = Math.floor(seconds / 60);
            seconds = seconds % 60;
            text += " \u00B7 " + (minutes > 0 ? minutes + "m" : "") + seconds + "s";
        }
        this.tokenDisplayEl.textContent = text;
        this.tokenDisplayEl.classList.remove("fn__none");
    }

    private appendUsage(promptTokens: number, completionTokens: number) {
        this.responsePromptTokens += promptTokens;
        this.responseCompletionTokens += completionTokens;
        this.sessionPromptTokens += promptTokens;
        this.sessionCompletionTokens += completionTokens;
        this.updateTokenDisplay();
    }

    private clearThinking() {
        const items = this.messagesContainer.querySelectorAll(
            ".agent-chat__msg--thinking:not(.agent-chat__msg--thinking-done)"
        );
        for (let i = 0; i < items.length; i++) {
            items[i].remove();
        }
    }

    private finishActiveThinking() {
        const L = window.siyuan.languages;
        // 耗时存为数值（用于持久化 entry.duration），"已思考：Xs" 文本只在 DOM 显示、不落盘。
        const durSec = this.requestStartTime ? (Date.now() - this.requestStartTime) / 1000 : 0;
        this.currentThinkingDuration = durSec;
        const doneText = durSec > 0
            ? (L.agentThinkingDoneTime ? L.agentThinkingDoneTime.replace("%s", durSec.toFixed(1) + "s") : (L.agentThinking || "Thinking..."))
            : (L.agentThinking || "Thinking...");

        const items = this.messagesContainer.querySelectorAll(
            ".agent-chat__msg--thinking:not(.agent-chat__msg--thinking-done)"
        );
        for (let i = 0; i < items.length; i++) {
            const el = items[i] as HTMLElement;
            if (i === items.length - 1) {
                const streamingChat = el.querySelector(".agent-chat__thinking-chat--streaming");
                if (streamingChat) { streamingChat.remove(); }
            }
            el.classList.add("agent-chat__msg--thinking-done");
            const dot = el.querySelector(".agent-chat__thinking-dot");
            if (dot) {
                dot.classList.add("fn__none");
            }
            const expandIcon = el.querySelector(".agent-chat__thinking-arrow--expand");
            if (expandIcon) {
                expandIcon.classList.remove("fn__none");
            }
            if (doneText) {
                const textEl = el.querySelector(".agent-chat__thinking-text");
                if (textEl) {
                    textEl.textContent = doneText;
                }
            }
        }
    }

    private setStreaming(streaming: boolean) {
        this.isStreaming = streaming;
        this.sendBtn.classList.toggle("fn__none", streaming);
        this.stopBtn.classList.toggle("fn__none", !streaming);
        if (this.composerHost) {
            this.composerHost.classList.toggle("agent-chat__composer-host--disabled", streaming);
        }
    }

    private scrollToBottom(force = false) {
        if (!force && this.userScrolledUp) { return; }
        // Guard with a flag so the resulting scroll event can be told apart from
        // a user-driven scroll. Without this, the programmatic stick-to-bottom
        // write itself trips the scroll handler and, while streaming, flips
        // userScrolledUp on transiently (scrollHeight keeps growing) which
        // immediately breaks follow-scroll.
        this.programmaticScroll = true;
        requestAnimationFrame(() => {
            this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
            // Reset the flag only after the scroll event caused by this write has
            // been dispatched (a second RAF runs after layout/event delivery).
            requestAnimationFrame(() => {
                this.programmaticScroll = false;
            });
        });
    }

    // Observe a streaming message card so that asynchronous content growth
    // (code highlighting, images, mermaid, fonts) keeps the view pinned to the
    // bottom while the user has not scrolled up. token frames only fire when a
    // chunk arrives; this closes the gap between chunks.
    private observeStickTarget(el: HTMLElement | null) {
        if (this.stickResizeObserver) {
            this.stickResizeObserver.disconnect();
            this.stickResizeObserver = null;
        }
        if (!el) { return; }
        this.stickResizeObserver = new ResizeObserver(() => {
            if (!this.userScrolledUp) {
                this.scrollToBottom();
            }
        });
        this.stickResizeObserver.observe(el);
    }

    private toolCategory(name: string): string {
        const L = window.siyuan.languages;
        const m: Record<string, string | undefined> = {
            "block": L.agentCatBlock, "document": L.agentCatDoc,
            "notebook": L.agentCatNotebook, "tag": L.agentCatTag,
            "bookmark": L.agentCatBookmark, "file": L.agentCatFile,
            "asset": L.agentCatAsset, "attr": L.agentCatAttr,
            "dailynote": L.agentCatDailynote, "import": L.agentCatImport,
            "repo": L.agentCatRepo, "history": L.agentCatHistory,
            "sync": L.agentCatSync, "database": L.agentCatDatabase,
        };
        return m[name] || L.agentCatDefault;
    }

    private formatMessageTime(ts: number): string {
        const d = dayjs(ts);
        if (d.format("YYYY-MM-DD") === dayjs().format("YYYY-MM-DD")) {
            return d.format("HH:mm");
        }
        return d.format("YYYY-MM-DD HH:mm");
    }

}
