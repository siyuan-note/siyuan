import {Tab} from "../../Tab";
import {Model} from "../../Model";
import {App} from "../../../index";
import {AgentHttpError, fetchAgentSSE, IEditorContext, ISSEResult, IToolEffects} from "./agentSSE";
import {genUUID} from "../../../util/genID";
import {mountComposer} from "./AgentComposer";
import {disabledWYSIWYG} from "../../../protyle/util/onGet";
import {getAllEditor} from "../../getAll";
import "./frontendActions";
import {listActions, lookupAction} from "./frontendActions";
import {AgentSession, SessionStore} from "./SessionStore";
import {AgentSessionPanel} from "./AgentSessionPanel";
import {getDockByType} from "../../tabUtil";
import {updateHotkeyAfterTip} from "../../../protyle/util/compatibility";
import {getAgentLute} from "../../../protyle/render/setLute";
import {setPanelFocus} from "../../util";
import {escapeAriaLabel, escapeHtml} from "../../../util/escape";
import {setPosition} from "../../../util/setPosition";
import {fetchPost} from "../../../util/fetch";
import {confirmDialog} from "../../../dialog/confirmDialog";
import {showMessage} from "../../../dialog/message";
import * as dayjs from "dayjs";
import {sendNotification} from "../../../plugin/platformUtils";
import {
    findAgentUserEntryIndex,
    filterAgentReferencesForContent,
    hasAgentExecutedToolsAfter,
    isAgentRegenerateStateCurrent
} from "./AgentHistory";
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

// 限制注入用户轮次上下文的可见块 ID 数量，以控制 token 开销。
// 与 kernel/agent/agent.go 中的 maxVisibleBlockIDs 保持一致。
const maxVisibleBlockIDs = 50;

type EntryBase = { id?: string };
type AgentReference = { id: string; title: string };
type UserEntry = EntryBase & {
    type: "user";
    content: string;
    blockHTML?: string;
    references?: AgentReference[];
    editorContext?: IEditorContext;
    timestamp?: number
};

type SessionEntry =
    | UserEntry
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
    content?: string;
    toolCalls?: Array<{ name: string; arguments: Record<string, unknown>; result?: string; state?: string }>;
    timestamp?: number
})
    | (EntryBase & { type: "confirm"; name: string; args: Record<string, unknown>; confirmID: string; effects?: IToolEffects; status?: string })
    | (EntryBase & { type: "question"; questionID: string; questions: Array<Record<string, unknown>>; status?: string; answers?: string[] })
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
    private pendingSessionTitle: string | null = null;
    private entries: SessionEntry[] = [];
    private hasTitled = false;
    private isStreaming = false;
    private currentAIElement: HTMLElement | null = null;
    private currentAssistantEntryId = "";
    private currentThinkingEntryId = "";
    private currentTurnID = "";
    private recoveryCommitTurnIDs = new Map<string, string>();
    private pendingRecoverySessionIDs = new Set<string>();
    private recoveryInFlightSessionIDs = new Set<string>();
    private lute: Lute;
    private currentContent = "";
    private fullContent = "";
    private contextTokens = 0;
    private contextTokenBreakdown: Record<string, number> = {};
    private contextCachedTokens = 0;
    private contextLimit = 0;
    private tokenPopup: HTMLElement | null = null;
    private tokenPopupShowTimer = 0;
    private tokenPopupHideTimer = 0;
    private tokenPopupOutsideClickHandler: (() => void) | null = null;
    private tokenPopupResizeHandler: (() => void) | null = null;
    private sessionCreatedAt = 0;
    private requestStartTime = 0;
    private tokenDisplayEl: HTMLElement;
    private defaultTitle = "";
    private currentToolCalls: Array<{ name: string; arguments: Record<string, unknown>; result?: string }> = [];
    private toolCallStartedAt = new Map<string, number>();
    private abortController: AbortController | null = null;
    private currentThinkingText = "";
    private currentThinkingReasoning = "";
    private currentThinkingReasoningContent = "";
    private editingUserEntryID = "";
    private pendingEditDraft: { entryID: string; content: string } | null = null;
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
    private modelSelect: HTMLSelectElement;
    private selectedModel: string;
    private modelOptions: Array<{ id: string; name: string }> = [];
    // 推理努力度（iconBrain + 原生 select），仅实例记忆，刷新后回到默认。
    private reasoningEffortSelect: HTMLSelectElement;
    private selectedReasoningEffort = "";
    private userScrolledUp = false;
    private programmaticScroll = false;
    private stickResizeObserver: ResizeObserver | null = null;
    // 按会话保存的距底部距离（scrollHeight - scrollTop），用于切换会话与开关 dock 面板后恢复滚动位置。
    // 用距底距离而非绝对 scrollTop：dock 展开/折叠有宽高过渡，期间 scrollHeight 变化，
    // 距底距离与之无关，恢复后能定位到同样的相对位置。
    private scrollBottomBySession: Map<string, number> = new Map();
    // 面板可见性：dock 关闭时容器尺寸归零、浏览器把 scrollTop 钳制到 0，折叠期间不记录滚动位置。
    private layoutVisible = true;
    private layoutResizeObserver: ResizeObserver | null = null;
    private settingDialogObserver: MutationObserver | null = null;
    private scrollBottomBtn: HTMLElement;
    private navRail: HTMLElement;
    private navExpandTimer = 0;
    // 镜像态：当前会话正由其他实例流式对话，本实例处于只读占位锁定，期间不重绘当前视图。
    // 由 ws 的 streamStart/streamEnd 事件驱动，与发起者的 isStreaming 互斥（发起者走 SSE）。
    private mirrorLocked = false;
    private mirrorPlaceholderEl: HTMLElement | null = null;
    // 思考计时器：流式进行时每 100ms 刷新未完成思考卡片的标题为「思考中... X.Xs」。
    private thinkingTimerId = 0;
    // 上一个 thinking step 快照时 currentToolCalls 的长度基准，
    // 用于计算本轮新增的工具（避免 step.toolNames 累积重复历史工具）。
    private lastStepToolCount = 0;

    constructor(app: App, tab: Tab) {
        super({app: app});
        this.parent = tab;
        this.lute = getAgentLute({
            emojiSite: "/emojis",
            emojis: {}
        });
        this.defaultTitle = window.siyuan.languages.agentChat || "Agent";
        this.sessionTitle = this.defaultTitle;
        this.initUI();
        this.bindEvents();
        // 接入 ws 以接收跨实例的会话变更通知（agentSessionChanged）。
        // AgentChat dock 是单例常驻，ws 随之常驻，与 Backlink/Bookmark 等现有 dock 一致。
        this.connect({
            id: genUUID(),
            type: "agentChat",
            msgCallback: (data) => this.onWsMessage(data),
        });
        // AI 配置保存走本地 patch（aiRuntime.ts 写 window.siyuan.config.ai）不广播 ws，
        // 故用两种方式兜底：window focus（跨窗口）+ MutationObserver 监听设置对话框关闭（同窗口即时）。
        window.addEventListener("focus", this.checkConfigChangedHandler);
        // 设置对话框是 SiYuan 内部模态，关闭时 window 不失焦，focus 事件不触发。
        // 监听 body 子节点变化，当含 .config__panel 的设置 dialog 被移除时即时刷新。
        this.settingDialogObserver = new MutationObserver(() => {
            if (!document.querySelector(".config__panel")) {
                this.checkConfigChanged();
            }
        });
        this.settingDialogObserver.observe(document.body, {childList: true, subtree: false});
    }

    private checkConfigChangedHandler = () => {
        this.checkConfigChanged();
    };

    // 比较 window.siyuan.config.ai 实际可用模型数与缓存 modelOptions，不一致则刷新。
    // 仅当处于欢迎页（无会话内容）时重渲染，以便从无模型提示块切回示例或反之；
    // 有会话内容时不重绘（避免破坏对话），refreshModelOptions 内已刷新 trigger 显示。
    private checkConfigChanged() {
        const actualCount = AgentChat.countUsableModels(window.siyuan.config.ai);
        if (actualCount === this.modelOptions.length) {
            return;
        }
        this.refreshModelOptions();
        if (this.entries.length === 0 && this.messagesContainer.querySelector(".agent-welcome")) {
            this.showWelcome();
        }
    }

    // 与 refreshModelOptions / 后端 HasAnyProvider() 一致的"可用模型"计数。
    private static countUsableModels(aiConfig: Config.IAI): number {
        let count = 0;
        for (const prov of aiConfig.providers || []) {
            if (!prov.enabled) {
                continue;
            }
            for (const m of prov.models) {
                if (m.enabled && (m.displayName || m.name)) {
                    count++;
                }
            }
        }
        return count;
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
            '<span class="fn__flex-1"></span>' +
            '<span class="agent-chat__tokens fn__none b3-button b3-button--icon b3-button--cancel" aria-label="' + (L.tokenUsage || "Context Usage") + '">' +
            '<svg viewBox="0 0 24 24">' +
            '<circle class="agent-chat__tokens-track" cx="12" cy="12" r="9" stroke-width="3"></circle>' +
            '<circle class="agent-chat__tokens-arc" cx="12" cy="12" r="9" stroke-width="3" stroke-dasharray="0 56.55"></circle>' +
            "</svg>" +
            "</span>" +
            '<select class="b3-select b3-select--noborder" tabindex="0"></select>' +
            '<div class="b3-form__icon ariaLabel" aria-label="' + (L.reasoningEffortTooltip || "Reasoning effort") + '"><svg class="b3-form__icon-icon"><use xlink:href="#iconBrain"></use></svg><select class="b3-select b3-select--noborder b3-form__icon-input" tabindex="0"></select></div>' +
            '<button class="agent-chat__send b3-button b3-button--icon b3-button--text ariaLabel" aria-label="' + (L.agentSend || "Send") + '"><svg><use xlink:href="#iconSend"></use></svg></button>' +
            '<button class="agent-chat__stop b3-button b3-button--icon b3-button--cancel fn__none ariaLabel" aria-label="' + (L.agentStop || "Stop") + '"><svg><use xlink:href="#iconSquareStop"></use></svg></button>' +
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
        this.modelSelect = panel.querySelector(".b3-select") as HTMLSelectElement;
        this.reasoningEffortSelect = panel.querySelector(".b3-form__icon-input") as HTMLSelectElement;
        this.initReasoningEffortSelect();
        this.scrollBottomBtn = panel.querySelector(".agent-chat__scroll-bottom") as HTMLElement;
        this.messagesContainer.addEventListener("scroll", () => {
            const {scrollTop, scrollHeight, clientHeight} = this.messagesContainer;
            // 仅在面板有效展开时记录滚动位置：dock 折叠过渡期间容器尺寸归零、浏览器把 scrollTop
            // 钳制到 0，该过程会触发 scroll 事件；若不据尺寸排除，会污染保存的距底距离。
            // 用 clientHeight 判定（折叠时为 0），比 layoutVisible 标志更可靠——后者由
            // ResizeObserver 异步设置，可能与本事件交错。
            if (this.layoutVisible && clientHeight > 0 && this.sessionId) {
                this.scrollBottomBySession.set(this.sessionId, scrollHeight - scrollTop);
            }
            if (this.programmaticScroll) {
                return;
            }
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
        }, () => {
            // 内容变化时刷新发送按钮可用性（含用户输入、IME、程序化 clear 等所有 doc 变更）。
            this.updateSendButtonState();
        });
        // 块拖拽由 protyle 统一处理（复制块/引用/嵌入块→引用），无需自定义 drop handler。
        this.sessionPanel = new AgentSessionPanel(
            this.sessionMenuBtn,
            this.parent.panelElement,
            () => this.sessionId,
            () => this.defaultTitle,
            {
                onSwitch: (id) => this.switchSession(id),
                onDelete: (id) => this.deleteSession(id),
                onRename: async (id, title) => {
                    if (id === this.sessionId) {
                        this.sessionTitle = title;
                        this.titleElement.textContent = title;
                        // 当前轮次开始前后都依赖同一个内容修订号。流式中只更新本地标题，
                        // 由终止提交一并落盘，避免元数据保存抢先递增修订号。
                        if (this.isStreaming || this.currentTurnID) {
                            this.pendingSessionTitle = title;
                            return;
                        }
                    }
                    await SessionStore.rename(id, title);
                },
            }
        );
        // 监听滚动容器尺寸：dock 面板折叠时容器尺寸归零、浏览器把 scrollTop 钳制到 0；
        // 这里在面板重新展开后恢复当前会话的滚动位置。dock 展开/折叠有 CSS 宽高过渡（约 0.2s），
        // 过渡期间 scrollHeight 随尺寸变化，故在折叠→展开转换后用 rAF 循环持续校正约 320ms，
        // 覆盖过渡动画直到布局稳定。
        this.layoutResizeObserver = new ResizeObserver(() => {
            const collapsed = this.messagesContainer.clientWidth === 0 || this.messagesContainer.clientHeight === 0;
            if (collapsed) {
                this.layoutVisible = false;
                return;
            }
            // 仅在「刚从折叠恢复」时启动一次校正循环，避免干扰正常滚动 / 流式输出。
            if (!this.layoutVisible) {
                this.layoutVisible = true;
                const saved = this.scrollBottomBySession.get(this.sessionId) ?? 0;
                this.restoreScrollToBottom(saved);
            }
        });
        this.layoutResizeObserver.observe(this.messagesContainer);

        this.initSessions();
    }

    private initModelSelect() {
        this.refreshModelOptions();
        // 选中模型变更：原生 select 的 change 事件，无需自定义菜单逻辑。
        this.modelSelect.addEventListener("change", () => {
            this.selectedModel = this.modelSelect.value;
        });
        // 无模型时拦截下拉展开，改为打开设置-人工智能面板（动态 import 避免循环依赖）。
        this.modelSelect.addEventListener("mousedown", (e: MouseEvent) => {
            if (this.modelOptions.length > 0) {
                return;
            }
            e.preventDefault();
            this.openAiSetting();
        });
    }

    // 打开设置面板并切换到「人工智能」tab。动态 import config 模块避免与 AgentChat 的循环依赖。
    private async openAiSetting() {
        const {openSetting} = await import("../../../config");
        // openSetting 若已有设置对话框会先销毁重建，先检测复用避免闪烁。
        const existing = window.siyuan.dialogs.find(d => d.element.querySelector(".config__tab-container"));
        if (!existing) {
            openSetting(this.app, "ai");
        }
    }

    // 将外部块引用以 mention chip 形式追加到发送框末尾，等价于拖拽块到发送框或在框内 @ 搜索选块。
    public insertBlockMentions(mentions: Array<{ id: string; label: string }>) {
        if (this.composer && mentions.length > 0) {
            this.composer.insertMentions(mentions);
        }
    }

    // 从 window.siyuan.config.ai 重新计算可用模型列表，幂等可重复调用。
    // 与后端 HasAnyProvider()/GetModel() 判定一致：provider 和 model 均需 enabled。
    // 零模型时显式置空 selectedModel（避免 undefined 透传到后端），失效选择自动重置。
    refreshModelOptions() {
        const aiConfig = window.siyuan.config.ai;
        const newOptions: Array<{ id: string; name: string }> = [];
        for (const prov of aiConfig.providers || []) {
            if (!prov.enabled) {
                continue;
            }
            for (const m of prov.models) {
                if (!m.enabled) {
                    continue;
                }
                const displayName = m.displayName || m.name;
                if (!displayName) {
                    continue;
                }
                newOptions.push({id: m.id || m.name, name: displayName});
            }
        }
        this.modelOptions = newOptions;
        // 若当前选择已失效（不在新列表中），则重置：有模型取第一个，无模型显式置空。
        const stillValid = this.selectedModel && newOptions.some(o => o.id === this.selectedModel);
        if (!stillValid) {
            this.selectedModel = newOptions.length > 0 ? newOptions[0].id : "";
        }
        this.updateModelLabel();
        this.updateSendButtonState();
    }

    private updateModelLabel() {
        // 重建 <option> 列表。无可用模型时插入一个占位项，点击 select 打开设置-人工智能。
        let html = "";
        if (this.modelOptions.length === 0) {
            const placeholder = window.siyuan.languages.noModelConfigured || "No model configured";
            html = '<option value="" selected>' + escapeHtml(placeholder) + "</option>";
            this.modelSelect.innerHTML = html;
            this.modelSelect.disabled = true;
            return;
        }
        this.modelSelect.disabled = false;
        for (const o of this.modelOptions) {
            html += '<option value="' + escapeHtml(o.id) + '">' + escapeHtml(o.name) + "</option>";
        }
        this.modelSelect.innerHTML = html;
        this.modelSelect.value = this.selectedModel;
    }

    private getSelectedModel(): string {
        return this.selectedModel;
    }

    // 根据当前选中值刷新按钮上的文字（默认/低/中/高）。
    // 初始化思考强度原生 select：填充 4 个选项并绑定 change，模式与 initModelSelect 一致。
    private initReasoningEffortSelect() {
        const L = window.siyuan.languages;
        const options: Array<{ value: string; label: string }> = [
            {value: "", label: L.reasoningEffortDefault || "Default"},
            {value: "low", label: L.reasoningEffortLow || "Low"},
            {value: "medium", label: L.reasoningEffortMedium || "Medium"},
            {value: "high", label: L.reasoningEffortHigh || "High"},
        ];
        this.reasoningEffortSelect.innerHTML = options
            .map(o => '<option value="' + escapeHtml(o.value) + '">' + escapeHtml(o.label) + "</option>")
            .join("");
        this.reasoningEffortSelect.value = this.selectedReasoningEffort;
        this.reasoningEffortSelect.addEventListener("change", () => {
            this.selectedReasoningEffort = this.reasoningEffortSelect.value;
        });
    }

    // 校验会话持久化的 model ID 是否仍存在于当前配置中。有效则赋值并刷新 label，无效则保持当前选择。
    // 避免加载旧会话时把已删除模型的 stale ID 透传给后端导致静默失败。
    private applySessionModelIfValid(modelId?: string) {
        if (modelId && this.modelOptions.some(o => o.id === modelId)) {
            this.selectedModel = modelId;
        }
        this.updateModelLabel();
    }

    private showWelcome() {
        this.editingUserEntryID = "";
        const hasModel = this.modelOptions.length > 0;
        this.messagesContainer.innerHTML = renderWelcomeHTML(hasModel);
        if (!hasModel) {
            // 无模型：绑定「去配置」按钮，点击打开设置-人工智能面板。
            const goBtn = this.messagesContainer.querySelector(".agent-welcome__go-setting");
            if (goBtn) {
                goBtn.addEventListener("click", () => {
                    this.openAiSetting();
                });
            }
            return;
        }
        const examples = this.messagesContainer.querySelectorAll(".agent-welcome__example");
        examples.forEach((example) => {
            const ex = example as HTMLElement;
            ex.addEventListener("click", async () => {
                const text = ex.getAttribute("data-text") || "";
                if (text && this.composer) {
                    this.messagesContainer.innerHTML = "";
                    const userEntryId = SessionStore.newSessionId();
                    this.entries.push({id: userEntryId, type: "user", content: text, timestamp: Date.now()});
                    this.appendUserMessage(text, Date.now(), userEntryId);
                    this.rebuildNavMarkers();
                    this.tryGenerateTitle();
                    this.setStreaming(true);
                    try {
                        await this.saveSession();
                    } catch (e) {
                        this.rollbackUserEntry(userEntryId);
                        this.setStreaming(false);
                        await this.reloadFromDisk();
                        return;
                    }
                    this.abortController = new AbortController();
                    const requestSessionId = this.sessionId;
                    this.requestStartTime = Date.now();
                    this.currentThinkingDuration = 0;
                    this.currentTurnID = "";
                    await fetchAgentSSE(text, window.siyuan.config.appearance.lang, [],
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
                            if (err instanceof AgentHttpError && err.status === 409) {
                                return this.handleConflictReject();
                            }
                            return this.handleConfigError(err, userEntryId);
                        },
                        this.abortController.signal,
                        this.sessionId,
                        this.getSelectedModel(),
                        this.selectedReasoningEffort,
                        undefined,
                        undefined,
                        undefined,
                        userEntryId,
                        SessionStore.getRevision(this.sessionId));
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
            if (!marker) {
                return;
            }
            this.jumpToMessage(marker.dataset.messageId || "");
        });

        wrap.appendChild(this.navRail);
    }

    private rebuildNavMarkers() {
        this.navRail.innerHTML = "";
        const userEntries = this.entries.filter((entry): entry is UserEntry => entry.type === "user");
        if (userEntries.length === 0) {
            return;
        }

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
        if (userMsgs.length === 0) {
            return;
        }
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
        if (!messageId) {
            return;
        }
        const el = this.messagesContainer.querySelector('[data-message-id="' + messageId + '"]') as HTMLElement;
        if (!el) {
            return;
        }
        el.scrollIntoView({behavior: "smooth", block: "center"});
        el.classList.add("agent-chat__msg--jumped");
        setTimeout(() => {
            el.classList.remove("agent-chat__msg--jumped");
        }, 1500);
    }

    private bindEvents() {
        // hover 底部 tokens 数字弹出分类明细面板。
        // 仅在支持 hover 的设备绑定 mouseenter/mouseleave（移动端 tap 会合成 mouse 事件导致闪烁）；
        // 不支持 hover 的设备（移动端）用 click 切换。
        const supportsHover = window.matchMedia("(hover: hover)").matches;
        if (supportsHover) {
            this.tokenDisplayEl.addEventListener("mouseenter", () => {
                window.clearTimeout(this.tokenPopupHideTimer);
                this.tokenPopupShowTimer = window.setTimeout(() => {
                    this.showTokenBreakdownPopup();
                }, 200);
            });
            this.tokenDisplayEl.addEventListener("mouseleave", () => {
                window.clearTimeout(this.tokenPopupShowTimer);
                this.tokenPopupHideTimer = window.setTimeout(() => {
                    this.closeTokenBreakdownPopup();
                }, 300);
            });
        }
        // 所有设备：点击 toggle 浮层。hover 设备上 stopPropagation 阻止冒泡到 document 的 outside click handler，
        // 避免悬浮显示后点击反而关闭（反直觉）。
        this.tokenDisplayEl.addEventListener("click", (e: MouseEvent) => {
            e.stopPropagation();
            if (this.tokenPopup) {
                this.closeTokenBreakdownPopup();
            } else {
                this.showTokenBreakdownPopup();
            }
        });
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
            setPanelFocus(this.parent.panelElement);
            this.createSession();
        });
        this.sessionMenuBtn.addEventListener("click", (e: MouseEvent) => {
            e.stopPropagation();
            setPanelFocus(this.parent.panelElement);
            this.sessionPanel.toggle();
        });

        this.parent.panelElement.addEventListener("click", (e: MouseEvent) => {
            setPanelFocus(this.parent.panelElement);
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
            if (t.closest(".b3-select")) {
                return;
            }
            if (this.composer) {
                this.composer.focus();
            }
        });
        this.scrollBottomBtn.addEventListener("click", () => {
            this.scrollToBottom(true, true);
        });
    }

    private async initSessions() {
        // 启动时始终进入新会话界面（欢迎页），不自动加载上次会话内容。
        // 历史会话仍可通过会话面板点击切换查看。
        await SessionStore.init();
        this.sessionId = SessionStore.newSessionId();
        this.sessionCreatedAt = Date.now();
        this.sessionTitle = this.defaultTitle;
        this.pendingSessionTitle = null;
        this.entries = [];
        this.showWelcome();
        this.scrollToBottom(true);
    }

    private async saveSession(commitTurnID?: string): Promise<AgentSession | null> {
        if (this.entries.length === 0) {
            return null;
        }
        const sessionID = this.sessionId;
        const recoveryTurnID = this.recoveryCommitTurnIDs.get(sessionID);
        const turnID = commitTurnID || recoveryTurnID;
        const pendingTitle = this.pendingSessionTitle;
        const session: AgentSession = {
            id: sessionID,
            title: this.sessionTitle,
            titled: this.hasTitled,
            entries: JSON.parse(JSON.stringify(this.entries.concat(this.pendingConfirms))) as AgentSession["entries"],
            contextTokens: this.contextTokens,
            contextTokenBreakdown: this.contextTokenBreakdown,
            contextCachedTokens: this.contextCachedTokens,
            contextLimit: this.contextLimit,
            createdAt: this.sessionCreatedAt,
            updatedAt: Date.now(),
            messageHistory: this.composer?.getHistory() || [],
            model: this.getSelectedModel(),
        };
        if (turnID) {
            session.commitTurnID = turnID;
        }
        const result = await SessionStore.save(session);
        if (turnID && this.recoveryCommitTurnIDs.get(sessionID) === turnID) {
            this.recoveryCommitTurnIDs.delete(sessionID);
        }
        if (turnID) {
            this.pendingRecoverySessionIDs.delete(sessionID);
        }
        if (this.sessionId !== sessionID) {
            return result.session ?? null;
        }
        if (pendingTitle !== null && pendingTitle === session.title && this.pendingSessionTitle === pendingTitle) {
            this.pendingSessionTitle = null;
        }
        if (turnID && this.currentTurnID === turnID) {
            this.currentTurnID = "";
        }
        if (this.pendingSessionTitle !== null && !this.isStreaming && !this.currentTurnID) {
            await this.saveSession();
        }
        return result.session ?? null;
    }

    // 处理 ws 推送的跨实例会话变更通知。核心时序控制：
    // - streamStart：其他实例开始流式。立即从磁盘拉取一次（发起者发消息时已把 user 消息落盘），
    //   让本轮用户新消息尽快可见，然后进入占位锁定显示"AI 回复生成中"。
    // - update：会话保存或未提交运行时进入可恢复状态。每次都读取后端权威视图；流式中途的保存
    //   只包含已完成历史和交互卡片，不会把半截 assistant 文本当成最终结果。
    // - streamEnd：后端 eventCh 关闭（流结束），只解除占位锁定；已提交内容由 saveSession 的 update
    //   同步，未提交内容由后端紧随其后的恢复 update 同步。
    // - delete：当前会话被删除则清空视图。
    private onWsMessage(data: IWebSocketData) {
        if (!data || data.cmd !== "agentSessionChanged") {
            return;
        }
        const payload = data.data as { sessionID: string; action: string } | undefined;
        if (!payload) {
            return;
        }
        // 所有变更都刷新会话列表（标题/时间/增删）。
        this.sessionPanel?.refresh();
        // 只处理当前会话；其他会话的变化仅体现在列表刷新里。
        if (payload.sessionID !== this.sessionId) {
            return;
        }
        // 发起者自身流式中忽略（它走 SSE 自渲染）。
        if (this.isStreaming) {
            return;
        }
        switch (payload.action) {
            case "streamStart":
                // 标记处于其他实例流式中，reloadFromDisk 重绘后会据此保留占位条。
                this.mirrorLocked = true;
                // 立即拉取一次：发起者发消息时已 saveSession 写入 user 消息，让本轮新消息尽快可见。
                void this.reloadFromDisk();
                break;
            case "streamEnd":
                // 流结束，解除占位锁定并移除占位条。不重绘——完整内容由随后的 update 广播驱动。
                this.mirrorLocked = false;
                this.removeMirrorPlaceholder();
                this.restorePendingEditDraft();
                break;
            case "update":
                void this.reloadFromDisk().then(() => {
                    if (this.pendingRecoverySessionIDs.has(payload.sessionID)) {
                        void this.recoverInterruptedTurn(payload.sessionID, this.currentTurnID);
                    }
                    if (!this.mirrorLocked) {
                        this.restorePendingEditDraft();
                    }
                });
                break;
            case "delete":
                this.mirrorLocked = false;
                this.handleCurrentSessionDeleted();
                break;
        }
    }

    // 显示"其他实例正在对话中…"只读占位条。不进入 setStreaming 态（不切换 stop 按钮、不置灰 composer）。
    private showMirrorPlaceholder() {
        if (this.mirrorPlaceholderEl) {
            return;
        }
        this.removeMirrorPlaceholder();
        const L = window.siyuan.languages;
        const el = document.createElement("div");
        el.className = "agent-chat__msg agent-chat__msg--mirror";
        el.innerHTML = '<div class="agent-chat__body agent-chat__body--mirror">' +
            '<span class="agent-chat__mirror-spinner"></span>' +
            "<span>" + escapeHtml(L.agentMirrorStreaming || "Another instance is chatting...") + "</span>" +
            "</div>";
        this.messagesContainer.appendChild(el);
        this.mirrorPlaceholderEl = el;
        this.scrollToBottom();
    }

    private removeMirrorPlaceholder() {
        if (this.mirrorPlaceholderEl) {
            this.mirrorPlaceholderEl.remove();
            this.mirrorPlaceholderEl = null;
        }
    }

    // 镜像端从磁盘拉取整条会话权威数据重绘。仅 entries 变化时清空重绘，避免无谓跳变。
    private async reloadFromDisk(forceRender = false) {
        const targetSessionId = this.sessionId;
        const session = await SessionStore.load(targetSessionId);
        // await 期间用户可能已切换会话，丢弃过期结果。
        if (targetSessionId !== this.sessionId) {
            return;
        }
        if (!session) {
            return;
        }
        const newEntries = this.buildEntriesFromSession(session);
        if (!forceRender && this.entriesEqual(newEntries, this.entries)) {
            // 内容未变，仅更新元数据（标题等）。
            this.updateMetaFromSession(session);
            return;
        }
        const atBottom = this.isScrolledToBottom();
        const savedScroll = this.messagesContainer.scrollTop;
        if (forceRender) {
            this.currentAIElement = null;
            this.observeStickTarget(null);
            this.currentAssistantEntryId = "";
            this.currentContent = "";
            this.fullContent = "";
            this.currentToolCalls = [];
            this.pendingConfirms = [];
            this.currentThinkingSteps = [];
            this.currentThinkingEntryId = "";
            this.currentThinkingStepContent = "";
            this.currentThinkingText = "";
            this.currentThinkingReasoning = "";
            this.currentThinkingReasoningContent = "";
            this.currentThinkingDuration = 0;
            this.lastStepToolCount = 0;
            this.renderedToolNames = {};
            this.hasInterveningCard = false;
        }
        this.entries = newEntries;
        this.updateMetaFromSession(session);
        this.messagesContainer.innerHTML = "";
        this.renderLoadedSession(session);
        this.rebuildNavMarkers();
        if (atBottom) {
            this.scrollToBottom(true);
        } else {
            this.messagesContainer.scrollTop = savedScroll;
        }
        // 重绘会清空 DOM（含占位条）；若仍处于其他实例的流式中，重新显示占位条。
        if (this.mirrorLocked) {
            this.showMirrorPlaceholder();
        } else {
            this.removeMirrorPlaceholder();
        }
    }

    private async recoverInterruptedTurn(sessionID: string, turnID = "") {
        this.pendingRecoverySessionIDs.add(sessionID);
        if (this.recoveryInFlightSessionIDs.has(sessionID)) {
            return;
        }
        this.recoveryInFlightSessionIDs.add(sessionID);
        const retryDelays = [100, 200, 400, 800, 1600, 3200];
        try {
            for (const delay of retryDelays) {
                await new Promise((resolve) => window.setTimeout(resolve, delay));
                if (this.sessionId !== sessionID || this.isStreaming) {
                    return;
                }
                let session: AgentSession | null;
                try {
                    session = await SessionStore.load(sessionID);
                } catch (e) {
                    console.error("recover interrupted agent turn failed:", e);
                    continue;
                }
                if (!session?.recoveryTurnID) {
                    if (session && !session.agentRunning) {
                        this.pendingRecoverySessionIDs.delete(sessionID);
                        if (!turnID || this.currentTurnID === turnID) {
                            this.currentTurnID = "";
                        }
                        return;
                    }
                    continue;
                }
                if (turnID && session.recoveryTurnID !== turnID) {
                    continue;
                }
                try {
                    await this.reloadFromDisk(true);
                    if (this.sessionId !== sessionID) {
                        return;
                    }
                    if (this.recoveryCommitTurnIDs.get(sessionID) !== session.recoveryTurnID) {
                        continue;
                    }
                    this.currentTurnID = "";
                    await this.saveSession();
                    this.pendingRecoverySessionIDs.delete(sessionID);
                    return;
                } catch (e) {
                    console.error("commit recovered agent turn failed:", e);
                }
            }
        } finally {
            this.recoveryInFlightSessionIDs.delete(sessionID);
        }
    }

    private async prepareForNewTurn(): Promise<boolean> {
        const sessionID = this.sessionId;
        if (this.pendingRecoverySessionIDs.has(sessionID) && !this.recoveryCommitTurnIDs.has(sessionID)) {
            void this.recoverInterruptedTurn(sessionID, this.currentTurnID);
            const L = window.siyuan.languages;
            showMessage(L.agentChatBusy || "This session is busy in another instance", 3000);
            return false;
        }
        if (!this.recoveryCommitTurnIDs.has(sessionID)) {
            return true;
        }
        try {
            await this.saveSession();
            return this.sessionId === sessionID;
        } catch (e) {
            await this.reloadFromDisk(true);
            return false;
        }
    }

    // 从 session 更新标题/时间戳/token 计数/model 等元数据，不动 entries 与 DOM。
    private updateMetaFromSession(session: AgentSession) {
        this.sessionTitle = this.pendingSessionTitle || session.title || this.defaultTitle;
        this.hasTitled = session.titled !== false;
        this.sessionCreatedAt = session.createdAt || this.sessionCreatedAt;
        this.contextTokens = session.contextTokens ?? 0;
        this.contextTokenBreakdown = session.contextTokenBreakdown ?? {};
        this.contextCachedTokens = session.contextCachedTokens ?? 0;
        this.contextLimit = session.contextLimit ?? 0;
        if (session.recoveryTurnID) {
            this.recoveryCommitTurnIDs.set(session.id, session.recoveryTurnID);
        } else {
            this.recoveryCommitTurnIDs.delete(session.id);
        }
        if (session.model) {
            this.applySessionModelIfValid(session.model);
        }
        this.titleElement.textContent = this.sessionTitle;
        this.updateTokenDisplay();
    }

    // 浅比较两个 entries 数组是否等价（用于判断是否需要重绘）。用 JSON 序列化比较，简单可靠。
    private entriesEqual(a: SessionEntry[], b: SessionEntry[]): boolean {
        if (a === b) {
            return true;
        }
        if (a.length !== b.length) {
            return false;
        }
        return JSON.stringify(a) === JSON.stringify(b);
    }

    private isScrolledToBottom(): boolean {
        const {scrollTop, scrollHeight, clientHeight} = this.messagesContainer;
        return scrollHeight - scrollTop - clientHeight <= 60;
    }

    // 当前会话被其他实例删除时，清空到欢迎页。不调 saveSession（会话已不存在于磁盘）。
    private handleCurrentSessionDeleted() {
        this.pendingEditDraft = null;
        const deletedSessionID = this.sessionId;
        this.removeMirrorPlaceholder();
        this.entries = [];
        this.sessionId = SessionStore.newSessionId();
        this.currentTurnID = "";
        this.sessionCreatedAt = Date.now();
        this.sessionTitle = this.defaultTitle;
        this.pendingSessionTitle = null;
        this.pendingRecoverySessionIDs.delete(deletedSessionID);
        this.recoveryCommitTurnIDs.delete(deletedSessionID);
        this.hasTitled = false;
        this.currentAIElement = null;
        this.currentContent = "";
        this.fullContent = "";
        this.currentToolCalls = [];
        this.pendingConfirms = [];
        this.messagesContainer.innerHTML = "";
        this.rebuildNavMarkers();
        this.titleElement.textContent = this.defaultTitle;
        this.showWelcome();
        this.scrollToBottom(true);
    }

    private async switchSession(id: string) {
        this.pendingEditDraft = null;
        const previousSessionID = this.sessionId;
        const hadActiveTurn = this.isStreaming || !!this.currentTurnID;
        if (hadActiveTurn) {
            this.pendingRecoverySessionIDs.add(previousSessionID);
            if (this.abortController) {
                this.abortController.abort();
                this.abortController = null;
            }
        }
        this.setStreaming(false);
        this.mirrorLocked = false;
        this.removeMirrorPlaceholder();
        this.finishActiveThinking();
        this.flushThinkingStep();
        if (!hadActiveTurn && !this.pendingRecoverySessionIDs.has(this.sessionId)) {
            await this.saveSession();
        }
        const session = await SessionStore.load(id);
        if (!session) {
            return;
        }
        this.sessionId = session.id;
        this.currentTurnID = "";
        if (session.recoveryTurnID) {
            this.recoveryCommitTurnIDs.set(session.id, session.recoveryTurnID);
        } else {
            this.recoveryCommitTurnIDs.delete(session.id);
        }
        if (this.composer) {
            this.composer.clearHistory();
            this.composer.restoreHistory(session.messageHistory || []);
        }
        this.sessionCreatedAt = session.createdAt || Date.now();
        this.sessionTitle = session.title;
        this.pendingSessionTitle = null;
        this.titleElement.textContent = session.title || this.defaultTitle;
        this.entries = this.buildEntriesFromSession(session);
        this.hasTitled = session.titled !== false;
        this.currentAIElement = null;
        this.currentContent = "";
        this.fullContent = "";
        this.contextTokens = session.contextTokens ?? 0;
        this.contextTokenBreakdown = session.contextTokenBreakdown ?? {};
        this.contextCachedTokens = session.contextCachedTokens ?? 0;
        this.contextLimit = session.contextLimit ?? 0;
        if (session.model) {
            this.applySessionModelIfValid(session.model);
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
            // 恢复该会话上次的滚动位置；新会话（无记录）默认贴底。
            if (this.scrollBottomBySession.has(session.id)) {
                this.restoreScrollToBottom(this.scrollBottomBySession.get(session.id) ?? 0);
            } else {
                this.scrollToBottom(true);
            }
            this.messagesContainer.classList.remove("agent-chat__messages--switching");
            if (this.pendingRecoverySessionIDs.has(session.id)) {
                void this.recoverInterruptedTurn(session.id);
            }
        }, {once: true});
    }

    private appendPersistedAssistant(content: string, timestamp?: number, entryId?: string) {
        if (!content || !content.trim()) {
            return;
        }
        const el = document.createElement("div");
        el.className = "agent-chat__msg agent-chat__msg--ai";
        if (entryId) {
            el.setAttribute("data-message-id", entryId);
        }
        el.innerHTML = '<div class="agent-chat__body b3-typography">' + (this.lute.ProtylePreviewStr("", content) || escapeHtml(content)) + "</div>";
        this.messagesContainer.appendChild(el);
        postRender(el, this.app);
        this.addCopyButton(el, content, timestamp);
    }

    private appendPersistedToolCalls(content: string, toolCalls: Array<{
        name: string;
        arguments: Record<string, unknown>;
        result?: string
    }>, timestamp?: number, entryId?: string) {
        let hasRendered = false;
        for (let i = 0; i < toolCalls.length; i++) {
            const tc = toolCalls[i];
            if (tc.result && tc.name === "todo_write") {
                const rel = document.createElement("div");
                rel.className = "agent-chat__msg agent-chat__msg--tool";
                // todo 卡片是 assistant entry 的附属展示，不单独持有 entryId
                // （entryId 属于后续的 AI 消息元素），避免多个 todo 共享同一 id。
                rel.innerHTML = renderTodoList(tc.result);
                this.messagesContainer.appendChild(rel);
                hasRendered = true;
            }
        }
        if (content && content.trim()) {
            this.appendPersistedAssistant(content, timestamp, entryId);
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
        effects?: IToolEffects;
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
        } else {
            // pending（用户未操作就切换/出错而落盘）：重载后无法再交互，
            // 至少显示一个状态提示，避免变成无按钮无文本的死卡片。
            statusLabel = L.agentConfirmPending || "Pending";
        }
        el.innerHTML = '<div class="agent-chat__confirm-card">' +
            '<div class="agent-chat__confirm-header"><svg class="agent-chat__confirm-icon"><use xlink:href="#iconInfo"></use></svg> ' + desc + "</div>" +
            this.renderConfirmEffects(entry.effects) +
            '<pre class="agent-chat__confirm-args">' + escapeHtml(argsStr) + "</pre>" +
            (statusLabel ? '<div class="agent-chat__confirm-actions"><span class="agent-chat__confirm-done">' + statusLabel + "</span></div>" : "") +
            "</div>";
        this.messagesContainer.appendChild(el);
    }

    // 持久化前精简 toolCalls：question 工具的完整 questions 参数已由独立的 question entry 存储，
    // assistant entry 的 toolCalls 里只需保留工具名和结果（供 LLM 上下文恢复），避免重复存储。
    private slimToolCallsForPersistence(toolCalls: Array<{
        name: string;
        arguments: Record<string, unknown>;
        result?: string
    }>): Array<{ name: string; arguments: Record<string, unknown>; result?: string }> {
        return toolCalls.map(tc => {
            if (tc.name === "question" && tc.arguments && tc.arguments.questions) {
                const slim = {...tc};
                const slimArgs = {...tc.arguments};
                delete slimArgs.questions;
                slim.arguments = slimArgs;
                return slim;
            }
            return tc;
        });
    }

    private appendPersistedQuestion(entry: {
        id?: string;
        questionID: string;
        questions: Array<Record<string, unknown>>;
        status?: string;
        answers?: string[];
    }) {
        const L = window.siyuan.languages;
        const el = document.createElement("div");
        // 重载后 question 不可再交互（后端已超时或会话已切换），统一显示为已确认态。
        el.className = "agent-chat__msg agent-chat__msg--question agent-chat__msg--confirmed";
        if (entry.id) {
            el.setAttribute("data-message-id", entry.id);
        }
        el.innerHTML = renderQuestionCardHTML(entry.questions, entry.questionID);
        // 用状态文本替换提交按钮区域，对齐实时提交后的呈现。
        const submit = el.querySelector(".agent-chat__question-submit") as HTMLElement;
        if (submit) {
            const submitted = entry.status === "submitted";
            submit.innerHTML = '<span class="agent-chat__confirm-done">' +
                (submitted ? (L.agentQuestionSubmitted || "Submitted") : (L.agentQuestionPending || "Awaiting answer")) +
                "</span>";
        }
        // 禁用所有输入，避免用户误以为还能提交。
        el.querySelectorAll("input").forEach((inp) => {
            (inp as HTMLInputElement).disabled = true;
        });
        // 恢复已提交的选中状态（answers 中存的是选项 value）。
        if (entry.answers && entry.answers.length > 0) {
            el.querySelectorAll("input[type=radio], input[type=checkbox]").forEach((inp) => {
                (inp as HTMLInputElement).checked = entry.answers!.includes((inp as HTMLInputElement).value);
            });
            const customInput = el.querySelector(".agent-chat__question-custom") as HTMLInputElement | null;
            if (customInput) {
                const customAnswer = entry.answers.find(a => el.querySelector('input[value="' + a + '"]') === null);
                if (customAnswer) {
                    customInput.value = customAnswer;
                }
            }
        }
        this.messagesContainer.appendChild(el);
    }

    private renderLoadedSession(session: AgentSession) {
        this.editingUserEntryID = "";
        for (let i = 0; i < session.entries.length; i++) {
            const entry = session.entries[i];
            const entryId = (entry as { id?: string }).id;
            switch (entry.type) {
                case "user":
                    this.appendUserMessage((entry as UserEntry).content, (entry as UserEntry).timestamp, entryId,
                        (entry as UserEntry).blockHTML);
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
                                if (m) {
                                    dur = parseFloat(m[1]);
                                }
                            }
                        }
                        this.renderMergedThinkingCard(normSteps, entryId, dur);
                    }
                    break;
                case "assistant": {
                    const a = entry as {
                        content: string;
                        toolCalls?: Array<{ name: string; arguments: Record<string, unknown>; result?: string }>;
                        timestamp?: number
                    };
                    if (a.toolCalls && a.toolCalls.length > 0) {
                        this.appendPersistedToolCalls(a.content, a.toolCalls, a.timestamp, entryId);
                    } else {
                        this.appendPersistedAssistant(a.content, a.timestamp, entryId);
                    }
                    break;
                }
                case "confirm":
                    this.appendPersistedConfirm(entry as unknown as {
                        id?: string;
                        name: string;
                        args: Record<string, unknown>;
                        confirmID: string;
                        status?: string
                    });
                    break;
                case "question":
                    this.appendPersistedQuestion(entry as unknown as {
                        id?: string;
                        questionID: string;
                        questions: Array<Record<string, unknown>>;
                        status?: string;
                        answers?: string[];
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
        this.pendingEditDraft = null;
        const previousSessionID = this.sessionId;
        const hadActiveTurn = this.isStreaming || !!this.currentTurnID;
        if (hadActiveTurn) {
            this.pendingRecoverySessionIDs.add(previousSessionID);
        }
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
        this.setStreaming(false);
        this.mirrorLocked = false;
        this.removeMirrorPlaceholder();
        this.finishActiveThinking();
        this.flushThinkingStep();
        if (!hadActiveTurn && !this.pendingRecoverySessionIDs.has(this.sessionId)) {
            await this.saveSession();
        }
        this.sessionId = SessionStore.newSessionId();
        this.currentTurnID = "";
        this.sessionCreatedAt = Date.now();
        if (this.composer) {
            this.composer.clearHistory();
        }
        this.sessionTitle = this.defaultTitle;
        this.pendingSessionTitle = null;
        this.entries = [];
        this.hasTitled = false;
        this.currentAIElement = null;
        this.currentContent = "";
        this.fullContent = "";
        this.contextTokens = 0;
        this.contextTokenBreakdown = {};
        this.contextCachedTokens = 0;
        this.contextLimit = 0;
        this.currentToolCalls = [];
        this.lastStepToolCount = 0;
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
        // clear() 是程序化清空，不触发原生 input 事件，需显式刷新发送按钮（空输入 → 禁用）。
        this.updateSendButtonState();
        this.showWelcome();
        this.scrollToBottom(true);
    }

    private async deleteSession(id: string) {
        if (id === this.sessionId && (this.isStreaming || !!this.currentTurnID ||
            this.pendingRecoverySessionIDs.has(id))) {
            const L = window.siyuan.languages;
            showMessage(L.agentChatBusy || "This session is busy in another instance", 3000);
            return;
        }
        this.scrollBottomBySession.delete(id);
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
        this.pendingRecoverySessionIDs.delete(id);
        this.recoveryCommitTurnIDs.delete(id);
    }

    private async sendMessage() {
        if (!this.composer) {
            return;
        }
        const sendData = this.composer.getSendData();
        const text = sendData.text;
        const blockHTML = sendData.blockHTML;
        const refs = sendData.references;
        const editorContext = this.captureEditorContext();
        const pluginActions = this.getPluginActions();
        if (!text || this.isStreaming || this.modelOptions.length === 0) {
            return;
        }
        if (!await this.prepareForNewTurn()) {
            return;
        }

        this.setStreaming(true);
        this.clearThinking();
        this.hasInterveningCard = false;
        this.composer.clear();

        const userEntryId = SessionStore.newSessionId();
        this.entries.push({
            id: userEntryId,
            type: "user",
            content: text,
            blockHTML,
            references: refs.length > 0 ? refs : undefined,
            editorContext,
            timestamp: Date.now(),
        });
        if (this.entries.length === 1) {
            this.messagesContainer.innerHTML = "";
        }
        this.appendUserMessage(text, Date.now(), userEntryId, blockHTML);
        this.rebuildNavMarkers();
        this.tryGenerateTitle();
        if (this.composer) {
            this.composer.pushHistory(text);
        }
        try {
            await this.saveSession();
        } catch (e) {
            this.rollbackUserEntry(userEntryId);
            this.setStreaming(false);
            await this.reloadFromDisk();
            return;
        }

        this.requestStartTime = Date.now();
        this.currentThinkingDuration = 0;
        this.currentTurnID = "";

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
                // 409：该会话正在其他实例对话中（实例级互斥）。重载磁盘权威状态，不进入流式。
                if (err instanceof AgentHttpError && err.status === 409) {
                    this.handleConflictReject();
                    return;
                }
                return this.handleConfigError(err, userEntryId);
            },
            this.abortController.signal,
            this.sessionId,
            this.getSelectedModel(),
            this.selectedReasoningEffort,
            undefined,
            editorContext,
            pluginActions,
            userEntryId,
            SessionStore.getRevision(this.sessionId),
        );
    }

    // 实例级互斥被拒（409）说明另一实例已在本轮保存之后抢先启动。此时磁盘可能已有对方的新消息，
    // 不能再用本地快照回滚；直接重载权威会话，避免覆盖另一实例的数据。
    private async handleConflictReject() {
        this.requestStartTime = 0;
        this.setStreaming(false);
        await this.reloadFromDisk(true);
        this.restorePendingEditDraft();
        const L = window.siyuan.languages;
        showMessage(L.agentChatBusy || "This session is busy in another instance", 3000);
    }

    private restorePendingEditDraft() {
        const draft = this.pendingEditDraft;
        if (!draft) {
            return;
        }
        const userEl = this.messagesContainer.querySelector(
            '.agent-chat__msg--user[data-message-id="' + draft.entryID + '"]') as HTMLElement | null;
        if (userEl) {
            this.beginEditUserMessage(draft.entryID, userEl, draft.content);
        }
    }

    // 捕获发送消息时的只读编辑器快照，并注入对应的用户轮次上下文。
    // 扫描全部编辑器，优先选择可见且包含选中块的编辑器，以匹配用户所指的“这里选中的块”。
    // 若未找到，则依次使用 DOM 选区所在编辑器和最近激活的页签。
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
                    if (id) {
                        allSelected.push(id);
                    }
                });
        });
        allSelected = Array.from(new Set(allSelected));

        // Candidate selection, in priority order:
        let candidate: {
            protyle: {
                block?: { id?: string; rootID?: string };
                wysiwyg?: { element?: HTMLElement };
                element: HTMLElement;
                model?: { parent?: { headElement?: HTMLElement } }
            }
        } | undefined;

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

    private getPluginActions() {
        return listActions()
            .filter(action => action.name.startsWith("plugin__") && action.description)
            .map(action => ({name: action.name, description: action.description as string}));
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
                if (id) {
                    selectedBlockIDs.push(id);
                }
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
                if (!id) {
                    continue;
                }
                const rect = child.getBoundingClientRect();
                if (rect.height === 0) {
                    continue;
                }
                if (rect.bottom >= view.top && rect.top <= view.bottom) {
                    visibleBlockIDs.push(id);
                }
                if (visibleBlockIDs.length >= maxVisibleBlockIDs) {
                    break;
                }
            }
        }

        if (!activeDocID && !activeDocTitle && !notebookID &&
            !focusedBlockID && selectedBlockIDs.length === 0 && visibleBlockIDs.length === 0) {
            return undefined;
        }
        const ctx: IEditorContext = {};
        if (activeDocID) {
            ctx.activeDocID = activeDocID;
        }
        if (activeDocTitle) {
            ctx.activeDocTitle = activeDocTitle;
        }
        if (notebookID) {
            ctx.notebookID = notebookID;
        }
        if (focusedBlockID && focusedBlockID !== activeDocID) {
            ctx.focusedBlockID = focusedBlockID;
        }
        if (selectedBlockIDs.length > 0) {
            ctx.selectedBlockIDs = selectedBlockIDs;
        }
        if (visibleBlockIDs.length > 0) {
            ctx.visibleBlockIDs = visibleBlockIDs;
        }
        return ctx;
    }

    private async handleSSEEvent(event: ISSEResult) {
        try {
            switch (event.type) {
                case "turn":
                    this.currentTurnID = event.turnID;
                    break;
                case "content":
                    this.appendToken(event.token);
                    break;
                case "thinking":
                    this.appendThinking(event.reasoning);
                    break;
                case "tool_call":
                    this.currentToolCalls.push({name: event.name, arguments: event.arguments});
                    this.appendToolCall(event.name);
                    break;
                case "confirm":
                    this.setToolCallRunning(event.name, false);
                    this.appendConfirm(event.name, event.arguments, event.confirmID, event.effects);
                    break;
                case "tool_result":
                    {
                        const toolCall = this.currentToolCalls.find((item) => item.name === event.name && item.result === undefined);
                        if (toolCall) {
                            toolCall.result = event.result;
                        }
                    }
                    this.finishToolCall(event.name);
                    this.appendToolResult(event.name, event.result);
                    break;
                case "done":
                    this.currentTurnID = event.turnID || this.currentTurnID;
                    this.flushTokenUpdate();
                    await this.finishResponse();
                    break;
                case "usage":
                    this.appendUsage(event.lastPromptTokens, event.tokenBreakdown, event.cachedTokens, event.contextLimit);
                    break;
                case "error":
                    this.flushTokenUpdate();
                    this.requestStartTime = 0;
                    if (this.currentTurnID) {
                        // 服务端 error 是终止事件：此前已完成运行时检查点和所有工具结果发送，
                        // 因此可复用正常收尾，把部分回复与工具调用写入 entries 后提交该 turn。
                        await this.finishResponse(false);
                        this.appendError(event.message);
                    } else {
                        // turn 建立前的错误没有可提交的运行时，直接恢复磁盘权威状态。
                        await this.handleError(new Error(event.message));
                    }
                    break;
                case "interrupted":
                    await this.handleError(new Error(event.message));
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
                case "snapshot": {
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
            if (this.abortController) {
                this.abortController.abort();
                this.abortController = null;
            }
            this.flushTokenUpdate();
            this.requestStartTime = 0;
            this.setStreaming(false);
            const sessionID = this.sessionId;
            const turnID = this.currentTurnID;
            try {
                await this.reloadFromDisk(true);
            } catch (reloadError) {
                console.error("reload agent session after event failure failed:", reloadError);
            }
            if (this.sessionId === sessionID) {
                this.appendError((e as Error).message);
                if (turnID) {
                    void this.recoverInterruptedTurn(sessionID, turnID);
                }
            }
        }
    }

    private async handleError(err: Error) {
        this.flushTokenUpdate();
        this.requestStartTime = 0;
        this.setStreaming(false);
        const sessionID = this.sessionId;
        const turnID = this.currentTurnID;
        try {
            await this.reloadFromDisk(true);
        } catch (reloadError) {
            console.error("reload agent session after stream failure failed:", reloadError);
        }
        if (this.sessionId === sessionID) {
            if (!turnID) {
                this.restorePendingEditDraft();
            }
            this.appendError(err.message);
            // 网络断流不等于服务端 turn 已终止，不能提交并清除 runtime。待后端释放运行实例后
            // 再合并 runtime，避免重复执行结果未知的外部调用。turn 事件也可能在断流前尚未来得及送达。
            void this.recoverInterruptedTurn(sessionID, turnID);
        }
    }

    // 统一处理 fetchAgentSSE 的 onError：若为"未配置模型/提供商"则渲染可操作错误卡，
    // 否则回退到普通错误卡。userEntryId 用于在"未配置"时回滚刚追加的 user 消息（避免留下空对话）。
    private async handleConfigError(err: Error, userEntryId?: string, restoreSession = false) {
        this.flushTokenUpdate();
        if (this.currentContent) {
            this.finalizeStreamingBody(this.currentContent, Date.now());
        }
        this.requestStartTime = 0;
        const configMsg = window.siyuan.languages._kernel[193] || "";
        const isConfigError = !!configMsg && err.message === configMsg;
        if (isConfigError) {
            if (restoreSession) {
                // 重新生成在 Agent 建立 runtime 前只截断了前端视图；配置错误时应恢复原回答，
                // 不能把这个临时截断状态保存到 session.json。
                await this.reloadFromDisk(true);
            } else {
                if (userEntryId) {
                    this.rollbackUserEntry(userEntryId);
                }
                if (this.entries.length === 0) {
                    await SessionStore.remove(this.sessionId);
                    this.sessionTitle = this.defaultTitle;
                    this.pendingSessionTitle = null;
                    this.hasTitled = false;
                    this.titleElement.textContent = this.defaultTitle;
                    void this.sessionPanel?.refresh();
                } else {
                    await this.saveSession();
                }
            }
            await this.appendConfigurableError(configMsg);
        } else {
            await this.handleError(err);
            return;
        }
        this.setStreaming(false);
        if (isConfigError && restoreSession) {
            this.restorePendingEditDraft();
        }
    }

    // 回滚刚追加的 user entry 与 DOM 元素（用于"未配置"错误时避免留下空对话）。
    private rollbackUserEntry(userEntryId: string) {
        const idx = this.entries.findIndex(e => e.id === userEntryId);
        if (idx >= 0) {
            this.entries.splice(idx, 1);
        }
        const userEl = this.messagesContainer.querySelector('.agent-chat__msg--user[data-message-id="' + userEntryId + '"]');
        if (userEl) {
            userEl.remove();
        }
        this.rebuildNavMarkers();
    }

    private async appendConfigurableError(message: string) {
        this.finishActiveThinking();
        this.clearThinking();
        if (this.currentAIElement && !this.currentContent) {
            this.currentAIElement.remove();
        }
        this.currentAIElement = null;
        const el = document.createElement("div");
        el.className = "agent-chat__msg agent-chat__msg--error";
        el.innerHTML = '<div class="agent-chat__body agent-chat__body--error">' +
            '<svg class="agent-chat__error-icon"><use xlink:href="#iconTriangleAlert"></use></svg>' +
            "<span>" + escapeHtml(message) + "</span>" +
            "</div>";
        this.messagesContainer.appendChild(el);
        this.scrollToBottom(true);
        this.flushThinkingStep();
    }

    private createUserMessage(text: string, timestamp?: number, entryId?: string, blockHTML?: string): HTMLElement {
        const el = document.createElement("div");
        el.className = "agent-chat__msg agent-chat__msg--user";
        if (entryId) {
            el.setAttribute("data-message-id", entryId);
        }
        const body = document.createElement("div");
        body.className = "agent-chat__body protyle-wysiwyg";
        body.setAttribute("contenteditable", "false");
        body.setAttribute("data-readonly", "true");
        body.innerHTML = blockHTML || this.lute.Md2BlockDOM(text);
        el.appendChild(body);
        let actionsHTML = '<div class="agent-chat__msg-actions">';
        if (timestamp) {
            actionsHTML += '<span class="agent-chat__msg-meta agent-chat__msg-time">' + this.formatMessageTime(timestamp) + "</span>";
        }
        actionsHTML += '<span class="block__icon block__icon--show ariaLabel agent-chat__user-copy" data-position="north" aria-label="' + window.siyuan.languages.copy + '"><svg><use xlink:href="#iconCopy"></use></svg></span>' +
            '<span class="block__icon block__icon--show ariaLabel agent-chat__user-edit" data-position="north" aria-label="' + window.siyuan.languages.edit + '"><svg><use xlink:href="#iconEdit"></use></svg></span>' +
            "</div>";
        el.insertAdjacentHTML("beforeend", actionsHTML);
        el.querySelector(".agent-chat__user-copy")?.addEventListener("click", (e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(text).then(() => {
                showMessage(window.siyuan.languages.copied, 2000);
            }).catch(() => {
                showMessage(window.siyuan.languages.copied, 2000);
            });
        });
        const edit = (force = false) => {
            const selection = window.getSelection();
            const selectingMessageText = selection && !selection.isCollapsed && el.contains(selection.anchorNode);
            if (!entryId || this.isStreaming || this.mirrorLocked || (!force && selectingMessageText)) {
                return;
            }
            this.beginEditUserMessage(entryId, el);
        };
        el.querySelector(".agent-chat__user-edit")?.addEventListener("click", (e) => {
            e.stopPropagation();
            edit(true);
        });
        body.addEventListener("click", (event) => {
            const target = event.target as HTMLElement;
            if (!target.closest('[data-type~="a"], [data-type~="block-ref"], ' +
                '[data-type~="file-annotation-ref"], [data-type~="tag"], [data-subtype], a[href], img')) {
                edit();
            }
        });
        return el;
    }

    private renderUserMessage(el: HTMLElement) {
        const body = el.querySelector(".agent-chat__body") as HTMLElement;
        postRender(el, this.app);
        this.composer?.renderBlockHTML(body, () => {
            disabledWYSIWYG(body);
        });
        disabledWYSIWYG(body);
    }

    private appendUserMessage(text: string, timestamp?: number, entryId?: string, blockHTML?: string) {
        const el = this.createUserMessage(text, timestamp, entryId, blockHTML);
        this.messagesContainer.appendChild(el);
        this.renderUserMessage(el);
        this.scrollToBottom(true);
    }

    private beginEditUserMessage(entryID: string, el: HTMLElement, initialContent?: string) {
        if (this.editingUserEntryID || this.isStreaming || this.mirrorLocked) {
            return;
        }
        const entry = this.entries.find((item): item is UserEntry => item.type === "user" && item.id === entryID);
        if (!entry) {
            return;
        }
        this.editingUserEntryID = entryID;
        el.classList.add("agent-chat__msg--editing");
        const body = el.querySelector(".agent-chat__body") as HTMLElement;
        const actions = el.querySelector(".agent-chat__msg-actions") as HTMLElement;
        const textarea = document.createElement("textarea");
        textarea.className = "b3-text-field agent-chat__edit-textarea";
        textarea.value = initialContent ?? entry.content;
        body.innerHTML = "";
        body.appendChild(textarea);
        actions.innerHTML = "";

        const cancel = document.createElement("button");
        cancel.className = "b3-button b3-button--cancel";
        cancel.textContent = window.siyuan.languages.cancel;
        const submit = document.createElement("button");
        submit.className = "b3-button b3-button--text";
        submit.textContent = window.siyuan.languages.confirm;
        actions.append(cancel, submit);

        const restore = () => {
            this.editingUserEntryID = "";
            if (this.pendingEditDraft?.entryID === entryID) {
                this.pendingEditDraft = null;
            }
            const replacement = this.createUserMessage(entry.content, entry.timestamp, entry.id, entry.blockHTML);
            el.replaceWith(replacement);
            this.renderUserMessage(replacement);
        };
        cancel.addEventListener("click", restore);
        submit.addEventListener("click", async () => {
            const content = textarea.value.trim();
            if (!content) {
                textarea.focus();
                return;
            }
            await this.regenerateResponse(entryID, content);
        });
        textarea.addEventListener("keydown", (event) => {
            if (event.isComposing) {
                return;
            }
            if (event.key === "Escape") {
                event.preventDefault();
                restore();
            } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                submit.click();
            }
        });
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }

    private createAIMessagePlaceholder(): HTMLElement {
        this.currentContent = "";
        this.currentAssistantEntryId = SessionStore.newSessionId();
        const el = document.createElement("div");
        el.className = "agent-chat__msg agent-chat__msg--ai";
        el.setAttribute("data-message-id", this.currentAssistantEntryId);
        el.innerHTML = '<div class="agent-chat__body b3-typography agent-chat__body--streaming"></div>';
        this.messagesContainer.appendChild(el);
        this.scrollToBottom();
        this.observeStickTarget(el);
        return el;
    }

    private pendingTokenUpdate = false;
    private pendingReasoningUpdate = false;
    private rafId = 0;

    private appendToken(token: string) {
        this.currentContent += token;
        this.fullContent += token;

        const thinkBody = this.messagesContainer.querySelector(".agent-chat__msg--thinking:not(.agent-chat__msg--thinking-done) .agent-chat__thinking-body");
        if (thinkBody) {
            let chatEl = thinkBody.querySelector(".agent-chat__thinking-chat--streaming") as HTMLElement;
            if (!chatEl) {
                chatEl = document.createElement("div");
                chatEl.className = "agent-chat__thinking-chat b3-typography agent-chat__thinking-chat--streaming";
                thinkBody.appendChild(chatEl);
            }
            if (!this.pendingTokenUpdate) {
                this.pendingTokenUpdate = true;
                // 用 RAF 合并更新（与普通 AI 消息一致），减少重建频率。
                // 流式期间用 textContent 写纯文本，富渲染推迟到完成时，避免每帧重解析整段 markdown。
                this.rafId = requestAnimationFrame(() => {
                    this.pendingTokenUpdate = false;
                    chatEl.textContent = this.currentContent;
                    const body = chatEl.closest(".agent-chat__thinking-body") as HTMLElement | null;
                    if (body) {
                        body.scrollTop = body.scrollHeight;
                    }
                    this.scrollToBottom();
                });
            }
            return;
        }

        if (!this.currentAIElement) {
            this.currentAIElement = this.createAIMessagePlaceholder();
        }

        if (!this.pendingTokenUpdate) {
            this.pendingTokenUpdate = true;
            // 流式期间只用 textContent 写入纯文本，跳过 Lute 解析与 postRender 富渲染。
            // 富渲染（高亮/公式/图表）推迟到 finishResponse 一次性完成，避免每帧 O(n²) 重建。
            this.rafId = requestAnimationFrame(() => {
                this.pendingTokenUpdate = false;
                const bodyEl = this.currentAIElement?.querySelector(".agent-chat__body") as HTMLElement;
                if (bodyEl) {
                    bodyEl.textContent = this.currentContent;
                    this.scrollToBottom();
                }
            });
        }
    }

    private flushTokenUpdate() {
        if (this.pendingTokenUpdate) {
            this.pendingTokenUpdate = false;
            cancelAnimationFrame(this.rafId);
            // 思考卡片流式：更新 chatEl 并滚到底部（与 appendToken 思考分支一致）。
            // 与 appendToken 一致用 textContent，富渲染由 finishResponse 完成时统一处理。
            const thinkChat = this.messagesContainer.querySelector(".agent-chat__msg--thinking:not(.agent-chat__msg--thinking-done) .agent-chat__thinking-chat--streaming") as HTMLElement;
            if (thinkChat) {
                thinkChat.textContent = this.currentContent;
                const thinkBody = thinkChat.parentElement;
                if (thinkBody) {
                    thinkBody.scrollTop = thinkBody.scrollHeight;
                }
                return;
            }
            const bodyEl = this.currentAIElement?.querySelector(".agent-chat__body") as HTMLElement;
            if (bodyEl) {
                bodyEl.textContent = this.currentContent;
            }
        }
    }

    private appendToolCall(name: string) {
        const body = this.messagesContainer.querySelector(
            ".agent-chat__msg--thinking:not(.agent-chat__msg--thinking-done) .agent-chat__thinking-body"
        ) as HTMLElement;
        if (!body) {
            return;
        }
        this.toolCallStartedAt.set(name, Date.now());
        if (this.renderedToolNames[name]) {
            this.setToolCallRunning(name, true);
            return;
        }

        this.renderedToolNames[name] = true;
        const lastElement = body.lastElementChild as HTMLElement;
        if (lastElement?.classList.contains("agent-chat__thinking-tools-line")) {
            const toolElement = document.createElement("span");
            toolElement.className = "agent-chat__thinking-tool agent-chat__thinking-tool--running";
            toolElement.textContent = name;
            lastElement.appendChild(toolElement);
        } else {
            body.insertAdjacentHTML("beforeend", renderToolsLineHTML([{name, running: true}]));
        }
        body.scrollTop = body.scrollHeight;
        this.scrollToBottom();
    }

    private setToolCallRunning(name: string, running: boolean) {
        const selector = running
            ? ".agent-chat__msg--thinking:not(.agent-chat__msg--thinking-done) .agent-chat__thinking-tool"
            : ".agent-chat__thinking-tool--running";
        const toolElements = this.messagesContainer.querySelectorAll(selector);
        for (let i = toolElements.length - 1; i >= 0; i--) {
            const toolElement = toolElements[i];
            if (toolElement.textContent === name) {
                toolElement.classList.toggle("agent-chat__thinking-tool--running", running);
                if (running) {
                    return;
                }
            }
        }
    }

    private finishToolCall(name: string) {
        const stillRunning = this.currentToolCalls.some((item) => item.name === name && item.result === undefined);
        if (stillRunning) {
            return;
        }
        const startedAt = this.toolCallStartedAt.get(name);
        const remaining = startedAt ? Math.max(600 - (Date.now() - startedAt), 0) : 0;
        window.setTimeout(() => {
            if (this.toolCallStartedAt.get(name) !== startedAt ||
                this.currentToolCalls.some((item) => item.name === name && item.result === undefined)) {
                return;
            }
            this.setToolCallRunning(name, false);
            this.toolCallStartedAt.delete(name);
        }, remaining);
    }

    private appendToolResult(name: string, result: string) {
        if (name !== "todo_write") {
            return;
        }

        const el = document.createElement("div");
        el.className = "agent-chat__msg agent-chat__msg--tool";
        el.setAttribute("data-message-id", SessionStore.newSessionId());
        el.innerHTML = renderTodoList(result);
        this.insertBeforeAI(el);
        this.scrollToBottom(true);
        this.hasInterveningCard = true;
    }

    private appendThinking(reasoning: string) {
        const L = window.siyuan.languages;
        if (this.currentThinkingText) {
            // step 不保存 text（渲染时由 duration 经 i18n 生成）。
            // toolNames 只取本轮新增的工具（lastStepToolCount 之后的），
            // 避免累积重复历史工具——完整的 arguments/result 在 assistant entry 存一份。
            const toolNames = this.currentToolCalls.slice(this.lastStepToolCount).map(function (t) {
                return t.name;
            });
            this.currentThinkingSteps.push({
                reasoning: this.currentThinkingReasoning,
                reasoningContent: this.currentThinkingReasoningContent,
                toolNames: toolNames.length > 0 ? toolNames : undefined,
            });
            this.lastStepToolCount = this.currentToolCalls.length;
        }
        this.currentThinkingText = "";
        this.currentThinkingReasoning = reasoning;
        this.currentThinkingReasoningContent = "";
        const text = L.agentThinking || "Thinking";

        this.currentThinkingText = text;

        let detailLines = "";
        if (reasoning === "processing" && this.currentToolCalls.length > 0) {
            const newTools: Array<{ name: string; running: boolean }> = [];
            for (let i = 0; i < this.currentToolCalls.length; i++) {
                const tc = this.currentToolCalls[i];
                if (!this.renderedToolNames[tc.name]) {
                    this.renderedToolNames[tc.name] = true;
                    const running = tc.result === undefined;
                    if (running) {
                        this.toolCallStartedAt.set(tc.name, Date.now());
                    }
                    newTools.push({name: tc.name, running});
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
            // 与 finishActiveThinking 对齐：先把本张思考卡片的耗时算出来，
            // 既用于 DOM 显示「已思考 Xs」，也用于落盘 entry.duration（重载后仍能显示正确耗时）。
            const durSec = this.currentThinkingDuration ||
                (this.requestStartTime ? (Date.now() - this.requestStartTime) / 1000 : 0);
            this.currentThinkingDuration = durSec;
            const doneText = durSec > 0
                ? (L.agentThinkingDoneTime ? L.agentThinkingDoneTime.replace("%s", Math.round(durSec) + "s") : (L.agentThinking || "Thinking"))
                : (L.agentThinking || "Thinking");
            const oldCards = this.messagesContainer.querySelectorAll(".agent-chat__msg--thinking:not(.agent-chat__msg--thinking-done)");
            for (let i = 0; i < oldCards.length; i++) {
                const card = oldCards[i] as HTMLElement;
                card.classList.add("agent-chat__msg--thinking-done");
                const txtEl = card.querySelector(".agent-chat__thinking-text");
                if (txtEl) {
                    txtEl.textContent = doneText;
                }
            }
            if (this.currentThinkingStepContent && this.currentThinkingSteps.length > 0) {
                this.currentThinkingSteps[this.currentThinkingSteps.length - 1].content = this.currentThinkingStepContent;
                this.currentThinkingStepContent = "";
            }
            if (this.currentThinkingSteps.length > 0) {
                this.entries.push({
                    id: this.currentThinkingEntryId || undefined,
                    type: "thinking",
                    steps: this.currentThinkingSteps.slice(),
                    duration: this.currentThinkingDuration || undefined
                });
                this.currentThinkingSteps = [];
                this.currentThinkingEntryId = "";
            }
            // 卡片边界：一张思考卡片已落盘，重置工具名去重表，使下一张卡片独立显示本轮工具
            // （与重载路径 renderMergedThinkingCard 的单卡片局部去重 seenTools 对齐）。
            this.renderedToolNames = {};
            // Flush tool calls as assistant entry
            if (this.currentToolCalls.length > 0) {
                this.entries.push({
                    id: SessionStore.newSessionId(),
                    type: "assistant",
                    toolCalls: this.slimToolCallsForPersistence(this.currentToolCalls)
                });
                this.currentToolCalls = [];
                this.lastStepToolCount = 0;
            }
            // Flush pending confirms
            if (this.pendingConfirms.length > 0) {
                for (const c of this.pendingConfirms) {
                    this.entries.push(c);
                }
                this.pendingConfirms = [];
            }
            // 确认、提问等交互卡片会中断思考，新卡片应从交互完成后重新计时。
            this.currentThinkingDuration = 0;
            this.requestStartTime = Date.now();
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
            this.startThinkingTimer();
            return;
        }
        if (existingCard) {
            existingCard.remove();
        }

        const bodyHTML = '<div class="agent-chat__thinking-body agent-chat__thinking-body--preview">' +
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
            '<svg class="agent-chat__thinking-arrow--expand"><use xlink:href="#iconExpand"></use></svg>' +
            '<svg class="agent-chat__thinking-arrow--contract fn__none"><use xlink:href="#iconContract"></use></svg>' +
            "</span>" +
            '<span class="agent-chat__thinking-text">' + escapeHtml(text) + "</span>" +
            "</div>" +
            bodyHTML +
            "</div>";

        bindThinkingCardToggle(el);
        this.insertBeforeAI(el);
        this.scrollToBottom();
        this.observeStickTarget(el);
        this.startThinkingTimer();
    }

    private appendReasoning(token: string) {
        const isNewRound = this.currentThinkingReasoningContent.length === 0;
        this.currentThinkingReasoningContent += token;
        const thinkingElems = this.messagesContainer.querySelectorAll(".agent-chat__msg--thinking:not(.agent-chat__msg--thinking-done) .agent-chat__thinking-body");
        if (thinkingElems.length === 0) {
            return;
        }
        const thinking = thinkingElems[thinkingElems.length - 1];
        // 新轮次立即创建 reasoning 元素（保证多轮顺序），文本内容用 RAF 合并追加（减少 reflow）。
        if (isNewRound) {
            const reasoningEl = document.createElement("div");
            reasoningEl.className = "agent-chat__thinking-reasoning-text";
            thinking.appendChild(reasoningEl);
        }
        if (!this.pendingReasoningUpdate) {
            this.pendingReasoningUpdate = true;
            requestAnimationFrame(() => {
                this.pendingReasoningUpdate = false;
                const allReasoning = thinking.querySelectorAll(".agent-chat__thinking-reasoning-text");
                const reasoningEl = allReasoning[allReasoning.length - 1] as HTMLElement;
                if (reasoningEl) {
                    reasoningEl.textContent = this.currentThinkingReasoningContent;
                    // 预览态固定高度，滚到底部让最新 reasoning 内容可见。
                    const body = reasoningEl.closest(".agent-chat__thinking-body") as HTMLElement | null;
                    if (body) {
                        body.scrollTop = body.scrollHeight;
                    }
                }
            });
        }
    }

    private addCopyButton(el: HTMLElement, contentOverride?: string, timestamp?: number) {
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
            this.regenerateResponse(this.findUserEntryIDBeforeElement(el));
        });
        actions.appendChild(regenBtn);

        el.appendChild(actions);
    }

    private findUserEntryIDBeforeElement(el: HTMLElement): string | undefined {
        let current: Element | null = el;
        while (current) {
            if (current.classList.contains("agent-chat__msg--user")) {
                return (current as HTMLElement).dataset.messageId;
            }
            current = current.previousElementSibling;
        }
        return undefined;
    }

    private async confirmHistoryTruncation(entryIndex: number): Promise<boolean> {
        if (!hasAgentExecutedToolsAfter(this.entries, entryIndex)) {
            return true;
        }
        return new Promise((resolve) => {
            confirmDialog(window.siyuan.languages.confirm,
                window.siyuan.languages.agentEditHistoryWarning,
                () => resolve(true), () => resolve(false));
        });
    }

    private async regenerateResponse(userEntryID?: string, editedContent?: string) {
        if (this.isStreaming || this.mirrorLocked || this.modelOptions.length === 0) {
            return;
        }
        if (!await this.prepareForNewTurn()) {
            return;
        }
        const requestSessionID = this.sessionId;
        const requestRevision = SessionStore.getRevision(requestSessionID);
        let targetIndex = findAgentUserEntryIndex(this.entries, userEntryID);
        if (targetIndex < 0) {
            return;
        }
        if (editedContent !== undefined && userEntryID) {
            this.pendingEditDraft = {entryID: userEntryID, content: editedContent};
        }
        if (!await this.confirmHistoryTruncation(targetIndex)) {
            this.restorePendingEditDraft();
            return;
        }
        if (!isAgentRegenerateStateCurrent(requestSessionID, this.sessionId, requestRevision,
            SessionStore.getRevision(requestSessionID), this.isStreaming, this.mirrorLocked)) {
            if (this.sessionId === requestSessionID) {
                this.restorePendingEditDraft();
            } else {
                this.pendingEditDraft = null;
            }
            return;
        }
        targetIndex = findAgentUserEntryIndex(this.entries, userEntryID);
        if (targetIndex < 0) {
            this.restorePendingEditDraft();
            return;
        }
        const targetEntry = this.entries[targetIndex];
        if (targetEntry.type !== "user") {
            return;
        }
        this.editingUserEntryID = "";
        this.pendingEditDraft = editedContent === undefined ? null : {
            entryID: targetEntry.id || "",
            content: editedContent,
        };
        if (editedContent !== undefined) {
            const contentChanged = editedContent !== targetEntry.content;
            targetEntry.content = editedContent;
            if (contentChanged) {
                targetEntry.blockHTML = undefined;
            }
            const references = filterAgentReferencesForContent(targetEntry.references || [], editedContent);
            targetEntry.references = references.length > 0 ? references : undefined;
        }
        this.entries.splice(targetIndex + 1);

        const targetEl = this.messagesContainer.querySelector(
            '.agent-chat__msg--user[data-message-id="' + targetEntry.id + '"]') as HTMLElement | null;
        if (targetEl) {
            let sibling = targetEl.nextElementSibling;
            while (sibling) {
                const next = sibling.nextElementSibling;
                sibling.remove();
                sibling = next;
            }
            if (editedContent !== undefined) {
                const replacement = this.createUserMessage(targetEntry.content, targetEntry.timestamp, targetEntry.id,
                    targetEntry.blockHTML);
                targetEl.replaceWith(replacement);
                this.renderUserMessage(replacement);
            }
        }
        this.currentAIElement = null;
        this.observeStickTarget(null);
        this.currentContent = "";
        this.fullContent = "";
        this.currentToolCalls = [];
        this.lastStepToolCount = 0;
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
        this.removeMirrorPlaceholder();
        this.requestStartTime = Date.now();
        this.currentThinkingDuration = 0;
        this.currentTurnID = "";
        const lastUserEntry = targetEntry;
        const lastUserText = lastUserEntry.content;
        const editorContext = this.captureEditorContext();
        lastUserEntry.editorContext = editorContext;
        const pluginActions = this.getPluginActions();
        this.abortController = new AbortController();
        const requestSessionId = this.sessionId;
        await fetchAgentSSE(
            lastUserText,
            window.siyuan.config.appearance.lang,
            lastUserEntry.references || [],
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
                // 409：该会话正在其他实例对话中（实例级互斥），不进入流式。
                if (err instanceof AgentHttpError && err.status === 409) {
                    return this.handleConflictReject();
                }
                return this.handleConfigError(err, undefined, true);
            },
            this.abortController.signal,
            this.sessionId,
            this.getSelectedModel(),
            this.selectedReasoningEffort,
            true,
            editorContext,
            pluginActions,
            lastUserEntry.id,
            SessionStore.getRevision(this.sessionId),
        );
    }

    // 流式结束时把 currentAIElement 的 body 从纯文本一次性转为富渲染（Lute + postRender）。
    // 由 finishResponse（正常结束）与 error 路径（中断）共用，保证流式期轻渲染后仍得到完整富文本。
    private finalizeStreamingBody(content: string, ts: number) {
        if (!this.currentAIElement) {
            return;
        }
        const bodyEl = this.currentAIElement.querySelector(".agent-chat__body") as HTMLElement;
        if (!bodyEl) {
            return;
        }
        bodyEl.classList.remove("agent-chat__body--streaming");
        if (content) {
            // 富渲染只在此处执行一次，避免流式期间每帧 O(n²) 重建带来的卡顿。
            bodyEl.innerHTML = this.lute.ProtylePreviewStr("", content) || escapeHtml(content);
            postRender(bodyEl, this.app);
            this.addCopyButton(this.currentAIElement, undefined, ts);
            this.scrollToBottom(true);
        }
    }

    private async finishResponse(notify = true) {
        // 思考结束前先记录最后一张未完成的思考卡片，折叠后用于定位滚动锚点。
        const activeThinkCard = this.messagesContainer.querySelector(
            ".agent-chat__msg--thinking:not(.agent-chat__msg--thinking-done)"
        ) as HTMLElement | null;
        this.finishActiveThinking();
        const savedContent = this.currentContent;
        const savedFullContent = this.fullContent;
        const ts = Date.now();
        // 流式结束：把 body 从流式期的纯文本转为一次性完整富渲染（Lute + postRender）。
        // 场景一：内容在流式期间落到了思考卡片里（currentAIElement 仍为空），需新建普通 AI 消息承载。
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
            el.innerHTML = '<div class="agent-chat__body b3-typography">' + (this.lute.ProtylePreviewStr("", savedContent) || escapeHtml(savedContent)) + "</div>";
            this.messagesContainer.appendChild(el);
            postRender(el, this.app);
            this.currentAIElement = el;
            this.currentContent = savedContent;
            this.fullContent = savedFullContent;
            this.addCopyButton(el, undefined, ts);
            // 思考结束场景：定位到思考卡片下方（卡片贴顶、正文向下展开），而非直接滚到对话最底部。
            if (activeThinkCard) {
                this.scrollToThinkingCardBelow(activeThinkCard);
            } else {
                this.scrollToBottom(true);
            }
        } else if (this.currentAIElement) {
            // 场景二：普通流式元素（createAIMessagePlaceholder 创建，body 仍是纯文本），一次性富渲染。
            this.finalizeStreamingBody(savedContent, ts);
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
                toolCalls: this.currentToolCalls.length > 0 ? this.slimToolCallsForPersistence(this.currentToolCalls) : undefined,
                timestamp: ts,
            });
        } else if (this.currentToolCalls.length > 0) {
            this.entries.push({
                id: SessionStore.newSessionId(),
                type: "assistant",
                toolCalls: this.slimToolCallsForPersistence(this.currentToolCalls)
            });
        }
        this.currentAIElement = null;
        this.observeStickTarget(null);
        this.currentAssistantEntryId = "";
        this.currentContent = "";
        this.fullContent = "";
        this.currentToolCalls = [];
        this.lastStepToolCount = 0;
        this.renderedToolNames = {};
        if (this.requestStartTime) {
            this.requestStartTime = 0;
        }
        this.updateTokenDisplay();
        const sessionID = this.sessionId;
        const canonicalSession = await this.saveSession(this.currentTurnID);
        this.pendingEditDraft = null;
        if (this.sessionId === sessionID) {
            // 提交时后端会用 runtime 重建本轮 assistant/tool 结果。直接采用提交响应中的权威会话，
            // 避免下一轮普通保存又用前端流式快照覆盖，也避免额外 GET 的失败/乱序窗口。
            if (canonicalSession) {
                const atBottom = this.isScrolledToBottom();
                const savedScroll = this.messagesContainer.scrollTop;
                this.entries = this.buildEntriesFromSession(canonicalSession);
                this.updateMetaFromSession(canonicalSession);
                this.messagesContainer.innerHTML = "";
                this.renderLoadedSession(canonicalSession);
                if (atBottom) {
                    this.scrollToBottom(true);
                } else {
                    this.messagesContainer.scrollTop = savedScroll;
                }
            } else {
                await this.reloadFromDisk(true);
            }
        }
        this.setStreaming(false);
        if (this.pendingSessionTitle !== null && this.sessionId === sessionID) {
            await this.saveSession();
        }
        this.rebuildNavMarkers();
        if (notify && savedContent && (!document.hasFocus() || document.hidden)) {
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
            const toolNames = this.currentToolCalls.slice(this.lastStepToolCount).map(function (t) {
                return t.name;
            });
            this.currentThinkingSteps.push({
                reasoning: this.currentThinkingReasoning,
                reasoningContent: this.currentThinkingReasoningContent,
                toolNames: toolNames.length > 0 ? toolNames : undefined,
                content: this.currentThinkingStepContent || undefined,
            });
            this.lastStepToolCount = this.currentToolCalls.length;
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
        if (this.hasTitled) {
            return;
        }
        this.hasTitled = true;
        const requestSessionID = this.sessionId;
        const userEntry = this.entries.find((e): e is { type: "user"; content: string } => e.type === "user");
        const userMsg = userEntry?.content?.slice(0, 500) || "";
        fetch("/api/ai/agent/title", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({
                message: userMsg,
                model: this.getSelectedModel(),
                language: window.siyuan.config.appearance.lang
            }),
        }).then((resp) => resp.json()).then((data) => {
            if (this.sessionId === requestSessionID && data.code === 0 && data.data && data.data !== this.sessionTitle) {
                this.sessionTitle = data.data;
                this.pendingSessionTitle = data.data;
                this.titleElement.textContent = data.data;
                // 流式结束时的统一提交会包含最新标题；流式中单独保存会改变内容修订号，
                // 使尚未创建的 runtime turn 被误判为旧请求。
                if (!this.isStreaming && !this.currentTurnID) {
                    void this.saveSession();
                }
            }
        }).catch((e) => {
            console.error("agent title request error:", e);
        });
    }

    private appendError(message: string) {
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
    }

    private appendRetry(attempt: number, maxRetries: number) {
        this.finishActiveThinking();
        this.currentThinkingSteps = [];
        this.currentThinkingStepContent = "";
        this.renderedToolNames = {};
        this.clearThinking();
        const el = document.createElement("div");
        el.className = "agent-chat__msg agent-chat__msg--retry";
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
            '<button class="b3-button b3-button--text agent-chat__snapshot-rollback ariaLabel" aria-label="' + (L.rollback || "Rollback") + '"><svg><use xlink:href="#iconUndo"></use></svg></button>' +
            "</div>";
        const rollbackBtn = el.querySelector(".agent-chat__snapshot-rollback") as HTMLButtonElement;
        rollbackBtn.addEventListener("click", () => {
            const confirmText = (L.rollbackConfirm || "Rollback cannot be undone").replace("${name}", L.dataSnapshot || "Snapshot").replace("${time}", shortID);
            confirmDialog("⚠️ " + (L.rollback || "Rollback"), confirmText, () => {
                fetchPost("/api/repo/checkoutRepo", {id: snapshotID, sessionID: this.sessionId}, () => {
                    // 记录回滚操作，使重载会话后仍可见「已回滚」提示（激活 appendRollbackInfo 渲染分支）。
                    const rollbackEntryId = SessionStore.newSessionId();
                    this.entries.push({id: rollbackEntryId, type: "rollback", snapshotID: snapshotID});
                    this.appendRollbackInfo(snapshotID, rollbackEntryId);
                    void this.saveSession();
                });
            });
        });
        // 快照应在执行区域之前：有确认卡片时插到确认卡片前，否则查找活跃的思考卡片
        const confirmCards = this.messagesContainer.querySelectorAll(".agent-chat__msg--confirm");
        if (confirmCards.length > 0) {
            this.messagesContainer.insertBefore(el, confirmCards[confirmCards.length - 1]);
        } else {
            const activeThinking = this.messagesContainer.querySelector(
                ".agent-chat__msg--thinking:not(.agent-chat__msg--thinking-done)"
            );
            if (activeThinking) {
                this.messagesContainer.insertBefore(el, activeThinking);
            } else {
                this.insertBeforeAI(el);
            }
        }
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
            el.innerHTML = '<div class="agent-chat__body b3-typography">' + (this.lute.ProtylePreviewStr("", savedContent) || escapeHtml(savedContent)) + "</div>";
            this.messagesContainer.appendChild(el);
            postRender(el, this.app);
            this.currentAIElement = el;
            this.currentContent = savedContent;
            this.fullContent = savedFullContent;
            this.addCopyButton(el, undefined, ts);
            this.scrollToBottom(true);
        }
        this.flushThinkingStep();
        if (this.currentContent) {
            this.entries.push({
                id: this.currentAssistantEntryId || undefined,
                type: "assistant",
                content: this.currentContent,
                toolCalls: this.currentToolCalls.length > 0 ? this.slimToolCallsForPersistence(this.currentToolCalls) : undefined,
                timestamp: ts,
            });
        }
        this.currentAIElement = null;
        this.observeStickTarget(null);
        this.currentAssistantEntryId = "";
        this.currentContent = "";
        this.fullContent = "";
        this.currentToolCalls = [];
        this.lastStepToolCount = 0;
        this.renderedToolNames = {};
        if (this.requestStartTime) {
            this.requestStartTime = 0;
        }
        this.updateTokenDisplay();
        this.setStreaming(false);
        const sessionID = this.sessionId;
        const turnID = this.currentTurnID;
        // abort 只中断前端连接；外部工具可能仍在返回途中。不能在这里直接保存并清除 runtime，
        // 等后端写完 interrupted 检查点后再恢复并提交。turn 事件可能尚未到达，因此空 ID 也要轮询。
        try {
            await this.reloadFromDisk(true);
        } catch (e) {
            console.error("reload agent session after stop failed:", e);
        }
        if (this.sessionId === sessionID) {
            void this.recoverInterruptedTurn(sessionID, turnID);
        }
        this.rebuildNavMarkers();
    }

    private insertBeforeAI(el: HTMLElement) {
        if (this.currentAIElement) {
            this.messagesContainer.insertBefore(el, this.currentAIElement);
        } else {
            this.messagesContainer.appendChild(el);
        }
    }

    private renderConfirmEffects(effects?: IToolEffects) {
        if (!effects) {
            return "";
        }
        const L = window.siyuan.languages;
        const items: string[] = [];
        if (effects.dataEgress) {
            items.push(L.agentEffectDataEgress);
        }
        if (effects.externalCost) {
            items.push(L.agentEffectExternalCost);
        }
        if (effects.localWrite) {
            items.push(L.agentEffectLocalWrite);
        }
        if (items.length === 0) {
            return "";
        }
        return '<ul class="agent-chat__confirm-effects">' + items.map((item) => `<li>${escapeHtml(item)}</li>`).join("") + "</ul>";
    }

    private async appendConfirm(name: string, args: Record<string, unknown>, confirmID: string, effects?: IToolEffects) {
        this.finishActiveThinking();
        this.flushThinkingStep();
        const L = window.siyuan.languages;
        const el = document.createElement("div");
        el.className = "agent-chat__msg agent-chat__msg--confirm";
        const argsStr = JSON.stringify(args, null, 2);
        const desc = (L.agentConfirmDesc || "Agent: {category} operation").replace("{category}", escapeHtml(this.toolCategory(name)));
        el.innerHTML = '<div class="agent-chat__confirm-card">' +
            '<div class="agent-chat__confirm-header"><svg class="agent-chat__confirm-icon"><use xlink:href="#iconInfo"></use></svg> ' + desc + "</div>" +
            this.renderConfirmEffects(effects) +
            '<pre class="agent-chat__confirm-args">' + escapeHtml(argsStr) + "</pre>" +
            '<div class="agent-chat__confirm-actions">' +
            '<button class="b3-button b3-button--cancel agent-chat__confirm-reject">' + (L.agentConfirmReject || "Reject") + "</button>" +
            '<button class="b3-button b3-button--text agent-chat__confirm-approve">' + (L.agentConfirmApprove || "Approve") + "</button>" +
            '<button class="b3-button b3-button--text agent-chat__confirm-always ariaLabel" data-position="n" aria-label="' + (L.agentConfirmAlwaysDesc || "Session Allow") + '">' + (L.agentConfirmAlways || "Session Allow") + "</button>" +
            "</div>" +
            "</div>";
        const sessionID = this.sessionId;
        const confirmEntryId = SessionStore.newSessionId();
        const confirmEntry: SessionEntry = {
            id: confirmEntryId,
            type: "confirm",
            name,
            args,
            confirmID,
            effects,
            status: "pending",
        };
        el.setAttribute("data-message-id", confirmEntryId);
        this.pendingConfirms.push(confirmEntry);
        const submitConfirm = async (approved: boolean, always: boolean, doneText: string) => {
            const buttons = Array.from(el.querySelectorAll("button")) as HTMLButtonElement[];
            buttons.forEach((button) => button.disabled = true);
            const accepted = await this.postConfirm(confirmID, approved, always, sessionID, confirmEntryId);
            if (!accepted) {
                buttons.forEach((button) => button.disabled = false);
                showMessage(window.siyuan.languages._kernel[28], 3000);
                return;
            }
            el.classList.add("agent-chat__msg--confirmed");
            const actions = el.querySelector(".agent-chat__confirm-actions") as HTMLElement;
            if (actions) {
                actions.innerHTML = '<span class="agent-chat__confirm-done">' + doneText + "</span>";
            }
        };
        const approveBtn = el.querySelector(".agent-chat__confirm-approve");
        if (approveBtn) {
            approveBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                void submitConfirm(true, false, L.agentConfirmApprove || "Approved");
            });
        }
        const rejectBtn = el.querySelector(".agent-chat__confirm-reject");
        if (rejectBtn) {
            rejectBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                void submitConfirm(false, false, L.agentConfirmReject || "Rejected");
            });
        }
        const alwaysBtn = el.querySelector(".agent-chat__confirm-always");
        if (alwaysBtn) {
            alwaysBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                void submitConfirm(true, true, L.agentConfirmAlways || "Session Allow");
            });
        }
        this.insertBeforeAI(el);
        this.scrollToBottom(true);
        this.hasInterveningCard = true;
        if (!document.hasFocus() || document.hidden) {
            sendNotification({title: L.agentNotifyConfirm, body: "", timeoutType: "default"});
        }
    }

    private async postConfirm(confirmID: string, approved: boolean, always: boolean,
                              sessionID: string, confirmEntryID: string): Promise<boolean> {
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
            const result = await resp.json() as {code?: number};
            if (!resp.ok || result?.code !== 0) {
                console.error("agent confirm request failed:", resp.status);
                return false;
            }
        } catch (e) {
            console.error("agent confirm request error:", e);
            return false;
        }
        if (this.sessionId !== sessionID) {
            return true;
        }
        const entry = (this.entries.find(e => e.id === confirmEntryID) ||
            this.pendingConfirms.find(e => e.id === confirmEntryID)) as {status?: string} | undefined;
        if (entry) {
            entry.status = always ? "always" : (approved ? "approved" : "rejected");
        }
        try {
            await this.saveSession();
        } catch (e) {
            console.error("save agent confirmation state failed:", e);
        }
        return true;
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
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const resp = await fetch("/api/ai/agent/frontendToolResult", {
                    method: "POST",
                    headers: {"Content-Type": "application/json"},
                    body: JSON.stringify({callID, result, isError}),
                });
                const response = await resp.json() as {code?: number};
                if (resp.ok && response?.code === 0) {
                    return;
                }
                if (resp.status === 409) {
                    console.error("agent frontend result expired:", callID);
                    return;
                }
            } catch (e) {
                if (attempt === 2) {
                    console.error("agent frontend result request error:", e);
                }
            }
            await new Promise((resolve) => window.setTimeout(resolve, 200 * (attempt + 1)));
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
        const sessionID = this.sessionId;
        const questionEntryId = SessionStore.newSessionId();
        el.setAttribute("data-message-id", questionEntryId);
        this.entries.push({
            id: questionEntryId,
            type: "question",
            questionID: questionID,
            questions: rawQuestions,
            status: "pending",
        });

        el.querySelectorAll(".agent-chat__question-option").forEach((option) => {
            const input = option.querySelector("input") as HTMLInputElement;
            if (!input) return;
            let wasChecked = false;
            option.addEventListener("mousedown", () => {
                wasChecked = input.checked;
            });
            option.addEventListener("click", (e) => {
                if (el.classList.contains("agent-chat__msg--confirmed")) {
                    return;
                }
                if (input.type === "radio" && wasChecked) {
                    e.preventDefault();
                    input.checked = false;
                }
            });
        });

        const submitBtn = el.querySelector(".agent-chat__question-submit-btn");
        if (submitBtn) {
            submitBtn.addEventListener("click", async () => {
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
                const inputs = Array.from(el.querySelectorAll("input")) as HTMLInputElement[];
                (submitBtn as HTMLButtonElement).disabled = true;
                inputs.forEach((input) => input.disabled = true);
                const accepted = await this.postQuestionAnswer(questionID, answers, sessionID, questionEntryId);
                if (!accepted) {
                    (submitBtn as HTMLButtonElement).disabled = false;
                    inputs.forEach((input) => input.disabled = false);
                    showMessage(window.siyuan.languages._kernel[28], 3000);
                    return;
                }
                el.classList.add("agent-chat__msg--confirmed");
                const actions = el.querySelector(".agent-chat__question-submit");
                if (actions) {
                    (actions as HTMLElement).innerHTML = '<span class="agent-chat__confirm-done">' + (L.agentQuestionSubmitted || "Submitted") + "</span>";
                }
            });
        }

        this.insertBeforeAI(el);
        this.scrollToBottom(true);
        this.hasInterveningCard = true;
    }

    private async postQuestionAnswer(questionID: string, answers: string[],
                                     sessionID: string, questionEntryID: string): Promise<boolean> {
        try {
            const resp = await fetch("/api/ai/agent/question", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({questionID: questionID, answers: answers}),
            });
            const result = await resp.json() as {code?: number};
            if (!resp.ok || result?.code !== 0) {
                console.error("agent question request failed:", resp.status);
                return false;
            }
        } catch (e) {
            console.error("agent question request error:", e);
            return false;
        }
        if (this.sessionId !== sessionID) {
            return true;
        }
        const entry = this.entries.find(e => e.id === questionEntryID) as {
            status?: string; answers?: string[]
        } | undefined;
        if (entry) {
            entry.status = "submitted";
            entry.answers = answers;
        }
        try {
            await this.saveSession();
        } catch (e) {
            console.error("save agent question state failed:", e);
        }
        return true;
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
        if (!steps || steps.length === 0) {
            return;
        }
        let detail = "";
        const seenTools: Record<string, boolean> = {};
        for (let i = 0; i < steps.length; i++) {
            const step = steps[i];
            if (step.content) {
                detail += '<div class="agent-chat__thinking-chat b3-typography">' + (this.lute.ProtylePreviewStr("", step.content) || escapeHtml(step.content)) + "</div>";
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
            '<span class="agent-chat__thinking-text">' + escapeHtml(headerText) + "</span>" +
            "</div>" +
            '<div class="agent-chat__thinking-body">' +
            detail +
            "</div>" +
            "</div>";

        bindThinkingCardToggle(el);
        this.messagesContainer.appendChild(el);
        postRender(el, this.app);
    }

    // 由 duration 经 i18n 生成"已思考：Xs"标题文本；无 duration 时回退到"思考中..."。
    private formatThinkingHeader(duration?: number): string {
        const L = window.siyuan.languages;
        if (duration && duration > 0) {
            return L.agentThinkingDoneTime ? L.agentThinkingDoneTime.replace("%s", Math.round(duration) + "s") : (L.agentThinking || "Thinking");
        }
        return L.agentThinking || "Thinking";
    }

    // 刷新底部 token 圆环显示。contextTokens 为 0 时隐藏（含切换到无统计的旧会话场景）。
    private updateTokenDisplay() {
        if (!this.tokenDisplayEl) {
            return;
        }
        if (this.contextTokens === 0) {
            this.tokenDisplayEl.classList.add("fn__none");
            return;
        }
        this.tokenDisplayEl.classList.remove("fn__none");
        const arc = this.tokenDisplayEl.querySelector(".agent-chat__tokens-arc") as SVGCircleElement | null;
        if (!arc) {
            return;
        }
        const circumference = 2 * Math.PI * 9; // r=9 → ≈56.55
        const tokens = this.contextTokens;
        const limit = this.contextLimit;
        // 弧长：已知上限按真实占用率；未知上限（limit=0）不画弧（只留灰色轨道圈）。
        // 颜色统一主色，不再按占用率分档。
        const ratio = limit > 0 ? Math.min(tokens / limit, 1) : 0;
        const filled = circumference * ratio;
        arc.setAttribute("stroke-dasharray", filled.toFixed(2) + " " + circumference.toFixed(2));
    }

    // 记录最近一轮的 prompt tokens（= 当前上下文已用）+ 分类明细 + 缓存命中 + 模型上限，覆盖式更新而非累加。
    private appendUsage(lastPromptTokens: number, tokenBreakdown: Record<string, number>, cachedTokens: number, contextLimit: number) {
        this.contextTokens = lastPromptTokens;
        this.contextTokenBreakdown = tokenBreakdown;
        this.contextCachedTokens = cachedTokens;
        this.contextLimit = contextLimit;
        this.updateTokenDisplay();
    }

    // 弹出 token 分类明细面板。breakdown 全 0 时不弹（无内容可显示）。
    private showTokenBreakdownPopup() {
        if (!this.formatTokenBreakdown().length && this.contextCachedTokens === 0) {
            return;
        }
        this.closeTokenBreakdownPopup();
        const L = window.siyuan.languages;
        const popup = document.createElement("div");
        popup.className = "agent-token-popup b3-menu";
        let html = '<div class="b3-menu__items">';
        // 第一行：已用 / 上限 · 占用百分比；未知上限时仅显示已用。
        const limitLine = this.contextLimit > 0
            ? this.formatTokenCount(this.contextTokens) + " / " + this.formatTokenCount(this.contextLimit) + " · " + Math.round(this.contextTokens / this.contextLimit * 100) + "%"
            : this.formatTokenCount(this.contextTokens);
        html += '<div class="agent-token-popup__total">' +
            '<span class="agent-token-popup__label">' + (L.tokenUsage || "Context Usage") + "</span>" +
            '<span class="agent-token-popup__value">' + limitLine + "</span>" +
            "</div>";
        // 第一行下方的占用横条：总长=上限，填充=已用占比，颜色统一主色。
        // 未知上限（contextLimit=0）时不画横条（无总长基线）。
        if (this.contextLimit > 0) {
            const ratio = Math.min(this.contextTokens / this.contextLimit, 1);
            html += '<div class="agent-token-popup__bar">' +
                '<span style="width:' + (ratio * 100).toFixed(1) + '%"></span>' +
                "</div>";
        } else {
            html += '<div class="agent-token-popup__divider"></div>';
        }
        // 各分类（0 值跳过），百分比格式。
        for (const row of this.formatTokenBreakdown()) {
            html += '<div class="agent-token-popup__row">' +
                '<span class="agent-token-popup__label">' + escapeHtml(row.label) + "</span>" +
                '<span class="agent-token-popup__value">' + row.percent + "</span>" +
                "</div>";
        }
        // 缓存命中（独立维度，分隔线隔开，为 0 不显示——不返回缓存字段的模型整行不出现）。
        if (this.contextCachedTokens > 0 && this.contextTokens > 0) {
            html += '<div class="agent-token-popup__divider"></div>';
            const cachedPercent = Math.round(this.contextCachedTokens / this.contextTokens * 1000) / 10;
            html += '<div class="agent-token-popup__row">' +
                '<span class="agent-token-popup__label">' + (L.tokenCatCached || "Cache Hits") + "</span>" +
                '<span class="agent-token-popup__value">' + cachedPercent + "%</span>" +
                "</div>";
        }
        html += "</div>";
        popup.innerHTML = html;
        document.body.appendChild(popup);
        popup.style.zIndex = (++window.siyuan.zIndex).toString();
        // 定位：与模型选择弹出一致——右对齐 trigger 右边缘（width 280px 固定），垂直在 trigger 下方。
        const rect = this.tokenDisplayEl.getBoundingClientRect();
        setPosition(popup, rect.right - 280, rect.bottom, rect.height, rect.width);
        // popup 自身 hover 保持显示（鼠标移入时取消关闭计时，移出时关闭）。
        popup.addEventListener("mouseenter", () => {
            window.clearTimeout(this.tokenPopupHideTimer);
        });
        popup.addEventListener("mouseleave", () => {
            this.tokenPopupHideTimer = window.setTimeout(() => {
                this.closeTokenBreakdownPopup();
            }, 300);
        });
        // 点击外部/resize/ESC 关闭。
        popup.addEventListener("click", (e: MouseEvent) => {
            e.stopPropagation();
        });
        // 点击外部/resize 关闭。监听器存为字段，closeTokenBreakdownPopup 统一清理，避免泄漏。
        this.tokenPopupOutsideClickHandler = () => {
            this.closeTokenBreakdownPopup();
        };
        this.tokenPopupResizeHandler = () => {
            this.closeTokenBreakdownPopup();
        };
        setTimeout(() => {
            if (this.tokenPopupOutsideClickHandler) {
                document.addEventListener("click", this.tokenPopupOutsideClickHandler);
            }
        }, 10);
        window.addEventListener("resize", this.tokenPopupResizeHandler);
        this.tokenPopup = popup;
    }

    private closeTokenBreakdownPopup() {
        // 统一清理外部监听器，避免多次开合 popup 累积监听器导致内存泄漏。
        if (this.tokenPopupOutsideClickHandler) {
            document.removeEventListener("click", this.tokenPopupOutsideClickHandler);
            this.tokenPopupOutsideClickHandler = null;
        }
        if (this.tokenPopupResizeHandler) {
            window.removeEventListener("resize", this.tokenPopupResizeHandler);
            this.tokenPopupResizeHandler = null;
        }
        if (this.tokenPopup) {
            this.tokenPopup.remove();
            this.tokenPopup = null;
        }
    }

    // 把 contextTokenBreakdown（后端估算的 9 类 + other）格式化为 [{label, percent}]，跳过 0 值。
    // percent = 各类 token / contextTokens * 100（contextTokens 为 0 时显示 "-")。
    private formatTokenBreakdown(): Array<{ label: string; percent: string }> {
        const L = window.siyuan.languages;
        // 固定顺序展示（与后端 key 对应）。
        const order: Array<{ key: string; labelKey: string }> = [
            {key: "system", labelKey: "tokenCatSystem"},
            {key: "skills", labelKey: "tokenCatSkills"},
            {key: "messages", labelKey: "tokenCatMessages"},
            {key: "nativeToolsDef", labelKey: "tokenCatNativeToolsDef"},
            {key: "pluginToolsDef", labelKey: "tokenCatPluginToolsDef"},
            {key: "mcpToolsDef", labelKey: "tokenCatMcpToolsDef"},
            {key: "nativeTool", labelKey: "tokenCatNativeTool"},
            {key: "pluginTool", labelKey: "tokenCatPluginTool"},
            {key: "mcpTool", labelKey: "tokenCatMcpTool"},
            {key: "other", labelKey: "tokenCatOther"},
        ];
        const result: Array<{ label: string; percent: string }> = [];
        for (const item of order) {
            const tokens = this.contextTokenBreakdown[item.key] || 0;
            if (tokens <= 0) {
                continue;
            }
            // 占比保留 1 位小数；四舍五入为 0 的类（占比极小）跳过不显示，避免无意义的 0%。
            const rounded = this.contextTokens > 0
                ? Math.round(tokens / this.contextTokens * 1000) / 10
                : 0;
            if (rounded <= 0) {
                continue;
            }
            const label = (L as Record<string, string>)[item.labelKey] || item.key;
            result.push({label, percent: rounded + "%"});
        }
        return result;
    }

    // token 数格式化：1024 进制值（2^N，如 131072=128×1024）转成业界惯称（128k、1M），
    // 仅当「能整除 1024 且商在白名单」时才用 1024 进制，避免 256000 这种 1000 进制值被误判为 250k。
    // 其余按 1000 进制（200000→200k、1048576→1.0M）。
    private formatTokenCount(n: number): string {
        if (n <= 0) {
            return String(n);
        }
        // 白名单：业界常见的 2^N 商（8k/16k/32k/64k/128k/256k/512k/1M）+ 200（200k=204800 少见但存在）。
        const niceMultiples = new Set([8, 16, 32, 64, 128, 200, 256, 512, 1024]);
        if (n >= 1024 && n % 1024 === 0 && niceMultiples.has(n / 1024)) {
            const quotient = n / 1024;
            if (quotient >= 1024) {
                return (quotient / 1024) + "M";
            }
            return quotient + "k";
        }
        // 1000 进制或其他：除以 1000 / 1000000，整除时省略小数（200000→200k，3500→3.5k）。
        if (n >= 1000000) {
            return (n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1) + "M";
        }
        if (n >= 1000) {
            return (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1) + "k";
        }
        return String(n);
    }

    private clearThinking() {
        const items = this.messagesContainer.querySelectorAll(
            ".agent-chat__msg--thinking:not(.agent-chat__msg--thinking-done)"
        );
        for (let i = 0; i < items.length; i++) {
            items[i].remove();
        }
    }

    // 启动思考计时器，每 100ms 刷新所有未完成思考卡片的标题文本为「思考中... X.Xs」。
    private startThinkingTimer() {
        this.stopThinkingTimer();
        if (!this.requestStartTime) {
            return;
        }
        const tick = () => {
            const sec = Math.floor((Date.now() - this.requestStartTime) / 1000);
            const L = window.siyuan.languages;
            const live = (L.agentThinking || "Thinking") + " " + sec + "s";
            const cards = this.messagesContainer.querySelectorAll(
                ".agent-chat__msg--thinking:not(.agent-chat__msg--thinking-done) .agent-chat__thinking-text"
            );
            for (let i = 0; i < cards.length; i++) {
                (cards[i] as HTMLElement).textContent = live;
            }
        };
        tick();
        this.thinkingTimerId = window.setInterval(tick, 100);
    }

    // 停止思考计时器（思考结束/切换会话/停止生成时调用，避免泄漏）。
    private stopThinkingTimer() {
        if (this.thinkingTimerId) {
            clearInterval(this.thinkingTimerId);
            this.thinkingTimerId = 0;
        }
    }

    private finishActiveThinking() {
        this.stopThinkingTimer();
        const L = window.siyuan.languages;
        // 耗时存为数值（用于持久化 entry.duration），"已思考：Xs" 文本只在 DOM 显示、不落盘。
        const durSec = this.requestStartTime ? (Date.now() - this.requestStartTime) / 1000 : 0;
        this.currentThinkingDuration = durSec;
        const doneText = durSec > 0
            ? (L.agentThinkingDoneTime ? L.agentThinkingDoneTime.replace("%s", Math.round(durSec) + "s") : (L.agentThinking || "Thinking"))
            : (L.agentThinking || "Thinking");

        const items = this.messagesContainer.querySelectorAll(
            ".agent-chat__msg--thinking:not(.agent-chat__msg--thinking-done)"
        );
        for (let i = 0; i < items.length; i++) {
            const el = items[i] as HTMLElement;
            if (i === items.length - 1) {
                const streamingChat = el.querySelector(".agent-chat__thinking-chat--streaming");
                if (streamingChat) {
                    streamingChat.remove();
                }
            }
            // 用户未手动操作且仍在预览态 → 思考完成后自动折叠（尊重用户已展开/折叠的最终状态）。
            if (!el.hasAttribute("data-user-interacted")) {
                const body = el.querySelector(".agent-chat__thinking-body");
                body?.classList.remove("agent-chat__thinking-body--preview");
            }
            el.classList.add("agent-chat__msg--thinking-done");
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
        this.updateSendButtonState();
    }

    // 根据"是否流式中"、"是否有可用模型"、"输入框是否有内容"综合决定发送按钮与输入框可用性。
    // 无模型时一并禁用发送按钮与输入框（attr disabled + 灰样式 + composer-host 禁用态），从源头阻止无效请求。
    private updateSendButtonState() {
        const disabled = this.isStreaming || this.modelOptions.length === 0 || !this.hasComposerInput();
        if (disabled) {
            this.sendBtn.setAttribute("disabled", "disabled");
        } else {
            this.sendBtn.removeAttribute("disabled");
        }
        if (this.composerHost) {
            // 复用流式时已有的禁用态样式（灰显 + 阻止交互）。
            // 注意：仅流式 / 无模型时禁用 composer；输入为空不禁用 composer（用户仍可正常编辑）。
            const composerDisabled = this.isStreaming || this.modelOptions.length === 0;
            this.composerHost.classList.toggle("agent-chat__composer-host--disabled", composerDisabled);
        }
    }

    // 输入框当前是否有可发送内容（含 @引用也算）。无 composer 时返回 false。
    private hasComposerInput(): boolean {
        if (!this.composer) {
            return false;
        }
        return this.composer.getSendData().text.length > 0;
    }

    // 持续校正滚动位置约 duration ms（覆盖 dock 宽高过渡 / 异步富渲染期间 scrollHeight 变化），
    // 使 scrollTop 落到距底部 scrollBottom 的位置。scrollBottom 为 0 即贴底。
    // 供开关面板（layoutVisible 恢复）与切换会话（renderLoadedSession 后）共用。
    private restoreScrollToBottom(scrollBottom: number, duration = 320) {
        if (scrollBottom < 0) {
            return;
        }
        const startedAt = Date.now();
        // 标记为程序化滚动，避免恢复期间触发 scroll 事件里的 userScrolledUp 翻转。
        this.programmaticScroll = true;
        const tick = () => {
            if (!this.layoutVisible) {
                this.programmaticScroll = false;
                return;
            }
            const {scrollHeight} = this.messagesContainer;
            // 距底部同样的距离；距底为 0（贴底）时 target = scrollHeight。
            const target = Math.max(0, scrollHeight - scrollBottom);
            this.messagesContainer.scrollTop = target;
            if (Date.now() - startedAt < duration) {
                requestAnimationFrame(tick);
            } else {
                // 多留一帧再清标志，确保最后一次 scroll 事件已被吞掉。
                requestAnimationFrame(() => {
                    this.programmaticScroll = false;
                });
            }
        };
        requestAnimationFrame(tick);
    }

    // 思考结束后定位到思考卡片下方：让折叠后的思考卡片底部贴近容器视口顶部，
    // 其下方留出空间承载即将/已开始流式的正文。delay 用于等待卡片折叠的 max-height 过渡（约 0.2s）完成。
    private scrollToThinkingCardBelow(card: HTMLElement, delay = 220) {
        const align = () => {
            if (!card.isConnected) {
                return;
            }
            // 用 getBoundingClientRect 计算卡片底部相对滚动容器的偏移，
            // 避免依赖 offsetParent 是否为滚动容器（定位祖先可能不是 messagesContainer）。
            const containerRect = this.messagesContainer.getBoundingClientRect();
            const cardRect = card.getBoundingClientRect();
            // 卡片底部在文档中的位置 - 容器顶部在文档中的位置 + 当前已滚动量 = 卡片底部的 scrollTop 目标值。
            const target = this.messagesContainer.scrollTop + (cardRect.bottom - containerRect.top) + 8;
            const max = this.messagesContainer.scrollHeight - this.messagesContainer.clientHeight;
            this.programmaticScroll = true;
            this.messagesContainer.scrollTop = Math.min(target, max);
            requestAnimationFrame(() => {
                this.programmaticScroll = false;
            });
        };
        if (delay > 0) {
            window.setTimeout(align, delay);
        } else {
            align();
        }
    }

    private scrollToBottom(force = false, smooth = false) {
        if (!force && this.userScrolledUp) {
            return;
        }        // Guard with a flag so the resulting scroll event can be told apart from
        // a user-driven scroll. Without this, the programmatic stick-to-bottom
        // write itself trips the scroll handler and, while streaming, flips
        // userScrolledUp on transiently (scrollHeight keeps growing) which
        // immediately breaks follow-scroll.
        this.programmaticScroll = true;
        requestAnimationFrame(() => {
            if (smooth) {
                // Smooth scrolling fires scroll events asynchronously throughout the
                // animation, so keep the guard raised until scrolling settles: on
                // scrollend, on a 1s timeout fallback, or immediately if the user
                // wheels/touches during the animation (counts as a user scroll).
                const finish = () => {
                    this.messagesContainer.removeEventListener("scrollend", finish);
                    this.messagesContainer.removeEventListener("wheel", onWheel);
                    clearTimeout(timer);
                    this.programmaticScroll = false;
                };
                const onWheel = () => {
                    this.messagesContainer.removeEventListener("scrollend", finish);
                    clearTimeout(timer);
                    this.programmaticScroll = false;
                };
                const timer = window.setTimeout(finish, 1000);
                this.messagesContainer.addEventListener("scrollend", finish, {once: true});
                this.messagesContainer.addEventListener("wheel", onWheel, {once: true, passive: true});
                this.messagesContainer.scrollTo({top: this.messagesContainer.scrollHeight, behavior: "smooth"});
            } else {
                this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
                // Reset the flag only after the scroll event caused by this write has
                // been dispatched (a second RAF runs after layout/event delivery).
                requestAnimationFrame(() => {
                    this.programmaticScroll = false;
                });
            }
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
        if (!el) {
            return;
        }
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
