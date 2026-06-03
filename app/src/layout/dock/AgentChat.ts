import {Tab} from "../Tab";
import {Model} from "../Model";
import {App} from "../../index";
import {fetchAgentSSE, ISSEResult} from "../../util/agentSSE";
import {mountComposer} from "./AgentComposer";
import {AgentSession, SessionStore} from "./SessionStore";

interface IAgentMessage {
    role: "user" | "assistant";
    content: string;
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
    private defaultTitle = "";

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
        var panel = this.parent.panelElement;
        panel.classList.add("fn__flex-column", "file-tree", "dockPanel");

        var L = window.siyuan.languages;

        panel.innerHTML = '<div class="agent-chat fn__flex-column fn__flex-1">' +
    '<div class="block__icons">' +
        '<div class="block__logo fn__flex-1 agent-chat__title">' + (L.agentChat || "Agent") + '</div>' +
        '<span data-type="new-session" class="block__icon ariaLabel" data-position="north" aria-label="' + (L.agentNewSession || "New Session") + '">' +
            '<svg><use xlink:href="#iconAdd"></use></svg>' +
        '</span>' +
        '<span class="fn__space"></span>' +
        '<span data-type="session-menu" class="block__icon ariaLabel" data-position="north" aria-label="' + (L.more || "More") + '">' +
            '<svg><use xlink:href="#iconMore"></use></svg>' +
        '</span>' +
        '<span class="fn__space"></span>' +
        '<span data-type="min" class="block__icon ariaLabel" data-position="north" aria-label="' + (window.siyuan.languages.min || "Minimize") + '">' +
            '<svg><use xlink:href="#iconMin"></use></svg>' +
        '</span>' +
    '</div>' +
    '<div class="agent-chat__messages fn__flex-1"></div>' +
    '<div class="agent-chat__input-area">' +
        '<div class="agent-chat__composer-host"></div>' +
        '<div class="agent-chat__buttons">' +
            '<button class="agent-chat__send b3-button b3-button--text">' + (L.agentSend || "Send") + '</button>' +
            '<button class="agent-chat__stop b3-button b3-button--cancel fn__none">' + (L.agentStop || "Stop") + '</button>' +
        '</div>' +
    '</div>' +
'</div>';

        this.messagesContainer = panel.querySelector(".agent-chat__messages") as HTMLElement;
        this.composerHost = panel.querySelector(".agent-chat__composer-host") as HTMLElement;
        this.sendBtn = panel.querySelector(".agent-chat__send") as HTMLElement;
        this.stopBtn = panel.querySelector(".agent-chat__stop") as HTMLElement;
        this.newSessionBtn = panel.querySelector('.block__icon[data-type="new-session"]') as HTMLElement;
        this.sessionMenuBtn = panel.querySelector('.block__icon[data-type="session-menu"]') as HTMLElement;
        this.titleElement = panel.querySelector(".agent-chat__title") as HTMLElement;

        var self = this;
        this.composer = mountComposer(this.composerHost, function () { self.sendMessage(); });
        this.initSessions();
    }

    private showWelcome() {
        var L = window.siyuan.languages;
        var html = '<div class="agent-welcome">' +
            '<div class="agent-welcome__greeting">' + (L.agentWelcomeGreeting || "Hello, I am SiYuan Agent") + '</div>' +
            '<div class="agent-welcome__desc">' + (L.agentWelcomeDesc || "I can search, read, create, and modify your notes") + '</div>' +
            '<div class="agent-welcome__examples">' +
                '<div class="agent-welcome__example" data-text="' + this.escapeHtml(L.agentExample1 || "") + '">' + (L.agentExample1 || "") + '</div>' +
                '<div class="agent-welcome__example" data-text="' + this.escapeHtml(L.agentExample2 || "") + '">' + (L.agentExample2 || "") + '</div>' +
                '<div class="agent-welcome__example" data-text="' + this.escapeHtml(L.agentExample3 || "") + '">' + (L.agentExample3 || "") + '</div>' +
            '</div>' +
        '</div>';
        this.messagesContainer.innerHTML = html;
        var self = this;
        var examples = this.messagesContainer.querySelectorAll(".agent-welcome__example");
        for (var i = 0; i < examples.length; i++) {
            examples[i].addEventListener("click", function (ex: HTMLElement) {
                return function () {
                    var text = ex.getAttribute("data-text") || "";
                    if (text && self.composer) {
                        // 不支持 setSendText，直接用 sendMessage 发送
                        self.messages.push({role: "user", content: text});
                        self.appendUserMessage(text);
                        self.currentAIElement = self.createAIMessagePlaceholder();
                        self.setStreaming(true);
                        var apiMessages = self.messages.map(function (m) { return {role: m.role, content: m.content}; });
                        self.abortController = new AbortController();
                        fetchAgentSSE(apiMessages, window.siyuan.config.appearance.lang, [],
                            function (event: ISSEResult) { self.handleSSEEvent(event); },
                            function (err: Error) { self.handleError(err); },
                            self.abortController.signal);
                    }
                };
            }(examples[i] as HTMLElement));
        }
    }

    private bindEvents() {
        var self = this;
        this.sendBtn.addEventListener("click", function () { self.sendMessage(); });
        this.stopBtn.addEventListener("click", function () { self.stopGeneration(); });
        this.newSessionBtn.addEventListener("click", function () { self.createSession(); });
        this.sessionMenuBtn.addEventListener("click", function (e: MouseEvent) {
            e.stopPropagation();
            self.toggleSessionMenu();
        });

        this.parent.panelElement.addEventListener("click", function (e: MouseEvent) {
            var t = e.target as HTMLElement;
            if (t.closest(".agent-chat__msg")) { return; }
            if (t.closest(".agent-chat__header")) { return; }
            if (t.closest(".agent-chat__input-area")) { return; }
            if (t.closest(".agent-session-popup")) { return; }
            if (self.composer) { self.composer.focus(); }
        });
    }

    private async initSessions() {
        await SessionStore.init();
        var list = await SessionStore.list();
        if (list.length > 0) {
            list.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
            var last = list[0];
            var session = await SessionStore.load(last.id);
            if (session) {
                this.sessionId = session.id;
                this.sessionTitle = session.title;
                this.messages = session.messages;
                this.hasTitled = true;
                this.titleElement.textContent = session.title;
                for (var i = 0; i < session.messages.length; i++) {
                    var msg = session.messages[i];
                    if (msg.role === "user") {
                        this.appendUserMessage(msg.content);
                    } else if (msg.role === "assistant") {
                        this.appendPersistedAssistant(msg.content);
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
        var self = this;
        this.renderSessionList();
    }

    private closeSessionMenu() {
        if (this.sessionPopup) {
            this.sessionPopup.remove();
            this.sessionPopup = null;
        }
    }

    private async renderSessionList() {
        var self = this;
        this.closeSessionMenu();
        var list = await SessionStore.list();
        list.sort(function (a, b) { return b.updatedAt - a.updatedAt; });

        this.sessionPopup = document.createElement("div");
        this.sessionPopup.className = "agent-session-popup";

        var html = '<div class="agent-session-popup__list">';
        if (list.length === 0) {
            html += '<div class="agent-session-popup__empty">' + (window.siyuan.languages.emptyContent || "No sessions") + '</div>';
        } else {
            for (var i = 0; i < list.length; i++) {
                var s = list[i];
            var isActive = s.id === this.sessionId;
            html += '<div class="agent-session-popup__item' + (isActive ? ' agent-session-popup__item--active' : '') + '" data-id="' + s.id + '">' +
                '<span class="agent-session-popup__title">' + this.escapeHtml(s.title || this.defaultTitle) + '</span>' +
                '<span class="agent-session-popup__actions">' +
                    '<span class="agent-session-popup__rename" data-id="' + s.id + '">&#9998;</span>' +
                    '<span class="agent-session-popup__delete" data-id="' + s.id + '">&#10005;</span>' +
                    '</span>' +
                '</div>';
            }
        }
        html += '</div>';

        this.sessionPopup.innerHTML = html;

        this.sessionPopup.querySelectorAll(".agent-session-popup__item").forEach(function (item) {
            item.addEventListener("click", function (e) {
                var id = item.getAttribute("data-id") || "";
                if (id && id !== self.sessionId) {
                    self.switchSession(id);
                    self.closeSessionMenu();
                }
            });
        });
        this.sessionPopup.querySelectorAll(".agent-session-popup__delete").forEach(function (btn) {
            btn.addEventListener("click", function (e: MouseEvent) {
                e.stopPropagation();
                var id = btn.getAttribute("data-id") || "";
                if (id) { self.deleteSession(id); }
            });
        });
        this.sessionPopup.querySelectorAll(".agent-session-popup__rename").forEach(function (btn) {
            btn.addEventListener("click", function (e: MouseEvent) {
                e.stopPropagation();
                var id = btn.getAttribute("data-id") || "";
                if (id) {
                    var parent = btn.parentElement;
                    var row = parent ? parent.parentElement as HTMLElement : null;
                    if (row) { self.startRename(id, row); }
                }
            });
        });

        this.parent.panelElement.appendChild(this.sessionPopup);

        var self2 = this;
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
        var self = this;
        var titleEl = rowEl.querySelector(".agent-session-popup__title") as HTMLElement;
        var oldTitle = titleEl.textContent || "";
        var input = document.createElement("input");
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
        var title = newTitle.trim() || this.defaultTitle;
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
        var session: AgentSession = {
            id: this.sessionId,
            title: this.sessionTitle,
            messages: this.messages.slice(),
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
        await SessionStore.save(session);
    }

    private async switchSession(id: string) {
        await this.saveSession();
        var session = await SessionStore.load(id);
        if (!session) { return; }
        this.sessionId = session.id;
        this.sessionTitle = session.title;
        this.messages = session.messages;
        this.hasTitled = true;
        this.currentAIElement = null;
        this.currentContent = "";
        this.messagesContainer.innerHTML = "";
        this.titleElement.textContent = session.title;
        for (var i = 0; i < session.messages.length; i++) {
            var msg = session.messages[i];
            if (msg.role === "user") {
                this.appendUserMessage(msg.content);
            } else if (msg.role === "assistant") {
                this.appendPersistedAssistant(msg.content);
            }
        }
        this.scrollToBottom();
    }

    private appendPersistedAssistant(content: string) {
        var el = document.createElement("div");
        el.className = "agent-chat__msg agent-chat__msg--ai";
        el.innerHTML = '<div class="agent-chat__bubble">' + (this.lute.MarkdownStr("", content) || this.escapeHtml(content)) + '</div>';
        this.messagesContainer.appendChild(el);
    }

    private async createSession() {
        await this.saveSession();
        this.sessionId = SessionStore.newSessionId();
        this.sessionTitle = this.defaultTitle;
        this.messages = [];
        this.hasTitled = false;
        this.currentAIElement = null;
        this.currentContent = "";
        this.messagesContainer.innerHTML = "";
        this.titleElement.textContent = this.defaultTitle;
        if (this.composer) { this.composer.clear(); }
        if (this.composer) { this.composer.focus(); }
        this.showWelcome();
    }

    private async deleteSession(id: string) {
        this.closeSessionMenu();
        await SessionStore.remove(id);
        if (id === this.sessionId) {
            var list = await SessionStore.list();
            if (list.length > 0) {
                await this.switchSession(list[0].id);
            } else {
                await this.createSession();
            }
        }
    }

    private sendMessage() {
        if (!this.composer) { return; }
        var sendData = this.composer.getSendData();
        var text = sendData.text;
        var refs = sendData.references;
        if (!text || this.isStreaming) {
            return;
        }

        this.setStreaming(true);
        this.composer.clear();

        this.messages.push({role: "user", content: text});
        this.appendUserMessage(text);

        this.currentAIElement = this.createAIMessagePlaceholder();

        var apiMessages = this.messages.map(function (m) { return {role: m.role, content: m.content}; });
        var self = this;

        this.abortController = new AbortController();

        fetchAgentSSE(
            apiMessages,
            window.siyuan.config.appearance.lang,
            refs,
            function (event: ISSEResult) { self.handleSSEEvent(event); },
            function (err: Error) { self.handleError(err); },
            this.abortController.signal,
        );
    }

    private handleSSEEvent(event: ISSEResult) {
        switch (event.type) {
            case "content":
                this.appendToken(event.token);
                break;
            case "thinking":
                this.appendThinking(event.reasoning);
                break;
            case "tool_call":
                break;
            case "tool_result":
                break;
            case "confirm":
                this.appendConfirm(event.name, event.arguments, event.confirmID);
                break;
            case "tool_result":
                this.appendToolResult(event.name, event.result);
                break;
            case "done":
                this.finishResponse();
                break;
            case "usage":
                this.appendUsage(event.promptTokens, event.completionTokens);
                break;
            case "error":
                this.appendError(event.message);
                this.setStreaming(false);
                break;
        }
    }

    private handleError(err: Error) {
        this.appendError(err.message);
        this.setStreaming(false);
    }

    private appendUserMessage(text: string) {
        var el = document.createElement("div");
        el.className = "agent-chat__msg agent-chat__msg--user";
        el.innerHTML = '<div class="agent-chat__bubble">' + this.escapeHtml(text) + '</div>';
        this.messagesContainer.appendChild(el);
        this.scrollToBottom();
    }

    private createAIMessagePlaceholder(): HTMLElement {
        this.currentContent = "";
        var el = document.createElement("div");
        el.className = "agent-chat__msg agent-chat__msg--ai";
        el.innerHTML = '<div class="agent-chat__bubble agent-chat__bubble--streaming"><span class="agent-chat__cursor"></span></div>';
        this.messagesContainer.appendChild(el);
        this.scrollToBottom();
        return el;
    }

    private appendToken(token: string) {
        if (!this.currentAIElement) {
            return;
        }
        var bubble = this.currentAIElement.querySelector(".agent-chat__bubble") as HTMLElement;
        if (!bubble) {
            return;
        }
        this.currentContent += token;
        this.clearThinking();
        bubble.innerHTML = this.lute.MarkdownStr("", this.currentContent) + '<span class="agent-chat__cursor"></span>';
        this.scrollToBottom();
    }

    private appendToolCall(name: string, args: Record<string, unknown>) {
        var el = document.createElement("div");
        el.className = "agent-chat__msg agent-chat__msg--tool";
        var argsStr = JSON.stringify(args, null, 2);
        var L = window.siyuan.languages;
        el.innerHTML = '<div class="agent-chat__tool-card agent-chat__tool-card--call" data-tool="' + name + '">' +
    '<div class="agent-chat__tool-header">' +
        '<span class="agent-chat__tool-icon">&#128736;</span>' +
        '<span class="agent-chat__tool-title">' + (L.agentToolCall || "Calling tool") + ': ' + name + '</span>' +
    '</div>' +
    '<pre class="agent-chat__tool-body fn__none">' + this.escapeHtml(argsStr) + '</pre>' +
'</div>';
        var header = el.querySelector(".agent-chat__tool-header") as HTMLElement;
        var body = el.querySelector(".agent-chat__tool-body") as HTMLElement;
        header.addEventListener("click", function () {
            body.classList.toggle("fn__none");
        });
        this.insertBeforeAI(el);
        this.scrollToBottom();
    }

    private appendToolResult(name: string, result: string) {
        var el = document.createElement("div");
        el.className = "agent-chat__msg agent-chat__msg--tool";
        var L = window.siyuan.languages;
        el.innerHTML = '<div class="agent-chat__tool-card agent-chat__tool-card--result" data-tool="' + name + '">' +
    '<div class="agent-chat__tool-header">' +
        '<span class="agent-chat__tool-icon">&#128196;</span>' +
        '<span class="agent-chat__tool-title">' + (L.agentToolResult || "Tool result") + ': ' + name + '</span>' +
    '</div>' +
    '<pre class="agent-chat__tool-body">' + this.escapeHtml(result) + '</pre>' +
'</div>';
        var header = el.querySelector(".agent-chat__tool-header") as HTMLElement;
        var body = el.querySelector(".agent-chat__tool-body") as HTMLElement;
        header.addEventListener("click", function () {
            body.classList.toggle("fn__none");
        });
        this.insertBeforeAI(el);
        this.scrollToBottom();
    }

    private appendThinking(reasoning: string) {
        var L = window.siyuan.languages;
        var text = reasoning;
        var roundLabel = "";
        if (reasoning === "analyzing") {
            text = L.agentThinkingAnalyzing || "Analyzing your request...";
            roundLabel = "Step 1";
        } else if (reasoning === "processing") {
            text = L.agentThinkingProcessing || "Processing results...";
            roundLabel = "Continuing...";
        }

        var detailLines = "";
        if (reasoning === "processing") {
            var toolCards = this.messagesContainer.querySelectorAll(".agent-chat__tool-card--call");
            if (toolCards.length > 0) {
                detailLines += '<div class="agent-chat__thinking-summary">' + (L.agentToolCall || "Tool call") + 's:</div>';
                for (var i = 0; i < toolCards.length; i++) {
                    var name = toolCards[i].getAttribute("data-tool") || "";
                    if (name) {
                        detailLines += '<div class="agent-chat__thinking-item">' + this.escapeHtml(name) + '</div>';
                    }
                }
            }
        }

        var bodyHTML = '<div class="agent-chat__thinking-body fn__none">' +
            '<div class="agent-chat__thinking-round">' + this.escapeHtml(roundLabel) + '</div>' +
            detailLines +
        '</div>';

        var el = document.createElement("div");
        el.className = "agent-chat__msg agent-chat__msg--thinking";
        el.innerHTML = '<div class="agent-chat__thinking-card">' +
    '<div class="agent-chat__thinking-header">' +
        '<span class="agent-chat__thinking-dot"></span>' +
        '<span class="agent-chat__thinking-text">' + this.escapeHtml(text) + '</span>' +
        '<span class="agent-chat__thinking-arrow">&#9662;</span>' +
    '</div>' +
    bodyHTML +
'</div>';
        var header = el.querySelector(".agent-chat__thinking-header") as HTMLElement;
        var body = el.querySelector(".agent-chat__thinking-body") as HTMLElement;
        var arrow = el.querySelector(".agent-chat__thinking-arrow") as HTMLElement;
        header.addEventListener("click", function () {
            body.classList.toggle("fn__none");
            var isHidden = body.classList.contains("fn__none");
            arrow.innerHTML = isHidden ? "&#9662;" : "&#9652;";
        });
        this.insertBeforeAI(el);
        this.scrollToBottom();
    }

    private finishResponse() {
        if (!this.currentAIElement) {
            return;
        }
        this.clearThinking();
        var bubble = this.currentAIElement.querySelector(".agent-chat__bubble") as HTMLElement;
        if (bubble) {
            var cursor = bubble.querySelector(".agent-chat__cursor");
            if (cursor) {
                cursor.remove();
            }
            bubble.classList.remove("agent-chat__bubble--streaming");
        }
        this.messages.push({role: "assistant", content: this.currentContent});
        this.currentAIElement = null;
        this.currentContent = "";
        this.setStreaming(false);

        if (!this.hasTitled && this.messages.length >= 2) {
            this.hasTitled = true;
            this.generateTitle();
        }
        this.saveSession();
    }

    private generateTitle() {
        var firstMsg = this.messages[0].content.slice(0, 500);
        var self = this;
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
        var el = document.createElement("div");
        el.className = "agent-chat__msg agent-chat__msg--error";
        el.innerHTML = '<div class="agent-chat__bubble agent-chat__bubble--error">' + this.escapeHtml(message) + '</div>';
        this.insertBeforeAI(el);
        if (this.currentAIElement) {
            var cursor = this.currentAIElement.querySelector(".agent-chat__cursor");
            if (cursor) {
                cursor.remove();
            }
        }
        this.currentAIElement = null;
        this.scrollToBottom();
        this.saveSession();
    }

    private stopGeneration() {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
        if (this.currentAIElement) {
            var bubble = this.currentAIElement.querySelector(".agent-chat__bubble") as HTMLElement;
            if (bubble) {
                var cursor = bubble.querySelector(".agent-chat__cursor");
                if (cursor) {
                    cursor.remove();
                }
                bubble.classList.remove("agent-chat__bubble--streaming");
            }
            if (this.currentContent) {
                this.messages.push({role: "assistant", content: this.currentContent});
            }
            this.currentAIElement = null;
            this.currentContent = "";
        }
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
        var self = this;
        var L = window.siyuan.languages;
        var el = document.createElement("div");
        el.className = "agent-chat__msg agent-chat__msg--confirm";
        var argsStr = JSON.stringify(args, null, 2);
        var action = (args.action as string) || name;
        var desc = (L.agentConfirmDesc || "Confirm {action} on: {name}?").replace("{action}", this.escapeHtml(action)).replace("{name}", this.escapeHtml(name));
        el.innerHTML = '<div class="agent-chat__confirm-card">' +
    '<div class="agent-chat__confirm-header">&#9888; ' + desc + '</div>' +
    '<pre class="agent-chat__confirm-args">' + this.escapeHtml(argsStr) + '</pre>' +
    '<div class="agent-chat__confirm-actions">' +
        '<button class="b3-button b3-button--cancel agent-chat__confirm-reject">' + (L.agentConfirmReject || "Reject") + '</button>' +
        '<button class="b3-button b3-button--text agent-chat__confirm-approve">' + (L.agentConfirmApprove || "Approve") + '</button>' +
    '</div>' +
'</div>';
        var approveBtn = el.querySelector(".agent-chat__confirm-approve");
        if (approveBtn) { approveBtn.addEventListener("click", function () {
            el.classList.add("agent-chat__msg--confirmed");
            var btns = el.querySelector(".agent-chat__confirm-actions") as HTMLElement;
            if (btns) { btns.innerHTML = '<span class="agent-chat__confirm-done">' + (L.agentConfirmApprove || "Approved") + '</span>'; }
            self.postConfirm(confirmID, true);
        }); }
        var rejectBtn = el.querySelector(".agent-chat__confirm-reject");
        if (rejectBtn) { rejectBtn.addEventListener("click", function () {
            el.classList.add("agent-chat__msg--confirmed");
            var btns = el.querySelector(".agent-chat__confirm-actions") as HTMLElement;
            if (btns) { btns.innerHTML = '<span class="agent-chat__confirm-done">' + (L.agentConfirmReject || "Rejected") + '</span>'; }
            self.postConfirm(confirmID, false);
        }); }
        this.insertBeforeAI(el);
        this.scrollToBottom();
    }

    private postConfirm(confirmID: string, approved: boolean) {
        fetch("/api/ai/agent/confirm", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({confirmID: confirmID, approved: approved}),
        });
    }

    private appendUsage(promptTokens: number, completionTokens: number) {
        var el = document.createElement("div");
        el.className = "agent-chat__msg agent-chat__msg--usage";
        var total = promptTokens + completionTokens;
        el.innerHTML = '<div class="agent-chat__usage">' +
    '<span>📊 ' + promptTokens + ' prompt + ' + completionTokens + ' completion = ' + total + ' tokens</span>' +
'</div>';
        this.messagesContainer.appendChild(el);
        this.scrollToBottom();
    }

    private clearThinking() {
        var items = this.messagesContainer.querySelectorAll(".agent-chat__msg--thinking");
        for (var i = 0; i < items.length; i++) {
            items[i].remove();
        }
    }

    private setStreaming(streaming: boolean) {
        this.isStreaming = streaming;
        this.sendBtn.classList.toggle("fn__none", streaming);
        this.stopBtn.classList.toggle("fn__none", !streaming);
        if (this.composerHost) {
            this.composerHost.style.pointerEvents = streaming ? "none" : "";
            this.composerHost.style.opacity = streaming ? "0.5" : "";
        }
    }

    private scrollToBottom() {
        var self = this;
        requestAnimationFrame(function () {
            self.messagesContainer.scrollTop = self.messagesContainer.scrollHeight;
        });
    }

    private escapeHtml(text: string): string {
        var div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    }
}
