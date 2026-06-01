import {Tab} from "../layout/Tab";
import {Model} from "../layout/Model";
import {App} from "../index";
import {fetchAgentSSE, ISSEResult} from "../util/agentSSE";

interface IAgentMessage {
    role: "user" | "assistant";
    content: string;
}

export class AgentChat extends Model {
    private messagesContainer: HTMLElement;
    private inputArea: HTMLTextAreaElement;
    private sendBtn: HTMLElement;
    private stopBtn: HTMLElement;
    private newSessionBtn: HTMLElement;
    private messages: IAgentMessage[] = [];
    private abortController: AbortController | null = null;
    private isStreaming = false;
    private currentAIElement: HTMLElement | null = null;

    constructor(app: App, tab: Tab) {
        super({app: app, id: tab.id});
        this.parent = tab;
        this.initUI();
        this.bindEvents();
    }

    private initUI() {
        var panel = this.parent.panelElement;
        panel.classList.add("fn__flex-column", "dockPanel");

        var L = window.siyuan.languages;

        panel.innerHTML = '<div class="agent-chat fn__flex-column fn__flex-1">' +
    '<div class="agent-chat__header">' +
        '<span class="agent-chat__title">' + (L.agentChat || "AI Agent") + '</span>' +
        '<button class="agent-chat__new-session b3-button b3-button--small b3-button--outline">' + (L.agentNewSession || "New Session") + '</button>' +
    '</div>' +
    '<div class="agent-chat__messages fn__flex-1"></div>' +
    '<div class="agent-chat__input-area">' +
        '<textarea class="agent-chat__input b3-text-field" rows="3" placeholder="' + (L.agentInputPlaceholder || "Type a message...") + '"></textarea>' +
        '<div class="agent-chat__buttons">' +
            '<button class="agent-chat__send b3-button b3-button--text">' + (L.agentSend || "Send") + '</button>' +
            '<button class="agent-chat__stop b3-button b3-button--cancel fn__none">' + (L.agentStop || "Stop") + '</button>' +
        '</div>' +
    '</div>' +
'</div>';

        this.messagesContainer = panel.querySelector(".agent-chat__messages") as HTMLElement;
        this.inputArea = panel.querySelector(".agent-chat__input") as HTMLTextAreaElement;
        this.sendBtn = panel.querySelector(".agent-chat__send") as HTMLElement;
        this.stopBtn = panel.querySelector(".agent-chat__stop") as HTMLElement;
        this.newSessionBtn = panel.querySelector(".agent-chat__new-session") as HTMLElement;
    }

    private bindEvents() {
        var self = this;
        this.sendBtn.addEventListener("click", function () { self.sendMessage(); });
        this.stopBtn.addEventListener("click", function () { self.stopGeneration(); });
        this.newSessionBtn.addEventListener("click", function () { self.clearSession(); });

        this.inputArea.addEventListener("keydown", function (e: KeyboardEvent) {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                self.sendMessage();
            }
        });

        this.parent.panelElement.addEventListener("click", function () {
            self.inputArea.focus();
        });
    }

    private sendMessage() {
        var text = this.inputArea.value.trim();
        if (!text || this.isStreaming) {
            return;
        }

        this.inputArea.value = "";
        this.setStreaming(true);

        this.messages.push({role: "user", content: text});
        this.appendUserMessage(text);

        this.currentAIElement = this.createAIMessagePlaceholder();

        var apiMessages = this.messages.map(function (m) { return {role: m.role, content: m.content}; });
        var self = this;

        this.abortController = new AbortController();

        var timeoutId = setTimeout(function () {
            if (self.isStreaming) {
                self.stopGeneration();
                self.appendError("Request timeout - no response from AI");
            }
        }, 30000);

        fetchAgentSSE(
            apiMessages,
            function (event: ISSEResult) { self.handleSSEEvent(event); },
            function (err: Error) { self.handleError(err); },
            this.abortController.signal,
        ).then(function () {
            clearTimeout(timeoutId);
            if (self.isStreaming) {
                self.setStreaming(false);
            }
        });
    }

    private handleSSEEvent(event: ISSEResult) {
        switch (event.type) {
            case "content":
                this.appendToken(event.token);
                break;
            case "tool_call":
                this.appendToolCall(event.name, event.arguments);
                break;
            case "tool_result":
                this.appendToolResult(event.name, event.result);
                break;
            case "done":
                this.finishResponse();
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
        if (bubble) {
            var cursor = bubble.querySelector(".agent-chat__cursor");
            if (cursor) {
                cursor.insertAdjacentText("beforebegin", token);
            } else {
                bubble.appendChild(document.createTextNode(token));
            }
        }
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
        this.messagesContainer.appendChild(el);
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
        this.messagesContainer.appendChild(el);
        this.scrollToBottom();
    }

    private finishResponse() {
        if (!this.currentAIElement) {
            return;
        }
        var bubble = this.currentAIElement.querySelector(".agent-chat__bubble") as HTMLElement;
        if (bubble) {
            var cursor = bubble.querySelector(".agent-chat__cursor");
            if (cursor) {
                cursor.remove();
            }
            bubble.classList.remove("agent-chat__bubble--streaming");
        }
        var aiBubble = this.currentAIElement.querySelector(".agent-chat__bubble") as HTMLElement;
        var aiContent = aiBubble ? (aiBubble.textContent || "") : "";
        this.messages.push({role: "assistant", content: aiContent});
        this.currentAIElement = null;
        this.setStreaming(false);
    }

    private appendError(message: string) {
        var el = document.createElement("div");
        el.className = "agent-chat__msg agent-chat__msg--error";
        el.innerHTML = '<div class="agent-chat__bubble agent-chat__bubble--error">' + this.escapeHtml(message) + '</div>';
        this.messagesContainer.appendChild(el);
        if (this.currentAIElement) {
            var cursor = this.currentAIElement.querySelector(".agent-chat__cursor");
            if (cursor) {
                cursor.remove();
            }
        }
        this.currentAIElement = null;
        this.scrollToBottom();
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
            var aiBubble = this.currentAIElement.querySelector(".agent-chat__bubble") as HTMLElement;
            var aiContent = aiBubble ? (aiBubble.textContent || "") : "";
            if (aiContent) {
                this.messages.push({role: "assistant", content: aiContent});
            }
            this.currentAIElement = null;
        }
        this.setStreaming(false);
    }

    private clearSession() {
        this.messages = [];
        this.currentAIElement = null;
        this.messagesContainer.innerHTML = "";
        this.inputArea.focus();
    }

    private setStreaming(streaming: boolean) {
        this.isStreaming = streaming;
        this.sendBtn.classList.toggle("fn__none", streaming);
        this.stopBtn.classList.toggle("fn__none", !streaming);
        this.inputArea.disabled = streaming;
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
