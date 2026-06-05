import {Tab} from "../Tab";
import {Model} from "../Model";
import {App} from "../../index";
import {fetchAgentSSE, ISSEResult} from "../../util/agentSSE";
import {mountComposer} from "./AgentComposer";
import {AgentSession, SessionStore} from "./SessionStore";
import {getDockByType} from "../tabUtil";
import {updateHotkeyAfterTip} from "../../protyle/util/compatibility";

interface IAgentMessage {
    role: "user" | "assistant";
    content: string;
    toolCalls?: Array<{
        name: string;
        arguments: Record<string, unknown>;
        result?: string;
    }>;
}

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
    private messages: IAgentMessage[] = [];
    private hasTitled = false;
    private isStreaming = false;
    private currentAIElement: HTMLElement | null = null;
    private lute: Lute;
    private currentContent = "";
    private fullContent = "";
    private sessionPromptTokens = 0;
    private sessionCompletionTokens = 0;
    private sessionTotalDuration = 0;
    private requestStartTime = 0;
    private tokenDisplayEl: HTMLElement;
    private defaultTitle = "";
    private currentToolCalls: Array<{name: string; arguments: Record<string, unknown>; result?: string}> = [];
    private abortController: AbortController | null = null;

    constructor(app: App, tab: Tab) {
        super({app: app, id: tab.id});
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
            '<span class="agent-chat__tokens fn__none"></span>' +
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

        const self = this;
        this.composer = mountComposer(this.composerHost, function () { self.sendMessage(); });
        this.initSessions();
    }

    private showWelcome() {
        const L = window.siyuan.languages;
        const html = '<div class="agent-welcome">' +
            '<div class="agent-welcome__greeting">' + (L.agentWelcomeGreeting || "Hello, I am SiYuan Agent") + "</div>" +
            '<div class="agent-welcome__desc">' + (L.agentWelcomeDesc || "I can search, read, create, and modify your notes") + "</div>" +
            '<div class="agent-welcome__examples">' +
                '<div class="agent-welcome__example" data-text="' + this.escapeHtml(L.agentExample1 || "") + '">' + (L.agentExample1 || "") + "</div>" +
                '<div class="agent-welcome__example" data-text="' + this.escapeHtml(L.agentExample2 || "") + '">' + (L.agentExample2 || "") + "</div>" +
                '<div class="agent-welcome__example" data-text="' + this.escapeHtml(L.agentExample3 || "") + '">' + (L.agentExample3 || "") + "</div>" +
            "</div>" +
        "</div>";
        this.messagesContainer.innerHTML = html;
        const self = this;
        const examples = this.messagesContainer.querySelectorAll(".agent-welcome__example");
        for (let i = 0; i < examples.length; i++) {
            examples[i].addEventListener("click", function (ex: HTMLElement) {
                return function () {
                    const text = ex.getAttribute("data-text") || "";
                    if (text && self.composer) {
                        // 不支持 setSendText，直接用 sendMessage 发送
                        self.messages.push({role: "user", content: text});
                        self.appendUserMessage(text);
                        self.setStreaming(true);
                        const apiMessages = self.messages.map(function (m) { return {role: m.role as "user" | "assistant", content: m.content}; });
                        self.abortController = new AbortController();
                        fetchAgentSSE(apiMessages, window.siyuan.config.appearance.lang, [],
                            function (event: ISSEResult) { self.handleSSEEvent(event); },
                            function (err: Error) { self.handleError(err); },
                            self.abortController.signal,
                            self.sessionId);
                    }
                };
            }(examples[i] as HTMLElement));
        }
    }

    private bindEvents() {
        const self = this;
        this.sendBtn.addEventListener("click", function () { self.sendMessage(); });
        this.stopBtn.addEventListener("click", function () { self.stopGeneration(); });
        this.newSessionBtn.addEventListener("click", function () { self.createSession(); });
        this.sessionMenuBtn.addEventListener("click", function (e: MouseEvent) {
            e.stopPropagation();
            self.toggleSessionMenu();
        });

        this.parent.panelElement.addEventListener("click", function (e: MouseEvent) {
            const t = e.target as HTMLElement;
            if (t.closest(".agent-chat__msg")) { return; }
            if (t.closest(".agent-chat__header")) { return; }
            if (t.closest(".agent-session-popup")) { return; }
            if (t.closest('[data-type="min"]')) {
                getDockByType("agentChat").toggleModel("agentChat", false, true);
                return;
            }
            if (self.composer) { self.composer.focus(); }
        });
    }

    private async initSessions() {
        await SessionStore.init();
        const list = await SessionStore.list();
        if (list.length > 0) {
            list.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
            const last = list[0];
            const session = await SessionStore.load(last.id);
            if (session) {
                this.sessionId = session.id;
                this.sessionTitle = session.title;
                this.messages = session.messages as IAgentMessage[];
                this.hasTitled = true;
                this.sessionPromptTokens = session.promptTokens || 0;
                this.sessionCompletionTokens = session.completionTokens || 0;
                this.sessionTotalDuration = session.totalDuration || 0;
                this.titleElement.textContent = session.title;
                this.updateTokenDisplay();
                for (let i = 0; i < session.messages.length; i++) {
                    const msg = session.messages[i];
                    if (msg.role === "user") {
                        this.appendUserMessage(msg.content);
                    } else if (msg.role === "assistant") {
                        if (msg.toolCalls && msg.toolCalls.length > 0) {
                            this.appendPersistedToolCalls(msg.content, msg.toolCalls);
                        } else {
                            this.appendPersistedAssistant(msg.content);
                        }
                    }
                }
                this.scrollToBottom();
                return;
            }
        }
        this.sessionId = SessionStore.newSessionId();
        this.sessionTitle = this.defaultTitle;
        this.messages = [];
        this.showWelcome();
    }

    private toggleSessionMenu() {
        if (this.sessionPopup) {
            this.closeSessionMenu();
            return;
        }
        const self = this;
        this.renderSessionList();
    }

    private closeSessionMenu() {
        if (this.sessionPopup) {
            this.sessionPopup.remove();
            this.sessionPopup = null;
        }
    }

    private async renderSessionList() {
        const self = this;
        this.closeSessionMenu();
        const list = await SessionStore.list();
        list.sort(function (a, b) { return b.updatedAt - a.updatedAt; });

        this.sessionPopup = document.createElement("div");
        this.sessionPopup.className = "agent-session-popup";

        let html = '<div class="agent-session-popup__list">';
        if (list.length === 0) {
            html += '<div class="agent-session-popup__empty">' + (window.siyuan.languages.emptyContent || "No sessions") + "</div>";
        } else {
            for (let i = 0; i < list.length; i++) {
                const s = list[i];
            const isActive = s.id === this.sessionId;
            html += '<div class="agent-session-popup__item' + (isActive ? " agent-session-popup__item--active" : "") + '" data-id="' + s.id + '">' +
                '<span class="agent-session-popup__title">' + this.escapeHtml(s.title || this.defaultTitle) + "</span>" +
                '<span class="agent-session-popup__actions">' +
                    '<span class="agent-session-popup__rename" data-id="' + s.id + '">&#9998;</span>' +
                    '<span class="agent-session-popup__delete" data-id="' + s.id + '">&#10005;</span>' +
                    "</span>" +
                "</div>";
            }
        }
        html += "</div>";

        this.sessionPopup.innerHTML = html;

        this.sessionPopup.querySelectorAll(".agent-session-popup__item").forEach(function (item) {
            item.addEventListener("click", function (e) {
                const id = item.getAttribute("data-id") || "";
                if (id && id !== self.sessionId) {
                    self.switchSession(id);
                    self.closeSessionMenu();
                }
            });
        });
        this.sessionPopup.querySelectorAll(".agent-session-popup__delete").forEach(function (btn) {
            btn.addEventListener("click", function (e: MouseEvent) {
                e.stopPropagation();
                const id = btn.getAttribute("data-id") || "";
                if (id) { self.deleteSession(id); }
            });
        });
        this.sessionPopup.querySelectorAll(".agent-session-popup__rename").forEach(function (btn) {
            btn.addEventListener("click", function (e: MouseEvent) {
                e.stopPropagation();
                const id = btn.getAttribute("data-id") || "";
                if (id) {
                    const parent = btn.parentElement;
                    const row = parent ? parent.parentElement as HTMLElement : null;
                    if (row) { self.startRename(id, row); }
                }
            });
        });

        this.parent.panelElement.appendChild(this.sessionPopup);

        const self2 = this;
        this.sessionPopup.addEventListener("click", function (e: MouseEvent) {
            e.stopPropagation();
        });
        setTimeout(function () {
            document.addEventListener("click", function closeOut() {
                self2.closeSessionMenu();
                document.removeEventListener("click", closeOut);
            });
        }, 10);
    }

    private startRename(id: string, rowEl: HTMLElement) {
        const self = this;
        const titleEl = rowEl.querySelector(".agent-session-popup__title") as HTMLElement;
        const oldTitle = titleEl.textContent || "";
        const input = document.createElement("input");
        input.type = "text";
        input.value = oldTitle;
        input.className = "agent-session-popup__rename-input";
        titleEl.replaceWith(input);
        input.focus();
        input.select();
        input.addEventListener("blur", function () { self.finishRename(id, input.value, input, titleEl); });
        input.addEventListener("keydown", function (e: KeyboardEvent) {
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
        if (this.messages.length === 0) { return; }
        const session: AgentSession = {
            id: this.sessionId,
            title: this.sessionTitle,
            messages: this.messages.slice(),
            promptTokens: this.sessionPromptTokens,
            completionTokens: this.sessionCompletionTokens,
            totalDuration: this.sessionTotalDuration,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
        await SessionStore.save(session);
    }

    private async switchSession(id: string) {
        await this.saveSession();
        const session = await SessionStore.load(id);
        if (!session) { return; }
        this.sessionId = session.id;
        this.sessionTitle = session.title;
        this.messages = session.messages as IAgentMessage[];
        this.hasTitled = true;
        this.currentAIElement = null;
        this.currentContent = "";
        this.fullContent = "";
        this.sessionPromptTokens = session.promptTokens || 0;
        this.sessionCompletionTokens = session.completionTokens || 0;
        this.sessionTotalDuration = session.totalDuration || 0;
        if (this.tokenDisplayEl) {
            this.updateTokenDisplay();
        }
        this.messagesContainer.innerHTML = "";
        this.titleElement.textContent = session.title;
        for (let i = 0; i < session.messages.length; i++) {
            const msg = session.messages[i];
            if (msg.role === "user") {
                this.appendUserMessage(msg.content);
            } else if (msg.role === "assistant") {
                if (msg.toolCalls && msg.toolCalls.length > 0) {
                    this.appendPersistedToolCalls(msg.content, msg.toolCalls);
                } else {
                    this.appendPersistedAssistant(msg.content);
                }
            }
        }
        this.scrollToBottom();
    }

    private appendPersistedAssistant(content: string) {
        const el = document.createElement("div");
        el.className = "agent-chat__msg agent-chat__msg--ai";
        el.innerHTML = '<div class="agent-chat__bubble">' + (this.lute.MarkdownStr("", content) || this.escapeHtml(content)) + "</div>";
        this.messagesContainer.appendChild(el);
    }

    private appendPersistedToolCalls(content: string, toolCalls: Array<{name: string; arguments: Record<string, unknown>; result?: string}>) {
        if (content) {
            this.appendPersistedAssistant(content);
        }
        const L = window.siyuan.languages;
        for (let i = 0; i < toolCalls.length; i++) {
            const tc = toolCalls[i];
            const argsStr = JSON.stringify(tc.arguments, null, 2);
            const el = document.createElement("div");
            el.className = "agent-chat__msg agent-chat__msg--tool";
            el.innerHTML = '<div class="agent-chat__tool-card agent-chat__tool-card--call" data-tool="' + tc.name + '">' +
    '<div class="agent-chat__tool-header">' +
        '<span class="agent-chat__tool-icon">&#128736;</span>' +
        '<span class="agent-chat__tool-title">' + (L.agentToolCall || "Calling tool") + ": " + tc.name + "</span>" +
    "</div>" +
    '<pre class="agent-chat__tool-body fn__none">' + this.escapeHtml(argsStr) + "</pre>" +
"</div>";
            const header = el.querySelector(".agent-chat__tool-header") as HTMLElement;
            var body = el.querySelector(".agent-chat__tool-body") as HTMLElement;
            header.addEventListener("click", function () {
                body.classList.toggle("fn__none");
            });
            this.messagesContainer.appendChild(el);

            if (tc.result) {
                const rel = document.createElement("div");
                rel.className = "agent-chat__msg agent-chat__msg--tool";
                if (tc.name === "todo_write") {
                    rel.innerHTML = this.renderTodoList(tc.result);
                } else {
                    rel.innerHTML = '<div class="agent-chat__tool-card agent-chat__tool-card--result" data-tool="' + tc.name + '">' +
    '<div class="agent-chat__tool-header">' +
        '<span class="agent-chat__tool-icon">&#128196;</span>' +
        '<span class="agent-chat__tool-title">' + (L.agentToolResult || "Tool result") + ": " + tc.name + "</span>" +
    "</div>" +
    '<pre class="agent-chat__tool-body fn__none">' + this.escapeHtml(tc.result) + "</pre>" +
"</div>";
                    const rheader = rel.querySelector(".agent-chat__tool-header") as HTMLElement;
                    var rbody = rel.querySelector(".agent-chat__tool-body") as HTMLElement;
                    rheader.addEventListener("click", function () {
                        rbody.classList.toggle("fn__none");
                    });
                }
                this.messagesContainer.appendChild(rel);
            }
        }
    }

    private async createSession() {
        await this.saveSession();
        this.sessionId = SessionStore.newSessionId();
        this.sessionTitle = this.defaultTitle;
        this.messages = [];
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
        this.closeSessionMenu();
        if (id === this.sessionId) {
            const list = await SessionStore.list();
            this.messages = [];
            if (list.length > 0) {
                this.sessionId = list[0].id;
                await this.switchSession(list[0].id);
            } else {
                this.sessionId = SessionStore.newSessionId();
                await this.createSession();
            }
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

        this.messages.push({role: "user", content: text});
        this.appendUserMessage(text);

        this.requestStartTime = Date.now();

        const apiMessages = this.messages.map(function (m) { return {role: m.role as "user" | "assistant", content: m.content}; });
        const self = this;

        this.abortController = new AbortController();

        fetchAgentSSE(
            apiMessages,
            window.siyuan.config.appearance.lang,
            refs,
            function (event: ISSEResult) { self.handleSSEEvent(event); },
            function (err: Error) { self.handleError(err); },
            this.abortController.signal,
            this.sessionId,
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
                    this.appendToolCall(event.name, event.arguments);
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
            this.clearThinking();
            this.currentAIElement = this.createAIMessagePlaceholder();
        }
        this.currentContent += token;
        this.fullContent += token;
        this.scrollToBottom();

        if (!this.pendingTokenUpdate) {
            this.pendingTokenUpdate = true;
            const self = this;
            this.rafId = requestAnimationFrame(function () {
                self.pendingTokenUpdate = false;
                const bubble = self.currentAIElement?.querySelector(".agent-chat__bubble") as HTMLElement;
                if (bubble) {
                    bubble.innerHTML = self.lute.MarkdownStr("", self.currentContent) || self.escapeHtml(self.currentContent);
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

    private appendToolCall(name: string, args: Record<string, unknown>) {
        const el = document.createElement("div");
        el.className = "agent-chat__msg agent-chat__msg--tool";
        const argsStr = JSON.stringify(args, null, 2);
        const L = window.siyuan.languages;
        el.innerHTML = '<div class="agent-chat__tool-card agent-chat__tool-card--call" data-tool="' + name + '">' +
    '<div class="agent-chat__tool-header">' +
        '<span class="agent-chat__tool-icon">&#128736;</span>' +
        '<span class="agent-chat__tool-title">' + (L.agentToolCall || "Calling tool") + ": " + name + "</span>" +
    "</div>" +
    '<pre class="agent-chat__tool-body fn__none">' + this.escapeHtml(argsStr) + "</pre>" +
"</div>";
        const header = el.querySelector(".agent-chat__tool-header") as HTMLElement;
        const body = el.querySelector(".agent-chat__tool-body") as HTMLElement;
        header.addEventListener("click", function () {
            body.classList.toggle("fn__none");
        });
        this.insertBeforeAI(el);
        this.scrollToBottom();
    }

    private appendToolResult(name: string, result: string) {
        const el = document.createElement("div");
        el.className = "agent-chat__msg agent-chat__msg--tool";
        const L = window.siyuan.languages;

        if (name === "todo_write") {
            el.innerHTML = this.renderTodoList(result);
        } else {
            el.innerHTML = '<div class="agent-chat__tool-card agent-chat__tool-card--result" data-tool="' + name + '">' +
    '<div class="agent-chat__tool-header">' +
        '<span class="agent-chat__tool-icon">&#128196;</span>' +
        '<span class="agent-chat__tool-title">' + (L.agentToolResult || "Tool result") + ": " + name + "</span>" +
    "</div>" +
    '<pre class="agent-chat__tool-body">' + this.escapeHtml(result) + "</pre>" +
"</div>";
            const header = el.querySelector(".agent-chat__tool-header") as HTMLElement;
            const body = el.querySelector(".agent-chat__tool-body") as HTMLElement;
            header.addEventListener("click", function () {
                body.classList.toggle("fn__none");
            });
        }
        this.insertBeforeAI(el);
        this.scrollToBottom();
    }

    private renderTodoList(result: string): string {
        const lines = result.split("\n");
        let html = '<div class="agent-chat__tool-card agent-chat__tool-card--todo">' +
    '<div class="agent-chat__todo-header">' +
        '<span class="agent-chat__tool-icon">&#128203;</span>' +
        '<span class="agent-chat__tool-title">' + (window.siyuan.languages.agentTodoList || "Todo List") + "</span>" +
    "</div>" +
    '<div class="agent-chat__todo-items">';
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.startsWith("✅")) {
                html += '<div class="agent-chat__todo-item agent-chat__todo-item--completed"><span class="agent-chat__todo-status">✅</span>' + this.escapeHtml(line.substring(1).trim()) + "</div>";
            } else if (line.startsWith("🔄")) {
                html += '<div class="agent-chat__todo-item agent-chat__todo-item--in-progress"><span class="agent-chat__todo-status">🔄</span>' + this.escapeHtml(line.slice(2).trim()) + "</div>";
            } else if (line.startsWith("❌")) {
                html += '<div class="agent-chat__todo-item agent-chat__todo-item--cancelled"><span class="agent-chat__todo-status">❌</span>' + this.escapeHtml(line.substring(1).trim()) + "</div>";
            } else if (line.startsWith("○")) {
                html += '<div class="agent-chat__todo-item agent-chat__todo-item--pending"><span class="agent-chat__todo-status">○</span>' + this.escapeHtml(line.substring(1).trim()) + "</div>";
            }
        }
        html += "</div></div>";
        return html;
    }

    private appendThinking(reasoning: string) {
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

        let detailLines = "";
        if (reasoning === "processing") {
            const toolCards = this.messagesContainer.querySelectorAll(".agent-chat__tool-card--call");
            if (toolCards.length > 0) {
                detailLines += '<div class="agent-chat__thinking-summary">' + (L.agentToolCall || "Tool call") + "s:</div>";
                for (let i = 0; i < toolCards.length; i++) {
                    const name = toolCards[i].getAttribute("data-tool") || "";
                    if (name) {
                        detailLines += '<div class="agent-chat__thinking-item">' + this.escapeHtml(name) + "</div>";
                    }
                }
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
        '<span class="agent-chat__thinking-arrow">&#9662;</span>' +
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
        const arrow = el.querySelector(".agent-chat__thinking-arrow") as HTMLElement;
        header.addEventListener("click", function () {
            body.classList.toggle("fn__none");
            const isHidden = body.classList.contains("fn__none");
            arrow.innerHTML = isHidden ? "&#9662;" : "&#9652;";
        });
        this.insertBeforeAI(el);
        this.scrollToBottom();
    }

    private finalizeCurrentRound() {
        if (!this.currentAIElement) {
            return;
        }
        const bubble = this.currentAIElement.querySelector(".agent-chat__bubble") as HTMLElement;
        if (bubble) {
            bubble.classList.remove("agent-chat__bubble--streaming");
        }
        this.currentAIElement = null;
        this.currentContent = "";
    }

    private finishResponse() {
        if (!this.currentAIElement) {
            return;
        }
        this.flushTokenUpdate();
        this.clearThinking();
        if (!this.currentContent) {
            this.currentAIElement.remove();
            this.currentAIElement = null;
            this.currentContent = "";
            this.fullContent = "";
            this.currentToolCalls = [];
            if (this.requestStartTime) {
                this.sessionTotalDuration += Date.now() - this.requestStartTime;
                this.requestStartTime = 0;
            }
            this.updateTokenDisplay();
            this.setStreaming(false);
            // line 754 area
            if (!this.hasTitled && this.messages.length >= 2) {
                this.hasTitled = true;
                this.generateTitle();
            }
            this.saveSession();
            return;
        }
        const bubble = this.currentAIElement.querySelector(".agent-chat__bubble") as HTMLElement;
        if (bubble) {
            bubble.classList.remove("agent-chat__bubble--streaming");
        }
        this.messages.push({role: "assistant", content: this.fullContent || " ", toolCalls: this.currentToolCalls.length > 0 ? this.currentToolCalls.slice() : undefined});
        this.currentAIElement = null;
        this.currentContent = "";
        this.fullContent = "";
        this.currentToolCalls = [];
        if (this.requestStartTime) {
            this.sessionTotalDuration += Date.now() - this.requestStartTime;
                this.requestStartTime = 0;
            }
            this.updateTokenDisplay();
            this.setStreaming(false);

        if (!this.hasTitled && this.messages.length >= 2) {
            this.hasTitled = true;
            this.generateTitle();
        }
        this.saveSession();
    }

    private generateTitle() {
        const firstMsg = this.messages[0].content.slice(0, 500);
        const self = this;
        fetch("/api/ai/agent/title", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({message: firstMsg}),
        }).then(function (resp) { return resp.json(); }).then(function (data) {
            if (data.code === 0 && data.data && data.data !== self.sessionTitle) {
                self.sessionTitle = data.data;
                self.titleElement.textContent = data.data;
                self.saveSession();
            }
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
            if (this.fullContent) {
                this.messages.push({role: "assistant", content: this.fullContent || " ", toolCalls: this.currentToolCalls.length > 0 ? this.currentToolCalls.slice() : undefined});
            } else {
                this.currentAIElement.remove();
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
    }

    private insertBeforeAI(el: HTMLElement) {
        if (this.currentAIElement) {
            this.messagesContainer.insertBefore(el, this.currentAIElement);
        } else {
            this.messagesContainer.appendChild(el);
        }
    }

    private appendConfirm(name: string, args: Record<string, unknown>, confirmID: string) {
        const self = this;
        const L = window.siyuan.languages;
        const el = document.createElement("div");
        el.className = "agent-chat__msg agent-chat__msg--confirm";
        const argsStr = JSON.stringify(args, null, 2);
        const action = (args.action as string) || name;
        const desc = (L.agentConfirmDesc || "Confirm {action} on: {name}?").replace("{action}", this.escapeHtml(action)).replace("{name}", this.escapeHtml(name));
        el.innerHTML = '<div class="agent-chat__confirm-card">' +
    '<div class="agent-chat__confirm-header">&#9888; ' + desc + "</div>" +
    '<pre class="agent-chat__confirm-args">' + this.escapeHtml(argsStr) + "</pre>" +
    '<div class="agent-chat__confirm-actions">' +
        '<button class="b3-button b3-button--cancel agent-chat__confirm-reject">' + (L.agentConfirmReject || "Reject") + "</button>" +
        '<button class="b3-button b3-button--text agent-chat__confirm-approve">' + (L.agentConfirmApprove || "Approve") + "</button>" +
        '<button class="b3-button b3-button--text agent-chat__confirm-always ariaLabel" data-position="n" aria-label="' + (L.agentConfirmAlwaysDesc || "Session Allow") + '">' + (L.agentConfirmAlways || "Session Allow") + "</button>" +
    "</div>" +
"</div>";
        const approveBtn = el.querySelector(".agent-chat__confirm-approve");
        if (approveBtn) { approveBtn.addEventListener("click", function (e) {
            e.stopPropagation();
            el.classList.add("agent-chat__msg--confirmed");
            const btns = el.querySelector(".agent-chat__confirm-actions") as HTMLElement;
            if (btns) { btns.innerHTML = '<span class="agent-chat__confirm-done">' + (L.agentConfirmApprove || "Approved") + "</span>"; }
            self.postConfirm(confirmID, true);
        }); }
        const rejectBtn = el.querySelector(".agent-chat__confirm-reject");
        if (rejectBtn) { rejectBtn.addEventListener("click", function (e) {
            e.stopPropagation();
            el.classList.add("agent-chat__msg--confirmed");
            const btns = el.querySelector(".agent-chat__confirm-actions") as HTMLElement;
            if (btns) { btns.innerHTML = '<span class="agent-chat__confirm-done">' + (L.agentConfirmReject || "Rejected") + "</span>"; }
            self.postConfirm(confirmID, false);
        }); }
        const alwaysBtn = el.querySelector(".agent-chat__confirm-always");
        if (alwaysBtn) { alwaysBtn.addEventListener("click", function (e) {
            e.stopPropagation();
            el.classList.add("agent-chat__msg--confirmed");
            const btns = el.querySelector(".agent-chat__confirm-actions") as HTMLElement;
            if (btns) { btns.innerHTML = '<span class="agent-chat__confirm-done">' + (L.agentConfirmAlways || "Session Allow") + "</span>"; }
            self.postConfirm(confirmID, true, true);
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
        const self = this;
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
                html += '<div class="agent-chat__question-header">' + self.escapeHtml(header) + "</div>";
            }
            if (question) {
                html += '<div class="agent-chat__question-text">' + self.escapeHtml(question) + "</div>";
            }
            html += '<div class="agent-chat__question-options" data-qi="' + qi + '">';
            const inputType = multiple ? "checkbox" : "radio";
            const inputName = "q_" + questionID + "_" + qi;
            for (let oi = 0; oi < options.length; oi++) {
                const opt = options[oi];
                const label = (opt.label as string) || "";
                const desc = (opt.description as string) || "";
                html += '<label class="agent-chat__question-option">' +
                    '<input type="' + inputType + '" name="' + inputName + '" value="' + self.escapeHtml(label) + '">' +
                    '<span class="agent-chat__question-option-label">' + self.escapeHtml(label) + "</span>";
                if (desc) {
                    html += '<span class="agent-chat__question-option-desc">' + self.escapeHtml(desc) + "</span>";
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
            submitBtn.addEventListener("click", function () {
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
                self.postQuestionAnswer(questionID, answers);
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

    private setStreaming(streaming: boolean) {
        this.isStreaming = streaming;
        this.sendBtn.classList.toggle("fn__none", streaming);
        this.stopBtn.classList.toggle("fn__none", !streaming);
        if (this.composerHost) {
            this.composerHost.classList.toggle("agent-chat__composer-host--disabled", streaming);
        }
    }

    private scrollToBottom() {
        const self = this;
        requestAnimationFrame(function () {
            self.messagesContainer.scrollTop = self.messagesContainer.scrollHeight;
        });
    }

    private escapeHtml(text: string): string {
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    }
}
