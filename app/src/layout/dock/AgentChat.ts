import {Tab} from "../Tab";
import {Model} from "../Model";
import {App} from "../../index";
import {fetchAgentSSE, ISSEResult} from "../../util/agentSSE";
import {mountComposer} from "./AgentComposer";
import {AgentSession, SessionStore} from "./SessionStore";
import {getDockByType} from "../tabUtil";
import {updateHotkeyAfterTip} from "../../protyle/util/compatibility";
import {setPosition} from "../../util/setPosition";

type SessionEntry =
    | {type: "user"; content: string}
    | {type: "thinking"; reasoning: string; text: string; reasoningContent: string; toolCalls: Array<{name: string; result?: string}>}
    | {type: "assistant"; content: string; toolCalls?: Array<{name: string; arguments: Record<string, unknown>; result?: string}>};

export class AgentChat extends Model {
    private messagesContainer: HTMLElement;
    private composerHost: HTMLElement;
    private composer: ReturnType<typeof mountComposer> | null = null;
    private sendBtn: HTMLElement;
    private stopBtn: HTMLElement;
    private newSessionBtn: HTMLElement;
    private titleElement: HTMLElement;
    private sessionMenuBtn: HTMLElement;
    private sessionPopup: HTMLElement | null = null;
    private sessionId = "";
    private sessionTitle = "";
    private entries: SessionEntry[] = [];
    private hasTitled = false;
    private isStreaming = false;
    private currentAIElement: HTMLElement | null = null;
    private lute: Lute;
    private currentContent = "";
    private fullContent = "";
    private sessionPromptTokens = 0;
    private sessionCompletionTokens = 0;
    private sessionTotalDuration = 0;
    private sessionCreatedAt = 0;
    private requestStartTime = 0;
    private tokenDisplayEl: HTMLElement;
    private defaultTitle = "";
    private currentToolCalls: Array<{name: string; arguments: Record<string, unknown>; result?: string}> = [];
    private abortController: AbortController | null = null;
    private isRenderingSessionList = false;
    private currentThinkingText = "";
    private currentThinkingReasoning = "";
    private currentThinkingReasoningContent = "";
    private modelSelect: HTMLSelectElement;

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
        '<span data-type="session-menu" class="block__icon ariaLabel" data-position="north" aria-label="' + (L.more || "More") + '">' +
            '<svg><use xlink:href="#iconMore"></use></svg>' +
        "</span>" +
        '<span class="fn__space"></span>' +
        '<span data-type="min" class="block__icon ariaLabel" data-position="north" aria-label="' + window.siyuan.languages.min + updateHotkeyAfterTip(window.siyuan.config.keymap.general.closeTab.custom) + '">' +
            '<svg><use xlink:href="#iconMin"></use></svg>' +
        "</span>" +
    "</div>" +
    '<div class="agent-chat__messages fn__flex-1"></div>' +
    '<div class="agent-chat__input-area">' +
        '<div class="agent-chat__composer-host"></div>' +
        '<div class="agent-chat__buttons">' +
            '<select class="agent-chat__model b3-select"></select>' +
            '<span class="agent-chat__tokens fn__none"></span>' +
            '<span class="fn__flex-1"></span>' +
            '<button class="agent-chat__send b3-button b3-button--text">' + (L.agentSend || "Send") + "</button>" +
            '<button class="agent-chat__stop b3-button b3-button--cancel fn__none">' + (L.agentStop || "Stop") + "</button>" +
        "</div>" +
    "</div>" +
"</div>";

        this.messagesContainer = panel.querySelector(".agent-chat__messages") as HTMLElement;
        this.composerHost = panel.querySelector(".agent-chat__composer-host") as HTMLElement;
        this.sendBtn = panel.querySelector(".agent-chat__send") as HTMLElement;
        this.stopBtn = panel.querySelector(".agent-chat__stop") as HTMLElement;
        this.newSessionBtn = panel.querySelector('.block__icon[data-type="new-session"]') as HTMLElement;
        this.sessionMenuBtn = panel.querySelector('.block__icon[data-type="session-menu"]') as HTMLElement;
        this.titleElement = panel.querySelector(".agent-chat__title") as HTMLElement;
        this.tokenDisplayEl = panel.querySelector(".agent-chat__tokens") as HTMLElement;
        this.modelSelect = panel.querySelector(".agent-chat__model") as HTMLSelectElement;

        this.initModelSelect();

        this.composer = mountComposer(this.composerHost, () => { this.sendMessage(); });
        this.initSessions();
    }

    private initModelSelect() {
        const aiConfig = window.siyuan.config.ai;
        const mainModel = aiConfig.openAI.apiModel;
        const providers = aiConfig.providers || [];
        let html = '<option value="">' + this.escapeHtml(mainModel) + "</option>";
        for (const p of providers) {
            if (p.enabled === false) { continue; }
            html += '<option value="' + this.escapeHtml(p.apiModel) + '">' + this.escapeHtml(p.apiModel) + "</option>";
        }
        this.modelSelect.innerHTML = html;
    }

    private getSelectedModel(): string {
        return this.modelSelect.value;
    }

    private showWelcome() {
        const L = window.siyuan.languages;
        const html = '<div class="agent-welcome">' +
            '<div class="agent-welcome__greeting">' + (L.agentWelcomeGreeting || "Hello, I am SiYuan Agent") + "</div>" +
            '<div class="agent-welcome__examples">' +
                '<div class="agent-welcome__example" data-text="' + this.escapeHtml(L.agentExample1 || "") + '">' + (L.agentExample1 || "") + "</div>" +
                '<div class="agent-welcome__example" data-text="' + this.escapeHtml(L.agentExample2 || "") + '">' + (L.agentExample2 || "") + "</div>" +
                '<div class="agent-welcome__example" data-text="' + this.escapeHtml(L.agentExample3 || "") + '">' + (L.agentExample3 || "") + "</div>" +
            "</div>" +
        "</div>";
        this.messagesContainer.innerHTML = html;
        const examples = this.messagesContainer.querySelectorAll(".agent-welcome__example");
        examples.forEach((example) => {
            const ex = example as HTMLElement;
            ex.addEventListener("click", () => {
                const text = ex.getAttribute("data-text") || "";
                if (text && this.composer) {
                    // 不支持 setSendText，直接用 sendMessage 发送
                    this.entries.push({type: "user", content: text});
                    this.appendUserMessage(text);
                    if (!this.hasTitled) {
                        this.hasTitled = true;
                        this.generateTitle();
                    }
                    this.setStreaming(true);
                    const apiMessages = this.entries.filter((e) => e.type === "user" || e.type === "assistant").map((e) => ({role: e.type === "user" ? "user" as const : "assistant" as const, content: (e as {content: string}).content}));
                    this.abortController = new AbortController();
                    const requestSessionId = this.sessionId;
                    fetchAgentSSE(apiMessages, window.siyuan.config.appearance.lang, [],
                        (event: ISSEResult) => {
                            if (this.sessionId !== requestSessionId) { return; }
                            this.handleSSEEvent(event);
                        },
                        (err: Error) => {
                            if (this.sessionId !== requestSessionId) { return; }
                            this.handleError(err);
                        },
                        this.abortController.signal,
                        this.sessionId,
                        this.getSelectedModel());
                }
            });
        });
    }

    private bindEvents() {
        this.sendBtn.addEventListener("click", (e: MouseEvent) => { e.stopPropagation(); this.sendMessage(); });
        this.stopBtn.addEventListener("click", (e: MouseEvent) => { e.stopPropagation(); this.stopGeneration(); });
        this.newSessionBtn.addEventListener("click", (e: MouseEvent) => { e.stopPropagation(); this.createSession(); });
        this.sessionMenuBtn.addEventListener("click", (e: MouseEvent) => {
            e.stopPropagation();
            this.toggleSessionMenu();
        });

        this.parent.panelElement.addEventListener("click", (e: MouseEvent) => {
            const t = e.target as HTMLElement;
            if (t.closest(".block__icons")) { return; }
            if (t.closest(".agent-chat__msg")) { return; }
            if (t.closest(".agent-chat__header")) { return; }
            if (t.closest(".agent-session-popup")) { return; }
            if (t.closest('[data-type="min"]')) {
                getDockByType("agentChat").toggleModel("agentChat", false, true);
                return;
            }
            if (t.closest(".agent-chat__model")) { return; }
            if (this.composer) { this.composer.focus(); }
        });
    }

    private async initSessions() {
        await SessionStore.init();
        const list = await SessionStore.list();
        if (list.length > 0) {
            list.sort((a, b) => b.createdAt - a.createdAt);
            const last = list[0];
            const session = await SessionStore.load(last.id);
            if (session) {
                this.sessionId = session.id;
                this.sessionCreatedAt = session.createdAt || Date.now();
                this.sessionTitle = session.title;
                this.entries = (session.entries && session.entries.length > 0) ? session.entries as any as SessionEntry[] : [];
                this.hasTitled = true;
                this.sessionPromptTokens = session.promptTokens || 0;
                this.sessionCompletionTokens = session.completionTokens || 0;
                this.sessionTotalDuration = session.totalDuration || 0;
                if (session.model) { this.modelSelect.value = session.model; }
                if (this.composer) {
                    this.composer.restoreHistory(session.messageHistory || []);
                }
                this.titleElement.textContent = session.title;
                this.updateTokenDisplay();
                this.renderLoadedSession(session);
                this.scrollToBottom();
                return;
            }
        }
        this.sessionId = SessionStore.newSessionId();
        this.sessionCreatedAt = Date.now();
        this.sessionTitle = this.defaultTitle;
        this.entries = [];
        this.showWelcome();
    }

    private toggleSessionMenu() {
        if (this.isRenderingSessionList) { return; }
        if (this.sessionPopup) {
            this.closeSessionMenu();
            return;
        }
        this.renderSessionList();
    }

    private closeSessionMenu() {
        document.querySelectorAll(".agent-session-popup").forEach(function (el) { el.remove(); });
        this.sessionPopup = null;
    }

    private async renderSessionList() {
        this.isRenderingSessionList = true;
        this.closeSessionMenu();
        try {
            const list = await SessionStore.list();
        list.sort((a, b) => b.createdAt - a.createdAt);

        this.sessionPopup = document.createElement("div");
        this.sessionPopup.className = "agent-session-popup b3-menu";

        let html = '<div class="b3-menu__items">';
        if (list.length === 0) {
            html += '<div class="b3-menu__item"><span class="b3-menu__label" style="text-align:center;color:var(--b3-theme-on-surface-light)">' + (window.siyuan.languages.emptyContent || "No sessions") + "</span></div>";
        } else {
            for (let i = 0; i < list.length; i++) {
                const s = list[i];
            const isActive = s.id === this.sessionId;
            html += '<div class="b3-menu__item' + (isActive ? " b3-menu__item--current" : "") + '" data-id="' + s.id + '">' +
                '<span class="b3-menu__label ariaLabel" data-position="east" aria-label="' + this.escapeHtml(s.title || this.defaultTitle) + '">' + this.escapeHtml(s.title || this.defaultTitle) + "</span>" +
                '<span class="agent-session-popup__actions">' +
                    '<svg class="agent-session-popup__rename ariaLabel" data-position="north" data-id="' + s.id + '" aria-label="' + window.siyuan.languages.rename + '"><use xlink:href="#iconEdit"></use></svg>' +
                    '<svg class="agent-session-popup__delete ariaLabel" data-position="north" data-id="' + s.id + '" aria-label="' + window.siyuan.languages.delete + '"><use xlink:href="#iconTrashcan"></use></svg>' +
                    "</span>" +
                "</div>";
            }
        }
        html += "</div>";

        this.sessionPopup.innerHTML = html;

        this.sessionPopup.querySelectorAll(".b3-menu__item").forEach((item) => {
            item.addEventListener("click", () => {
                const id = item.getAttribute("data-id") || "";
                if (id && id !== this.sessionId) {
                    this.closeSessionMenu();
                    this.switchSession(id);
                }
            });
        });
        this.sessionPopup.querySelectorAll(".agent-session-popup__delete").forEach((btn) => {
            btn.addEventListener("click", (e: MouseEvent) => {
                e.stopPropagation();
                const id = btn.getAttribute("data-id") || "";
                if (id) { this.deleteSession(id); }
            });
        });
        this.sessionPopup.querySelectorAll(".agent-session-popup__rename").forEach((btn) => {
            btn.addEventListener("click", (e: MouseEvent) => {
                e.stopPropagation();
                const id = btn.getAttribute("data-id") || "";
                if (id) {
                    const parent = btn.parentElement;
                    const row = parent ? parent.parentElement as HTMLElement : null;
                    if (row) { this.startRename(id, row); }
                }
            });
        });

        this.parent.panelElement.appendChild(this.sessionPopup);

        const btnRect = this.sessionMenuBtn.getBoundingClientRect();
        setPosition(this.sessionPopup, btnRect.right - 280, btnRect.bottom, btnRect.height, btnRect.width);

        this.sessionPopup.addEventListener("click", (e: MouseEvent) => {
            e.stopPropagation();
        });
        const closeOut = () => {
            this.closeSessionMenu();
            document.removeEventListener("click", closeOut);
        };
        setTimeout(() => {
            document.addEventListener("click", closeOut);
        }, 10);
        } finally {
            this.isRenderingSessionList = false;
        }
    }

    private startRename(id: string, rowEl: HTMLElement) {
        const titleEl = rowEl.querySelector(".b3-menu__label") as HTMLElement;
        const oldTitle = titleEl.textContent || "";
        const input = document.createElement("input");
        input.type = "text";
        input.value = oldTitle;
        input.className = "agent-session-popup__rename-input";
        titleEl.replaceWith(input);
        input.focus();
        input.select();
        input.addEventListener("blur", () => { this.finishRename(id, input.value, input, titleEl); });
        input.addEventListener("keydown", (e: KeyboardEvent) => {
            if (e.key === "Enter") { input.blur(); }
            if (e.key === "Escape") { input.value = oldTitle; input.blur(); }
        });
    }

    private async finishRename(id: string, newTitle: string, input: HTMLInputElement, titleEl: HTMLElement) {
        const title = newTitle.trim() || this.defaultTitle;
        input.replaceWith(titleEl);
        titleEl.textContent = title;
        await SessionStore.rename(id, title);
        if (id === this.sessionId) {
            this.sessionTitle = title;
            this.titleElement.textContent = title;
        }
    }

    private async saveSession() {
        if (this.entries.length === 0) { return; }
        const session: AgentSession = {
            id: this.sessionId,
            title: this.sessionTitle,
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
        this.flushThinkingStep();
        await this.saveSession();
        const session = await SessionStore.load(id);
        if (!session) { return; }
        this.sessionId = session.id;
        if (this.composer) {
            this.composer.clearHistory();
            this.composer.restoreHistory(session.messageHistory || []);
        }
        this.sessionCreatedAt = session.createdAt || Date.now();
        this.sessionTitle = session.title;
        this.entries = (session.entries && session.entries.length > 0) ? session.entries as any as SessionEntry[] : [];
        this.hasTitled = true;
        this.currentAIElement = null;
        this.currentContent = "";
        this.fullContent = "";
        this.sessionPromptTokens = session.promptTokens || 0;
        this.sessionCompletionTokens = session.completionTokens || 0;
        this.sessionTotalDuration = session.totalDuration || 0;
        if (session.model) { this.modelSelect.value = session.model; }
        if (this.tokenDisplayEl) {
            this.updateTokenDisplay();
        }
        this.messagesContainer.innerHTML = "";
        this.titleElement.textContent = session.title;
        this.renderLoadedSession(session);
        this.scrollToBottom();
    }

    private appendPersistedAssistant(content: string) {
        if (!content || !content.trim()) { return; }
        const el = document.createElement("div");
        el.className = "agent-chat__msg agent-chat__msg--ai";
        el.innerHTML = '<div class="agent-chat__bubble">' + (this.lute.MarkdownStr("", content) || this.escapeHtml(content)) + "</div>";
        this.messagesContainer.appendChild(el);
        this.addCopyButton(el, content);
    }

    private appendPersistedToolCalls(content: string, toolCalls: Array<{name: string; arguments: Record<string, unknown>; result?: string}>) {
        let hasRendered = false;
        for (let i = 0; i < toolCalls.length; i++) {
            const tc = toolCalls[i];
            if (tc.result && tc.name === "todo_write") {
                const rel = document.createElement("div");
                rel.className = "agent-chat__msg agent-chat__msg--tool";
                rel.innerHTML = this.renderTodoList(tc.result);
                this.messagesContainer.appendChild(rel);
                hasRendered = true;
            }
        }
        if (content && content.trim()) {
            this.appendPersistedAssistant(content);
            hasRendered = true;
        }
        if (!hasRendered) {
            // 无可见内容，不创建 air 空 DOM
            return;
        }
    }

    private renderLoadedSession(session: AgentSession) {
        for (let i = 0; i < session.entries.length; i++) {
            const entry = session.entries[i];
            switch (entry.type) {
                case "user":
                    this.appendUserMessage((entry as {content: string}).content);
                    break;
                case "thinking":
                    this.renderSingleThinkingCard(entry as {reasoning: string; text: string; toolCalls: Array<{name: string; result?: string}>; reasoningContent: string});
                    break;
                case "assistant":
                    if (entry.toolCalls && entry.toolCalls.length > 0) {
                        this.appendPersistedToolCalls((entry as {content: string}).content, entry.toolCalls as Array<{name: string; arguments: Record<string, unknown>; result?: string}>);
                    } else {
                        this.appendPersistedAssistant((entry as {content: string}).content);
                    }
                    break;
            }
        }
    }

    private async createSession() {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
        this.setStreaming(false);
        this.flushThinkingStep();
        await this.saveSession();
        this.sessionId = SessionStore.newSessionId();
        this.sessionCreatedAt = Date.now();
        if (this.composer) { this.composer.clearHistory(); }
        this.sessionTitle = this.defaultTitle;
        this.entries = [];
        this.hasTitled = false;
        this.currentAIElement = null;
        this.currentContent = "";
        this.fullContent = "";
        this.sessionPromptTokens = 0;
        this.sessionCompletionTokens = 0;
        this.sessionTotalDuration = 0;
        this.currentToolCalls = [];
        if (this.tokenDisplayEl) {
            this.tokenDisplayEl.classList.add("fn__none");
        }
        this.messagesContainer.innerHTML = "";
        this.titleElement.textContent = this.defaultTitle;
        if (this.composer) { this.composer.clear(); }
        if (this.composer) { this.composer.focus(); }
        this.showWelcome();
    }

    private async deleteSession(id: string) {
        await SessionStore.remove(id);
        const wasCurrent = id === this.sessionId;
        if (wasCurrent) {
            const list = await SessionStore.list();
            this.entries = [];
            if (list.length > 0) {
                this.sessionId = list[0].id;
                await this.switchSession(list[0].id);
            } else {
                this.sessionId = SessionStore.newSessionId();
                await this.createSession();
            }
        }

        // Remove the deleted row from popup DOM directly (no re-render flash)
        const row = this.sessionPopup?.querySelector('.b3-menu__item[data-id="' + id + '"]');
        if (row) {
            row.remove();
        }
        const items = this.sessionPopup?.querySelectorAll(".b3-menu__item");
        if (items && items.length === 0) {
            const listEl = this.sessionPopup?.querySelector(".b3-menu__items");
            if (listEl) {
                listEl.innerHTML = '<div class="b3-menu__item"><span class="b3-menu__label" style="text-align:center;color:var(--b3-theme-on-surface-light)">' + (window.siyuan.languages.emptyContent || "No sessions") + "</span></div>";
            }
        }
        if (wasCurrent && this.sessionPopup) {
            this.highlightCurrentSession();
        }
    }

    private highlightCurrentSession() {
        const items = this.sessionPopup?.querySelectorAll(".b3-menu__item");
        if (!items) { return; }
        for (let i = 0; i < items.length; i++) {
            const item = items[i] as HTMLElement;
            const sid = item.getAttribute("data-id");
            item.classList.toggle("b3-menu__item--current", sid === this.sessionId);
        }
    }

    private sendMessage() {
        if (!this.composer) { return; }
        const sendData = this.composer.getSendData();
        const text = sendData.text;
        const refs = sendData.references;
        if (!text || this.isStreaming) {
            return;
        }

        this.setStreaming(true);
        this.composer.clear();

        this.entries.push({type: "user", content: text});
        this.appendUserMessage(text);
        if (this.composer) { this.composer.pushHistory(text); }

        if (!this.hasTitled && this.entries.length === 1) {
            this.hasTitled = true;
            this.generateTitle();
        }

        this.requestStartTime = Date.now();

        const apiMessages = this.entries.filter((e) => e.type === "user" || e.type === "assistant").map((e) => ({role: e.type === "user" ? "user" as const : "assistant" as const, content: (e as {content: string}).content}));

        this.abortController = new AbortController();
        const requestSessionId = this.sessionId;

        fetchAgentSSE(
            apiMessages,
            window.siyuan.config.appearance.lang,
            refs,
            (event: ISSEResult) => {
                if (this.sessionId !== requestSessionId) { return; }
                this.handleSSEEvent(event);
            },
            (err: Error) => {
                if (this.sessionId !== requestSessionId) { return; }
                this.handleError(err);
            },
            this.abortController.signal,
            this.sessionId,
            this.getSelectedModel(),
        );
    }

    private handleSSEEvent(event: ISSEResult) {
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
                    this.finishResponse();
                    break;
                case "usage":
                    this.appendUsage(event.promptTokens, event.completionTokens);
                    break;
                case "error":
                    this.appendError(event.message);
                    this.setStreaming(false);
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
            }
        } catch (e) {
            console.error("agent SSE event handler error:", e, event);
            this.setStreaming(false);
        }
    }

    private handleError(err: Error) {
        this.flushTokenUpdate();
        this.appendError(err.message);
        this.setStreaming(false);
    }

    private appendUserMessage(text: string) {
        const el = document.createElement("div");
        el.className = "agent-chat__msg agent-chat__msg--user";
        el.innerHTML = '<div class="agent-chat__bubble">' + this.escapeHtml(text) + "</div>";
        this.messagesContainer.appendChild(el);
        this.scrollToBottom();
    }

    private createAIMessagePlaceholder(): HTMLElement {
        this.currentContent = "";
        const el = document.createElement("div");
        el.className = "agent-chat__msg agent-chat__msg--ai";
        el.innerHTML = '<div class="agent-chat__bubble agent-chat__bubble--streaming"></div>';
        this.messagesContainer.appendChild(el);
        this.scrollToBottom();
        return el;
    }

    private pendingTokenUpdate = false;
    private rafId = 0;

    private appendToken(token: string) {
        if (!this.currentAIElement) {
            this.finishActiveThinking();
            this.currentAIElement = this.createAIMessagePlaceholder();
        }
        this.currentContent += token;
        this.fullContent += token;
        this.scrollToBottom();

        if (!this.pendingTokenUpdate) {
            this.pendingTokenUpdate = true;
            this.rafId = requestAnimationFrame(() => {
                this.pendingTokenUpdate = false;
                const bubble = this.currentAIElement?.querySelector(".agent-chat__bubble") as HTMLElement;
                if (bubble) {
                    bubble.innerHTML = this.lute.MarkdownStr("", this.currentContent) || this.escapeHtml(this.currentContent);
                }
            });
        }
    }

    private flushTokenUpdate() {
        if (this.pendingTokenUpdate) {
            this.pendingTokenUpdate = false;
            cancelAnimationFrame(this.rafId);
            const bubble = this.currentAIElement?.querySelector(".agent-chat__bubble") as HTMLElement;
            if (bubble) {
                bubble.innerHTML = this.lute.MarkdownStr("", this.currentContent) || this.escapeHtml(this.currentContent);
            }
        }
    }

    private appendToolResult(name: string, result: string) {
        if (name !== "todo_write") { return; }

        const el = document.createElement("div");
        el.className = "agent-chat__msg agent-chat__msg--tool";
        el.innerHTML = this.renderTodoList(result);
        this.insertBeforeAI(el);
        this.scrollToBottom();
    }

    private renderTodoList(result: string): string {
        const lines = result.split("\n");
        let html = '<div class="agent-chat__tool-card agent-chat__tool-card--todo">' +
    '<div class="agent-chat__todo-header">' +
        '<svg class="agent-chat__tool-icon"><use xlink:href="#iconList"></use></svg>' +
        '<span class="agent-chat__tool-title">' + (window.siyuan.languages.agentTodoList || "Todo List") + "</span>" +
    "</div>" +
    '<div class="agent-chat__todo-items">';
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.startsWith("- [x]")) {
                html += '<div class="agent-chat__todo-item agent-chat__todo-item--completed"><svg class="agent-chat__todo-status"><use xlink:href="#iconCheck"></use></svg>' + this.escapeHtml(line.substring(5).trim()) + "</div>";
            } else if (line.startsWith("- [/]")) {
                html += '<div class="agent-chat__todo-item agent-chat__todo-item--in-progress"><svg class="agent-chat__todo-status"><use xlink:href="#iconRefresh"></use></svg>' + this.escapeHtml(line.substring(5).trim()) + "</div>";
            } else if (line.startsWith("- [-]")) {
                html += '<div class="agent-chat__todo-item agent-chat__todo-item--cancelled"><svg class="agent-chat__todo-status"><use xlink:href="#iconCloseRound"></use></svg>' + this.escapeHtml(line.substring(5).trim()) + "</div>";
            } else if (line.startsWith("- [ ]")) {
                html += '<div class="agent-chat__todo-item agent-chat__todo-item--pending"><svg class="agent-chat__todo-status"><use xlink:href="#iconUncheck"></use></svg>' + this.escapeHtml(line.substring(5).trim()) + "</div>";
            }
        }
        html += "</div></div>";
        return html;
    }

    private appendThinking(reasoning: string) {
        if (this.currentThinkingText) {
            const tc = this.currentToolCalls.map(function (t) { return {name: t.name, result: t.result}; });
            this.entries.push({
                type: "thinking",
                reasoning: this.currentThinkingReasoning,
                text: this.currentThinkingText,
                toolCalls: tc,
                reasoningContent: this.currentThinkingReasoningContent,
            });
        }
        this.finishActiveThinking();
        this.currentThinkingText = "";
        this.currentThinkingReasoning = reasoning;
        this.currentThinkingReasoningContent = "";
        const L = window.siyuan.languages;
        let text = reasoning;
        let roundLabel = "";
        if (reasoning === "analyzing") {
            text = L.agentThinkingAnalyzing || "Analyzing your request...";
            roundLabel = "Step 1";
        } else if (reasoning === "processing") {
            text = L.agentThinkingProcessing || "Processing results...";
            roundLabel = "Continuing...";
        }

        this.currentThinkingText = text;

        let detailLines = "";
        if (reasoning === "processing" && this.currentToolCalls.length > 0) {
            detailLines += '<div class="agent-chat__thinking-summary">' + (L.agentToolCall || "Tool call") + "s:</div>";
            for (let i = 0; i < this.currentToolCalls.length; i++) {
                const tc = this.currentToolCalls[i];
                const statusSvg = tc.result
                    ? ' <svg class="agent-chat__thinking-icon"><use xlink:href="#iconCheck"></use></svg>'
                    : ' <svg class="agent-chat__thinking-icon"><use xlink:href="#iconUncheck"></use></svg>';
                detailLines += '<div class="agent-chat__thinking-item">' + this.escapeHtml(tc.name) + statusSvg + "</div>";
            }
        }

        const bodyHTML = '<div class="agent-chat__thinking-body fn__none">' +
            '<div class="agent-chat__thinking-round">' + this.escapeHtml(roundLabel) + "</div>" +
            detailLines +
        "</div>";

        const el = document.createElement("div");
        el.className = "agent-chat__msg agent-chat__msg--thinking";
        el.innerHTML = '<div class="agent-chat__thinking-card">' +
    '<div class="agent-chat__thinking-header">' +
        '<span class="agent-chat__thinking-dot"></span>' +
        '<span class="agent-chat__thinking-text">' + this.escapeHtml(text) + "</span>" +
        '<span class="agent-chat__thinking-arrow">' +
            '<svg class="agent-chat__thinking-arrow--expand"><use xlink:href="#iconExpand"></use></svg>' +
            '<svg class="agent-chat__thinking-arrow--contract fn__none"><use xlink:href="#iconContract"></use></svg>' +
        "</span>" +
    "</div>" +
    bodyHTML +
"</div>";

        if (reasoning === "processing" && this.currentAIElement) {
            if (this.currentContent) {
                this.finalizeCurrentRound();
            } else {
                this.currentAIElement.remove();
                this.currentAIElement = null;
            }
        }

        const header = el.querySelector(".agent-chat__thinking-header") as HTMLElement;
        const body = el.querySelector(".agent-chat__thinking-body") as HTMLElement;
        const expandIcon = el.querySelector(".agent-chat__thinking-arrow--expand") as HTMLElement;
        const contractIcon = el.querySelector(".agent-chat__thinking-arrow--contract") as HTMLElement;
        header.addEventListener("click", function () {
            body.classList.toggle("fn__none");
            const isHidden = body.classList.contains("fn__none");
            expandIcon.classList.toggle("fn__none", !isHidden);
            contractIcon.classList.toggle("fn__none", isHidden);
        });
        this.insertBeforeAI(el);
        this.scrollToBottom();
    }

    private appendReasoning(token: string) {
        this.currentThinkingReasoningContent += token;
        const thinking = this.messagesContainer.querySelector(".agent-chat__msg--thinking:last-child .agent-chat__thinking-body");
        if (!thinking) { return; }
        thinking.innerHTML += token;
    }

    private finalizeCurrentRound() {
        if (!this.currentAIElement) {
            return;
        }
        if (this.currentContent) {
            this.entries.push({type: "assistant", content: this.currentContent});
        }
        const bubble = this.currentAIElement.querySelector(".agent-chat__bubble") as HTMLElement;
        if (bubble) {
            bubble.classList.remove("agent-chat__bubble--streaming");
        }
        this.currentAIElement = null;
        this.currentContent = "";
    }

    private addCopyButton(el: HTMLElement, contentOverride?: string) {
        const content = contentOverride || this.fullContent || el.querySelector(".agent-chat__bubble")?.textContent || "";
        const L = window.siyuan.languages;

        const actions = document.createElement("div");
        actions.className = "agent-chat__msg-actions";

        const copyBtn = document.createElement("span");
        copyBtn.className = "block__icon block__icon--show ariaLabel";
        copyBtn.setAttribute("data-position", "north");
        copyBtn.setAttribute("aria-label", L.copy);
        copyBtn.innerHTML = '<svg><use xlink:href="#iconCopy"></use></svg>';
        copyBtn.addEventListener("click", (e: Event) => {
            e.stopPropagation();
            navigator.clipboard.writeText(content).catch(() => {});
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

    private regenerateResponse() {
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
            if (all[i].classList.contains("agent-chat__msg--user")) { break; }
            all[i].remove();
        }
        this.currentAIElement = null;
        this.currentContent = "";
        this.fullContent = "";
        this.currentToolCalls = [];

        // Re-submit
        this.setStreaming(true);
        const apiMessages = this.entries.filter((e) => e.type === "user" || e.type === "assistant").map((e) => ({role: e.type === "user" ? "user" as const : "assistant" as const, content: (e as {content: string}).content}));
        this.abortController = new AbortController();
        const requestSessionId = this.sessionId;
        fetchAgentSSE(
            apiMessages,
            window.siyuan.config.appearance.lang,
            [],
            (event: ISSEResult) => {
                if (this.sessionId !== requestSessionId) { return; }
                this.handleSSEEvent(event);
            },
            (err: Error) => {
                if (this.sessionId !== requestSessionId) { return; }
                this.handleError(err);
            },
            this.abortController.signal,
            this.sessionId,
            this.getSelectedModel(),
        );
    }

    private finishResponse() {
        if (!this.currentAIElement) {
            if (this.currentToolCalls.length === 0) {
                this.setStreaming(false);
                return;
            }
            this.flushThinkingStep();
            this.entries.push({type: "assistant", content: "", toolCalls: this.currentToolCalls.slice()});
            this.currentToolCalls = [];
            if (this.requestStartTime) {
                this.sessionTotalDuration += Date.now() - this.requestStartTime;
                this.requestStartTime = 0;
            }
            this.updateTokenDisplay();
            this.setStreaming(false);
            this.saveSession();
            return;
        }
        this.flushTokenUpdate();
        if (!this.currentContent) {
            this.currentAIElement.remove();
            this.currentAIElement = null;
            this.currentContent = "";
            this.fullContent = "";
            if (this.currentToolCalls.length > 0) {
                this.flushThinkingStep();
                this.entries.push({type: "assistant", content: "", toolCalls: this.currentToolCalls.slice()});
            }
            this.currentToolCalls = [];
            if (this.requestStartTime) {
                this.sessionTotalDuration += Date.now() - this.requestStartTime;
                this.requestStartTime = 0;
            }
            this.updateTokenDisplay();
            this.setStreaming(false);
            this.saveSession();
            return;
        }
        const bubble = this.currentAIElement.querySelector(".agent-chat__bubble") as HTMLElement;
        if (bubble) {
            bubble.classList.remove("agent-chat__bubble--streaming");
        }
        this.addCopyButton(this.currentAIElement);
        this.entries.push({type: "assistant", content: this.currentContent || " ", toolCalls: this.currentToolCalls.length > 0 ? this.currentToolCalls.slice() : undefined});
        this.currentAIElement = null;
        this.currentContent = "";
        this.fullContent = "";
        this.flushThinkingStep();
        this.currentToolCalls = [];
        if (this.requestStartTime) {
            this.sessionTotalDuration += Date.now() - this.requestStartTime;
                this.requestStartTime = 0;
            }
            this.updateTokenDisplay();
            this.setStreaming(false);

        this.saveSession();
    }

    private flushThinkingStep() {
        if (!this.currentThinkingText) {
            return;
        }
        const tc = this.currentToolCalls.map(function (t) { return {name: t.name, result: t.result}; });
        this.entries.push({
            type: "thinking",
            reasoning: this.currentThinkingReasoning,
            text: this.currentThinkingText,
            toolCalls: tc,
            reasoningContent: this.currentThinkingReasoningContent,
        });
        this.currentThinkingText = "";
    }

    private generateTitle() {
        const firstUser = this.entries.find((e) => e.type === "user");
        const firstMsg = firstUser ? (firstUser as {content: string}).content.slice(0, 500) : "";
        fetch("/api/ai/agent/title", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({message: firstMsg}),
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

    private appendError(message: string) {
        this.clearThinking();
        if (this.currentAIElement && !this.currentContent) {
            this.currentAIElement.remove();
        }
        this.currentAIElement = null;
        const el = document.createElement("div");
        el.className = "agent-chat__msg agent-chat__msg--error";
        el.innerHTML = '<div class="agent-chat__bubble agent-chat__bubble--error">' + this.escapeHtml(message) + "</div>";
        this.messagesContainer.appendChild(el);
        this.scrollToBottom();
        this.flushThinkingStep();
        this.saveSession();
    }

    private appendRetry(attempt: number, maxRetries: number) {
        this.clearThinking();
        const el = document.createElement("div");
        el.className = "agent-chat__msg agent-chat__msg--thinking";
        el.innerHTML = '<div class="agent-chat__thinking-card">' +
    '<div class="agent-chat__thinking-header">' +
        '<span class="agent-chat__thinking-dot"></span>' +
        '<span class="agent-chat__thinking-text">' + this.escapeHtml("Retrying (" + attempt + "/" + maxRetries + ")...") + "</span>" +
    "</div>" +
"</div>";
        this.insertBeforeAI(el);
        this.scrollToBottom();
    }

    private stopGeneration() {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
        this.flushTokenUpdate();
        if (this.currentAIElement) {
            const bubble = this.currentAIElement.querySelector(".agent-chat__bubble") as HTMLElement;
            if (bubble) {
                bubble.classList.remove("agent-chat__bubble--streaming");
            }
            if (this.currentContent) {
                this.entries.push({type: "assistant", content: this.currentContent || " ", toolCalls: this.currentToolCalls.length > 0 ? this.currentToolCalls.slice() : undefined});
            }
        this.currentAIElement = null;
        this.currentContent = "";
        this.fullContent = "";
        this.currentToolCalls = [];
        }
        if (this.requestStartTime) {
            this.sessionTotalDuration += Date.now() - this.requestStartTime;
                this.requestStartTime = 0;
            }
            this.updateTokenDisplay();
            this.setStreaming(false);
        this.flushThinkingStep();
        this.saveSession();
    }

    private insertBeforeAI(el: HTMLElement) {
        if (this.currentAIElement) {
            this.messagesContainer.insertBefore(el, this.currentAIElement);
        } else {
            this.messagesContainer.appendChild(el);
        }
    }

    private appendConfirm(name: string, args: Record<string, unknown>, confirmID: string) {
        const L = window.siyuan.languages;
        const el = document.createElement("div");
        el.className = "agent-chat__msg agent-chat__msg--confirm";
        const argsStr = JSON.stringify(args, null, 2);
        const action = (args.action as string) || name;
        const desc = (L.agentConfirmDesc || "Confirm {action} on: {name}?").replace("{action}", this.escapeHtml(action)).replace("{name}", this.escapeHtml(name));
        el.innerHTML = '<div class="agent-chat__confirm-card">' +
    '<div class="agent-chat__confirm-header"><svg class="agent-chat__confirm-icon"><use xlink:href="#iconInfo"></use></svg> ' + desc + "</div>" +
    '<pre class="agent-chat__confirm-args">' + this.escapeHtml(argsStr) + "</pre>" +
    '<div class="agent-chat__confirm-actions">' +
        '<button class="b3-button b3-button--cancel agent-chat__confirm-reject">' + (L.agentConfirmReject || "Reject") + "</button>" +
        '<button class="b3-button b3-button--text agent-chat__confirm-approve">' + (L.agentConfirmApprove || "Approve") + "</button>" +
        '<button class="b3-button b3-button--text agent-chat__confirm-always ariaLabel" data-position="n" aria-label="' + (L.agentConfirmAlwaysDesc || "Session Allow") + '">' + (L.agentConfirmAlways || "Session Allow") + "</button>" +
    "</div>" +
"</div>";
        const approveBtn = el.querySelector(".agent-chat__confirm-approve");
        if (approveBtn) { approveBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            el.classList.add("agent-chat__msg--confirmed");
            const btns = el.querySelector(".agent-chat__confirm-actions") as HTMLElement;
            if (btns) { btns.innerHTML = '<span class="agent-chat__confirm-done">' + (L.agentConfirmApprove || "Approved") + "</span>"; }
            this.postConfirm(confirmID, true);
        }); }
        const rejectBtn = el.querySelector(".agent-chat__confirm-reject");
        if (rejectBtn) { rejectBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            el.classList.add("agent-chat__msg--confirmed");
            const btns = el.querySelector(".agent-chat__confirm-actions") as HTMLElement;
            if (btns) { btns.innerHTML = '<span class="agent-chat__confirm-done">' + (L.agentConfirmReject || "Rejected") + "</span>"; }
            this.postConfirm(confirmID, false);
        }); }
        const alwaysBtn = el.querySelector(".agent-chat__confirm-always");
        if (alwaysBtn) { alwaysBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            el.classList.add("agent-chat__msg--confirmed");
            const btns = el.querySelector(".agent-chat__confirm-actions") as HTMLElement;
            if (btns) { btns.innerHTML = '<span class="agent-chat__confirm-done">' + (L.agentConfirmAlways || "Session Allow") + "</span>"; }
            this.postConfirm(confirmID, true, true);
        }); }
        this.insertBeforeAI(el);
        this.scrollToBottom();
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
    }

    private appendQuestion(questionID: string, args: Record<string, unknown>) {
        const L = window.siyuan.languages;
        const rawQuestions = args.questions as Array<Record<string, unknown>>;
        if (!rawQuestions || rawQuestions.length === 0) { return; }

        const el = document.createElement("div");
        el.className = "agent-chat__msg agent-chat__msg--question";
        el.setAttribute("data-question-id", questionID);

        let html = '<div class="agent-chat__question-card">';
        for (let qi = 0; qi < rawQuestions.length; qi++) {
            const q = rawQuestions[qi];
            const header = (q.header as string) || "";
            const question = (q.question as string) || "";
            const options = q.options as Array<Record<string, unknown>> || [];
            const multiple = q.multiple as boolean || false;
            const custom = q.custom as boolean !== false;

            html += '<div class="agent-chat__question-item">';
            if (header) {
                html += '<div class="agent-chat__question-header">' + this.escapeHtml(header) + "</div>";
            }
            if (question) {
                html += '<div class="agent-chat__question-text">' + this.escapeHtml(question) + "</div>";
            }
            html += '<div class="agent-chat__question-options" data-qi="' + qi + '">';
            const inputType = multiple ? "checkbox" : "radio";
            const inputName = "q_" + questionID + "_" + qi;
            for (let oi = 0; oi < options.length; oi++) {
                const opt = options[oi];
                const label = (opt.label as string) || "";
                const desc = (opt.description as string) || "";
                html += '<label class="agent-chat__question-option">' +
                    '<input type="' + inputType + '" name="' + inputName + '" value="' + this.escapeHtml(label) + '">' +
                    '<span class="agent-chat__question-option-label">' + this.escapeHtml(label) + "</span>";
                if (desc) {
                    html += '<span class="agent-chat__question-option-desc">' + this.escapeHtml(desc) + "</span>";
                }
                html += "</label>";
            }
            if (custom) {
                html += '<input class="agent-chat__question-custom" placeholder="' + (L.agentQuestionCustom || "Type your own answer...") + '" data-qi="' + qi + '">';
            }
            html += "</div></div>";
        }
        html += '<div class="agent-chat__question-submit">' +
            '<button class="b3-button b3-button--text agent-chat__question-submit-btn">' +
            (L.agentQuestionSubmit || "Submit") + "</button>" +
        "</div></div>";

        el.innerHTML = html;

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
        this.scrollToBottom();
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

    private renderSingleThinkingCard(step: {reasoning: string; text: string; toolCalls: Array<{name: string; result?: string}>; reasoningContent: string}) {
        let detail = "";
        if (step.toolCalls.length > 0) {
            detail += '<div class="agent-chat__thinking-summary">Tool calls:</div>';
            for (let j = 0; j < step.toolCalls.length; j++) {
                const tc = step.toolCalls[j];
                const statusSvg = tc.result
                    ? ' <svg class="agent-chat__thinking-icon"><use xlink:href="#iconCheck"></use></svg>'
                    : ' <svg class="agent-chat__thinking-icon"><use xlink:href="#iconUncheck"></use></svg>';
                detail += '<div class="agent-chat__thinking-item">' + this.escapeHtml(tc.name) + statusSvg + "</div>";
            }
        }
        if (step.reasoningContent) {
            detail += '<div class="agent-chat__thinking-round">Reasoning:</div>';
            detail += "<div>" + this.escapeHtml(step.reasoningContent) + "</div>";
        }

        const el = document.createElement("div");
        el.className = "agent-chat__msg agent-chat__msg--thinking agent-chat__msg--thinking-done";
        el.innerHTML = '<div class="agent-chat__thinking-card">' +
    '<div class="agent-chat__thinking-header">' +
        '<span class="agent-chat__thinking-dot fn__none"></span>' +
        '<span class="agent-chat__thinking-text">' + this.escapeHtml(step.text) + "</span>" +
        '<span class="agent-chat__thinking-arrow">' +
            '<svg class="agent-chat__thinking-arrow--expand"><use xlink:href="#iconExpand"></use></svg>' +
            '<svg class="agent-chat__thinking-arrow--contract fn__none"><use xlink:href="#iconContract"></use></svg>' +
        "</span>" +
    "</div>" +
    '<div class="agent-chat__thinking-body fn__none">' +
        detail +
    "</div>" +
"</div>";

        const header = el.querySelector(".agent-chat__thinking-header") as HTMLElement;
        const body = el.querySelector(".agent-chat__thinking-body") as HTMLElement;
        const expandIcon = el.querySelector(".agent-chat__thinking-arrow--expand") as HTMLElement;
        const contractIcon = el.querySelector(".agent-chat__thinking-arrow--contract") as HTMLElement;
        header.addEventListener("click", function () {
            body.classList.toggle("fn__none");
            const isHidden = body.classList.contains("fn__none");
            expandIcon.classList.toggle("fn__none", !isHidden);
            contractIcon.classList.toggle("fn__none", isHidden);
        });
        this.messagesContainer.appendChild(el);
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
        this.sessionPromptTokens += promptTokens;
        this.sessionCompletionTokens += completionTokens;
        this.updateTokenDisplay();
    }

    private clearThinking() {
        const items = this.messagesContainer.querySelectorAll(".agent-chat__msg--thinking");
        for (let i = 0; i < items.length; i++) {
            items[i].remove();
        }
    }

    private finishActiveThinking() {
        const items = this.messagesContainer.querySelectorAll(".agent-chat__msg--thinking");
        for (let i = 0; i < items.length; i++) {
            const el = items[i] as HTMLElement;
            el.classList.add("agent-chat__msg--thinking-done");
            const dot = el.querySelector(".agent-chat__thinking-dot");
            if (dot) { dot.classList.add("fn__none"); }
            const textEl = el.querySelector(".agent-chat__thinking-text");
            if (textEl) {
                const raw = textEl.textContent || "";
                if (raw.indexOf("分析") >= 0) { textEl.textContent = raw.replace("正在分析", "已分析"); }
                else if (raw.indexOf("处理") >= 0) { textEl.textContent = raw.replace("正在处理", "已处理"); }
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

    private scrollToBottom() {
        requestAnimationFrame(() => {
            this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
        });
    }

    private escapeHtml(text: string): string {
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    }
}
