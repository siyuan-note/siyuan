import {confirmDialog} from "../dialog/confirmDialog";
import {fetchAIEditorSSE, IAIEditorMessage, TAIEditorSSEEvent} from "./editorSSE";
import {genUUID} from "../util/genID";
import {
    focusByOffset,
    getBlockRanges
} from "../protyle/util/selection";
import {getSelectionOffset, setLastNodeRange} from "../protyle/util/selectionOffsets";
import {getContenteditableElement} from "../protyle/wysiwyg/getBlock";
import {hasClosestByAttribute, hasClosestByTag, isInEmbedBlock} from "../protyle/util/hasClosest";
import {insertHTML} from "../protyle/util/insertHTML";
import {blockRender} from "../protyle/render/blockRender";
import {processRender} from "../protyle/util/processCode";
import {highlightRender} from "../protyle/render/highlightRender";
import {copyPlainText, isDisabledFeature} from "../protyle/util/compatibility";
import {showMessage} from "../dialog/message";
import {escapeAriaLabel, escapeHtml} from "../util/escape";
import {isMobile} from "../util/functions";
import {Constants} from "../constants";
import {bindThinkingCardToggle, updateThinkingBody} from "./thinkingCard";
import {BLOCK_SELECTION_MODE_CLASS} from "../protyle/wysiwyg/blockSelection";
import {normalizeHTMLAssetIFrameBlockDOM} from "../asset/html";
import {bindEditorPanelPosition} from "./editorPanelPosition";
import {isEncryptedBox} from "../util/pathName";

type TAIEditorSourceKind = "selection" | "blocks" | "writing";
type TAIEditorTaskStatus = "streaming" | "done" | "stopped" | "error";

interface IAIEditorSourcePart {
    id: string;
    start: number;
    end: number;
    signature: string;
}

interface IAIEditorSource {
    kind: TAIEditorSourceKind;
    parts: IAIEditorSourcePart[];
    ids: string[];
    input: string;
    action: string;
    insertSupported: boolean;
}

interface IAIEditorTask {
    id: string;
    protyle: IProtyle;
    source: IAIEditorSource;
    status: TAIEditorTaskStatus;
    content: string;
    prompt?: string;
    continuing?: boolean;
    agentSessionID?: string;
    notice: string;
    reasoning: boolean;
    reasoningContent: string;
    panel: HTMLElement;
    body: HTMLElement;
    thinkingElement: HTMLElement;
    thinkingBody: HTMLElement;
    thinkingReasoningElement: HTMLElement;
    thinkingTextElement: HTMLElement;
    thinkingLatestElement: HTMLElement;
    thinkingStartedAt: number;
    thinkingTimer?: number;
    modelElement: HTMLElement;
    statusElement: HTMLElement;
    stopButton: HTMLButtonElement;
    actionsElement: HTMLElement;
    abortController: AbortController;
    mutationObserver?: MutationObserver;
    disposePosition?: () => void;
    historySnapshot: IAIEditorMessage[];
    historyCommitted: boolean;
    renderFrame?: number;
    updatePosition: () => void;
}

interface IAIEditorState {
    task?: IAIEditorTask;
    history: IAIEditorMessage[];
}

const states = new WeakMap<IProtyle, IAIEditorState>();
const getState = (protyle: IProtyle) => {
    let state = states.get(protyle);
    if (!state) {
        state = {history: []};
        states.set(protyle, state);
    }
    return state;
};

const getEditingModelName = () => {
    const aiConfig = window.siyuan.config.ai;
    const modelID = aiConfig.editing?.modelId || "";
    if (!modelID) {
        return "";
    }
    for (const provider of aiConfig.providers) {
        if (!provider.enabled) {
            continue;
        }
        const model = provider.models.find(item => item.enabled && (item.id === modelID || item.name === modelID));
        if (model) {
            return model.displayName || model.name;
        }
    }
    return "";
};

const updateTaskModel = (task: IAIEditorTask) => {
    task.modelElement.textContent = getEditingModelName();
};

const normalizeSourceElement = (element: HTMLElement) => {
    const clone = element.cloneNode(true) as HTMLElement;
    clone.classList.remove("protyle-wysiwyg--select", BLOCK_SELECTION_MODE_CLASS, "protyle-wysiwyg--hl");
    clone.removeAttribute(Constants.ATTRIBUTE_EDITING);
    clone.querySelectorAll(`.protyle-wysiwyg--select, .${BLOCK_SELECTION_MODE_CLASS}, .protyle-wysiwyg--hl`).forEach(item => {
        item.classList.remove("protyle-wysiwyg--select", BLOCK_SELECTION_MODE_CLASS, "protyle-wysiwyg--hl");
    });
    clone.querySelectorAll(`[${Constants.ATTRIBUTE_EDITING}]`).forEach(item => {
        item.removeAttribute(Constants.ATTRIBUTE_EDITING);
    });
    return clone.outerHTML;
};

const findSourceElement = (protyle: IProtyle, id: string) => {
    return Array.from(protyle.wysiwyg.element.querySelectorAll<HTMLElement>(`[data-node-id="${id}"]`)).find(item =>
        !isInEmbedBlock(item));
};

type EditorTarget = Pick<IAIEditorTask, "protyle" | "source">;

const getSourceConflict = (task: EditorTarget) => {
    let missing = false;
    let changed = false;
    const orderedElements: HTMLElement[] = [];
    const seen = new Set<string>();
    task.source.parts.forEach(part => {
        if (seen.has(part.id)) {
            return;
        }
        seen.add(part.id);
        const element = findSourceElement(task.protyle, part.id);
        if (!element) {
            missing = true;
            return;
        }
        orderedElements.push(element);
        if (normalizeSourceElement(element) !== part.signature) {
            changed = true;
        }
    });
    for (let i = 1; i < orderedElements.length; i++) {
        if (!(orderedElements[i - 1].compareDocumentPosition(orderedElements[i]) & Node.DOCUMENT_POSITION_FOLLOWING)) {
            changed = true;
            break;
        }
    }
    return {missing, changed};
};

const isMarkdownInlineElement = (element: Element) => {
    return element.matches("span[data-type], code, strong, em, b, i, s, del, u, mark, sub, sup, kbd, a");
};

const sourcePartMarkdown = (protyle: IProtyle, range: Range, editableElement: Element) => {
    const text = range.toString().replaceAll(Constants.ZWSP, "");
    let fragment: Node = range.cloneContents();
    let ancestor = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE ?
        range.commonAncestorContainer as Element : range.commonAncestorContainer.parentElement;
    while (ancestor && ancestor !== editableElement && editableElement.contains(ancestor)) {
        if (isMarkdownInlineElement(ancestor)) {
            const clone = ancestor.cloneNode(false) as Element;
            clone.append(fragment);
            fragment = clone;
        }
        ancestor = ancestor.parentElement;
    }
    const element = document.createElement("div");
    element.append(fragment);
    return protyle.lute.BlockDOM2StdMd(element.innerHTML).trimEnd() || text;
};

const buildSelectionSource = (protyle: IProtyle, range: Range, action: string): IAIEditorSource | undefined => {
    const blockRanges = getBlockRanges(protyle.wysiwyg.element, range);
    if (blockRanges.length === 0) {
        return;
    }
    const parts = blockRanges.map(item => ({
        id: item.blockElement.getAttribute("data-node-id") || "",
        start: item.start,
        end: item.end,
        signature: normalizeSourceElement(item.blockElement),
    }));
    return {
        kind: "selection",
        parts,
        ids: [],
        input: blockRanges.map(item => sourcePartMarkdown(protyle, item.range, item.editableElement))
            .filter(Boolean).join("\n\n"),
        action,
        insertSupported: !protyle.disabled,
    };
};

const getFullBlockPart = (element: HTMLElement): IAIEditorSourcePart | undefined => {
    const editableElement = getContenteditableElement(element);
    if (!editableElement) {
        return {
            id: element.getAttribute("data-node-id") || "",
            start: 0,
            end: 0,
            signature: normalizeSourceElement(element),
        };
    }
    const range = document.createRange();
    range.selectNodeContents(editableElement);
    const position = getSelectionOffset(editableElement, undefined, range);
    return {
        id: element.getAttribute("data-node-id") || "",
        start: position.start,
        end: position.end,
        signature: normalizeSourceElement(element),
    };
};

const buildBlockSource = (protyle: IProtyle, elements: HTMLElement[], action: string): IAIEditorSource | undefined => {
    const sourceElements = elements.filter(item => item?.isConnected && item.hasAttribute("data-node-id"));
    const parts = sourceElements.map(getFullBlockPart).filter((item): item is IAIEditorSourcePart => Boolean(item));
    if (parts.length === 0) {
        return;
    }
    return {
        kind: "blocks",
        parts,
        ids: sourceElements.map(item => item.getAttribute("data-node-id") || ""),
        input: "",
        action,
        insertSupported: !protyle.disabled,
    };
};

const buildWritingSource = (protyle: IProtyle, element: HTMLElement, input: string): IAIEditorSource | undefined => {
    const editableElement = getContenteditableElement(element);
    if (!editableElement) {
        return;
    }
    const range = document.createRange();
    setLastNodeRange(editableElement, range);
    range.collapse(true);
    const position = getSelectionOffset(editableElement, undefined, range);
    return {
        kind: "writing",
        parts: [{
            id: element.getAttribute("data-node-id") || "",
            start: position.start,
            end: position.end,
            signature: normalizeSourceElement(element),
        }],
        ids: [],
        input,
        action: "",
        insertSupported: !protyle.disabled,
    };
};

const rebuildSourceRange = (task: EditorTarget) => {
    const firstPart = task.source.parts[0];
    const lastPart = task.source.parts[task.source.parts.length - 1];
    const firstElement = findSourceElement(task.protyle, firstPart.id);
    const lastElement = findSourceElement(task.protyle, lastPart.id);
    if (!firstElement || !lastElement) {
        return;
    }
    if (firstElement === lastElement) {
        return focusByOffset(firstElement, firstPart.start, lastPart.end, false) as Range;
    }
    const startRange = focusByOffset(firstElement, firstPart.start, firstPart.start, false) as Range;
    const endRange = focusByOffset(lastElement, lastPart.end, lastPart.end, false) as Range;
    if (!startRange || !endRange) {
        return;
    }
    const range = document.createRange();
    range.setStart(startRange.startContainer, startRange.startOffset);
    range.setEnd(endRange.endContainer, endRange.endOffset);
    return range;
};

const getInsertRange = (task: EditorTarget) => {
    if (task.source.kind === "writing") {
        return rebuildSourceRange(task);
    }
    const lastPart = task.source.parts[task.source.parts.length - 1];
    const lastElement = findSourceElement(task.protyle, lastPart.id);
    if (!lastElement) {
        return;
    }
    const range = document.createRange();
    range.selectNodeContents(lastElement);
    range.collapse(false);
    return range;
};

const getInsertHTML = (task: EditorTarget, range: Range, result: string, withInput: boolean) => {
    const inCode = hasClosestByAttribute(range.startContainer, "data-type", "NodeCodeBlock") ||
        hasClosestByTag(range.startContainer, "CODE");
    const content = task.source.kind === "writing" && withInput ? `${task.source.input}\n\n${result}` : result;
    return {
        html: inCode ? content : task.protyle.lute.Md2BlockDOM(content),
        isBlock: !inCode,
    };
};

const renderInsertedContent = (protyle: IProtyle) => {
    blockRender(protyle, protyle.wysiwyg.element);
    processRender(protyle.wysiwyg.element);
    highlightRender(protyle.wysiwyg.element);
};

const cleanupTask = (task: IAIEditorTask) => {
    task.abortController.abort();
    if (task.thinkingTimer) {
        window.clearInterval(task.thinkingTimer);
    }
    if (task.renderFrame) {
        cancelAnimationFrame(task.renderFrame);
    }
    task.mutationObserver?.disconnect();
    task.disposePosition?.();
    task.panel.remove();
    const state = getState(task.protyle);
    if (state.task === task) {
        state.task = undefined;
    }
};

const insertEditorResult = (task: EditorTarget, content: string, withInput: boolean) => {
    if (!content || !task.protyle.element.isConnected || task.protyle.disabled) {
        return false;
    }
    const conflict = getSourceConflict(task);
    const range = getInsertRange(task);
    if (!task.source.insertSupported || conflict.missing ||
        (task.source.kind === "writing" && conflict.changed)) {
        return false;
    }
    if (!range || !task.protyle.wysiwyg.element.contains(range.startContainer)) {
        return false;
    }
    task.protyle.toolbar.range = range;
    const insertion = getInsertHTML(task, range, content, withInput);
    insertHTML(insertion.html, task.protyle, insertion.isBlock, true);
    renderInsertedContent(task.protyle);
    return true;
};

const renderTaskPreview = (task: IAIEditorTask, rich = false) => {
    if (task.renderFrame) {
        cancelAnimationFrame(task.renderFrame);
        task.renderFrame = undefined;
    }
    if (!rich) {
        task.body.classList.add("ai-editor-panel__body--streaming");
        task.body.textContent = task.content;
        return;
    }
    task.body.classList.remove("ai-editor-panel__body--streaming");
    task.body.innerHTML = normalizeHTMLAssetIFrameBlockDOM(task.protyle.lute.Md2BlockDOM(task.content));
    blockRender(task.protyle, task.body);
    processRender(task.body);
    highlightRender(task.body);
    task.body.querySelectorAll("[contenteditable]").forEach(item => item.setAttribute("contenteditable", "false"));
};

const renderTaskReasoning = (task: IAIEditorTask) => {
    updateThinkingBody(task.thinkingBody, () => {
        task.thinkingReasoningElement.textContent = task.reasoningContent;
    });
    task.thinkingLatestElement.textContent = task.reasoningContent.replace(/\s+/g, " ").trim();
    task.thinkingLatestElement.scrollLeft = task.thinkingLatestElement.scrollWidth;
};

const updateTaskThinkingText = (task: IAIEditorTask) => {
    const seconds = Math.floor((Date.now() - task.thinkingStartedAt) / 1000);
    task.thinkingTextElement.textContent = `${window.siyuan.languages.agentThinking} ${seconds}s`;
};

const startTaskReasoning = (task: IAIEditorTask) => {
    if (task.reasoning) {
        return;
    }
    task.reasoning = true;
    task.thinkingElement.classList.remove("fn__none", "agent-chat__msg--thinking-done");
    task.thinkingLatestElement.classList.remove("fn__none");
    task.thinkingBody.classList.remove("agent-chat__thinking-body--preview");
    task.body.classList.add("fn__none");
    updateTaskThinkingText(task);
    task.thinkingTimer = window.setInterval(() => updateTaskThinkingText(task), 1000);
};

const finishTaskReasoning = (task: IAIEditorTask) => {
    if (!task.reasoning || !task.reasoningContent) {
        return;
    }
    if (task.thinkingTimer) {
        window.clearInterval(task.thinkingTimer);
        task.thinkingTimer = undefined;
    }
    renderTaskReasoning(task);
    task.reasoning = false;
    task.thinkingElement.classList.add("agent-chat__msg--thinking-done");
    task.thinkingLatestElement.classList.add("fn__none");
    if (!task.thinkingElement.hasAttribute("data-user-interacted")) {
        task.thinkingBody.classList.remove("agent-chat__thinking-body--preview");
    }
    const seconds = Math.max(1, Math.round((Date.now() - task.thinkingStartedAt) / 1000));
    task.thinkingTextElement.textContent = window.siyuan.languages.agentThinkingDoneTime.replace("%s", `${seconds}s`);
};

const scheduleTaskPreview = (task: IAIEditorTask) => {
    if (task.renderFrame) {
        return;
    }
    task.renderFrame = requestAnimationFrame(() => {
        task.renderFrame = undefined;
        renderTaskReasoning(task);
        renderTaskPreview(task);
        task.updatePosition();
    });
};

const updateTaskActions = (task: IAIEditorTask) => {
    const conflict = getSourceConflict(task);
    const sourceButton = task.actionsElement.querySelector<HTMLButtonElement>('[data-action="source"]');
    const copyButton = task.actionsElement.querySelector<HTMLButtonElement>('[data-action="copy"]');
    if (sourceButton) {
        sourceButton.disabled = !task.content || !task.source.insertSupported || conflict.missing ||
            (task.source.kind === "writing" && conflict.changed);
    }
    if (copyButton) {
        copyButton.disabled = !task.content;
    }
    const continueButton = task.actionsElement.querySelector<HTMLButtonElement>('[data-action="continue"]');
    if (continueButton) {
        continueButton.disabled = !task.content || !task.prompt || task.continuing;
    }
    if (conflict.missing || conflict.changed) {
        task.statusElement.textContent = window.siyuan.languages.aiSourceChanged;
    } else if (task.status === "streaming") {
        task.statusElement.textContent = "";
    } else if (task.notice) {
        task.statusElement.textContent = task.notice;
    } else if (task.status === "stopped") {
        task.statusElement.textContent = window.siyuan.languages.aiStopped;
    } else if (task.status === "done") {
        task.statusElement.textContent = "";
    }
};

const finishTask = (task: IAIEditorTask) => {
    if (task.status !== "streaming") {
        return;
    }
    task.status = "done";
    finishTaskReasoning(task);
    task.stopButton.classList.add("fn__none");
    task.actionsElement.classList.remove("fn__none");
    renderTaskPreview(task, true);
    if (task.source.kind === "writing" && !task.historyCommitted && task.content) {
        const state = getState(task.protyle);
        state.history.push({role: "user", content: task.source.input}, {role: "assistant", content: task.content});
        task.historyCommitted = true;
    }
    updateTaskActions(task);
    task.updatePosition();
};

const stopTask = (task: IAIEditorTask) => {
    if (task.status !== "streaming") {
        return;
    }
    task.abortController.abort();
    task.status = "stopped";
    finishTaskReasoning(task);
    task.stopButton.classList.add("fn__none");
    task.actionsElement.classList.remove("fn__none");
    renderTaskPreview(task, true);
    updateTaskActions(task);
};

const handleTaskEvent = (task: IAIEditorTask, event: TAIEditorSSEEvent) => {
    if (event.type === "start" && event.prompt) {
        task.prompt = event.prompt;
    } else if (event.type === "reasoning") {
        task.reasoningContent += event.token;
        if (!task.content) {
            startTaskReasoning(task);
            task.statusElement.textContent = "";
            scheduleTaskPreview(task);
        }
    } else if (event.type === "content") {
        finishTaskReasoning(task);
        task.body.classList.remove("fn__none");
        task.statusElement.textContent = "";
        task.content += event.token;
        scheduleTaskPreview(task);
    } else if (event.type === "truncated") {
        task.notice = event.message;
    } else if (event.type === "error") {
        task.status = "error";
        finishTaskReasoning(task);
        task.notice = event.message;
        task.stopButton.classList.add("fn__none");
        task.actionsElement.classList.remove("fn__none");
        renderTaskPreview(task, true);
        updateTaskActions(task);
    } else if (event.type === "done") {
        finishTask(task);
    }
};

const startTaskStream = (task: IAIEditorTask) => {
    const abortController = new AbortController();
    task.abortController = abortController;
    task.status = "streaming";
    const input = task.source.input;
    const action = task.source.action.trim();
    task.agentSessionID = undefined;
    task.prompt = task.source.kind === "blocks" ? undefined : !action ? input :
        action.includes("{{input}}") ? action.split("{{input}}").join(input) : action + ":\n\n" + input;
    task.content = "";
    task.notice = "";
    task.reasoning = false;
    task.reasoningContent = "";
    task.thinkingStartedAt = Date.now();
    if (task.thinkingTimer) {
        window.clearInterval(task.thinkingTimer);
        task.thinkingTimer = undefined;
    }
    task.thinkingElement.classList.add("fn__none");
    task.thinkingElement.classList.remove("agent-chat__msg--thinking-done");
    task.thinkingElement.removeAttribute("data-user-interacted");
    task.thinkingBody.classList.remove("agent-chat__thinking-body--preview", "agent-chat__thinking-body--expanded");
    task.thinkingReasoningElement.textContent = "";
    task.thinkingTextElement.textContent = window.siyuan.languages.agentThinking;
    task.thinkingLatestElement.textContent = "";
    task.thinkingLatestElement.classList.remove("fn__none");
    task.thinkingElement.querySelector(".agent-chat__thinking-arrow--expand")?.classList.remove("fn__none");
    task.thinkingElement.querySelector(".agent-chat__thinking-arrow--contract")?.classList.add("fn__none");
    task.body.classList.remove("fn__none");
    task.body.textContent = "";
    updateTaskModel(task);
    task.statusElement.textContent = "";
    task.stopButton.classList.remove("fn__none");
    task.actionsElement.classList.add("fn__none");
    fetchAIEditorSSE({
        taskID: task.id,
        ids: task.source.ids,
        input: task.source.input,
        action: task.source.action,
        history: task.source.kind === "writing" ? task.historySnapshot : [],
    }, event => {
        if (task.abortController === abortController) {
            handleTaskEvent(task, event);
        }
    }, abortController.signal).catch(error => {
        if (abortController.signal.aborted || task.abortController !== abortController ||
            getState(task.protyle).task !== task) {
            return;
        }
        task.status = "error";
        finishTaskReasoning(task);
        task.notice = error instanceof Error ? error.message : String(error);
        task.stopButton.classList.add("fn__none");
        task.actionsElement.classList.remove("fn__none");
        renderTaskPreview(task, true);
        updateTaskActions(task);
    });
};

const retryTask = (task: IAIEditorTask) => {
    if (task.historyCommitted) {
        const state = getState(task.protyle);
        state.history.splice(Math.max(0, state.history.length - 2), 2);
        task.historyCommitted = false;
    }
    task.abortController.abort();
    startTaskStream(task);
};

const createTaskButton = (action: string, label: string, primary = false) => {
    const button = document.createElement("button");
    button.className = `b3-button${primary ? " b3-button--text" : " b3-button--outline"}`;
    button.dataset.action = action;
    button.textContent = label;
    return button;
};

const createTaskIconButton = (action: string, label: string, icon: string) => {
    const button = document.createElement("button");
    button.className = "block__icon block__icon--show ariaLabel";
    button.dataset.action = action;
    button.dataset.position = "north";
    button.setAttribute("aria-label", label);
    button.innerHTML = `<svg><use xlink:href="#${icon}"></use></svg>`;
    return button;
};

const createTask = (protyle: IProtyle, source: IAIEditorSource) => {
    const panel = document.createElement("div");
    const mobile = isMobile();
    panel.className = `ai-editor-panel${mobile ? " ai-editor-panel--mobile" : ""}`;
    panel.setAttribute("contenteditable", "false");
    panel.style.zIndex = (++window.siyuan.zIndex).toString();
    panel.innerHTML = `${mobile ? `<div class="ai-editor-panel__grip" role="separator" aria-orientation="horizontal" tabindex="0" aria-label="${escapeAriaLabel(window.siyuan.languages.height)}"></div>` : ""}
<div class="ai-editor-panel__header"${mobile ? "" : ` tabindex="0" aria-label="${escapeAriaLabel(window.siyuan.languages.move)}"`}>
    ${mobile ? `<span class="ai-editor-panel__title fn__ellipsis">${escapeHtml(window.siyuan.languages.aiEdit)}</span>
    <span class="b3-chip b3-chip--middle b3-chip--info fn__flex-shrink">${escapeHtml(window.siyuan.languages.aiGeneratedContent)}</span>
    <span class="ai-editor-panel__details fn__flex fn__flex-1">
        <span class="ai-editor-panel__model fn__ellipsis"></span>
        <span class="ai-editor-panel__status"></span>
    </span>` : `<span class="fn__flex-1 fn__ellipsis">${escapeHtml(window.siyuan.languages.aiEdit)}<span class="ai-editor-panel__model"></span></span>
    <span class="ai-editor-panel__status"></span>`}
    <button class="ai-editor-panel__stop agent-chat__stop b3-button b3-button--icon b3-button--cancel ariaLabel" data-position="north" aria-label="${escapeAriaLabel(window.siyuan.languages.agentStop)}"><svg><use xlink:href="#iconSquareStop"></use></svg></button>
    <button class="block__icon block__icon--show ariaLabel ai-editor-panel__close" data-position="north" aria-label="${escapeAriaLabel(window.siyuan.languages.close)}"><svg><use xlink:href="#iconClose"></use></svg></button>
</div>
<div class="ai-editor-panel__thinking agent-chat__msg--thinking fn__none">
    <div class="agent-chat__thinking-card">
        <div class="agent-chat__thinking-header">
            <span class="agent-chat__thinking-arrow">
                <svg class="agent-chat__thinking-arrow--expand"><use xlink:href="#iconExpand"></use></svg>
                <svg class="agent-chat__thinking-arrow--contract fn__none"><use xlink:href="#iconContract"></use></svg>
            </span>
            <span class="agent-chat__thinking-text"></span>
            <span class="agent-chat__thinking-latest"></span>
        </div>
        <div class="agent-chat__thinking-body">
            <div class="agent-chat__thinking-reasoning-text"></div>
        </div>
    </div>
</div>
<div class="ai-editor-panel__body protyle-wysiwyg" data-readonly="true"></div>
    <div class="ai-editor-panel__actions fn__none"></div>`;
    const actionsElement = panel.querySelector(".ai-editor-panel__actions") as HTMLElement;
    actionsElement.append(createTaskIconButton("copy", window.siyuan.languages.copy, "iconCopy"));
    actionsElement.append(createTaskIconButton("retry", window.siyuan.languages.retry, "iconRefresh"));
    actionsElement.append(createTaskButton("source", source.kind === "writing" ?
        window.siyuan.languages.aiInsertAtOriginal : window.siyuan.languages.insertAfter, true));

    if (!isEncryptedBox(protyle.notebookId) && !window.siyuan.config.readonly && !window.siyuan.isPublish) {
        actionsElement.append(createTaskButton("continue", window.siyuan.languages.agentContinueEditing));
    }
    const task: IAIEditorTask = {
        id: genUUID(),
        protyle,
        source,
        status: "streaming",
        content: "",
        notice: "",
        reasoning: false,
        reasoningContent: "",
        panel,
        body: panel.querySelector(".ai-editor-panel__body") as HTMLElement,
        thinkingElement: panel.querySelector(".ai-editor-panel__thinking") as HTMLElement,
        thinkingBody: panel.querySelector(".agent-chat__thinking-body") as HTMLElement,
        thinkingReasoningElement: panel.querySelector(".agent-chat__thinking-reasoning-text") as HTMLElement,
        thinkingTextElement: panel.querySelector(".agent-chat__thinking-text") as HTMLElement,
        thinkingLatestElement: panel.querySelector(".agent-chat__thinking-latest") as HTMLElement,
        thinkingStartedAt: Date.now(),
        modelElement: panel.querySelector(".ai-editor-panel__model") as HTMLElement,
        statusElement: panel.querySelector(".ai-editor-panel__status") as HTMLElement,
        stopButton: panel.querySelector(".ai-editor-panel__stop") as HTMLButtonElement,
        actionsElement,
        abortController: new AbortController(),
        historySnapshot: getState(protyle).history.map(item => ({...item})),
        historyCommitted: false,
        updatePosition: () => undefined,
    };
    (panel.querySelector(".ai-editor-panel__close") as HTMLButtonElement).addEventListener("click", () => cleanupTask(task));
    bindThinkingCardToggle(task.thinkingElement);
    task.stopButton.addEventListener("click", () => stopTask(task));
    actionsElement.addEventListener("click", async event => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]");
        if (!button || button.disabled) {
            return;
        }
        switch (button.dataset.action) {
            case "source":
                if (insertEditorResult(task, task.content, true)) {
                    cleanupTask(task);
                } else {
                    showMessage(window.siyuan.languages.aiSourceChanged, 5000, "error");
                }
                break;
            case "continue": {
                if (!task.content || !task.prompt) return;
                task.continuing = true;
                button.disabled = true;
                try {
                    const {openEditorAgent} = await import("./editorAgent");
                    const chat = await openEditorAgent(protyle.app);
                    if (!chat || !task.panel.isConnected) return;
                    const origin = new WeakRef(protyle);
                    task.agentSessionID ??= Lute.NewNodeID();
                    const opened = await chat.continueEditorTask(task.agentSessionID, task.prompt, task.content, result => {
                        const editor = origin.deref();
                        return !!editor && insertEditorResult({protyle: editor, source}, result, false);
                    });
                    if (opened) cleanupTask(task);
                } catch (error) {
                    showMessage(String(error), 5000, "error");
                } finally {
                    task.continuing = false;
                    updateTaskActions(task);
                }
                break;
            }
            case "copy":
                copyPlainText(task.content);
                showMessage(window.siyuan.languages.copied, 2000);
                break;
            case "retry":
                retryTask(task);
                break;
        }
    });
    protyle.element.append(panel);
    task.mutationObserver = new MutationObserver(() => updateTaskActions(task));
    task.mutationObserver.observe(protyle.wysiwyg.element, {
        attributes: true,
        characterData: true,
        childList: true,
        subtree: true,
    });
    const position = bindEditorPanelPosition(protyle.element, protyle.contentElement, panel, mobile,
        () => findSourceElement(protyle, task.source.parts[task.source.parts.length - 1].id));
    task.updatePosition = position.update;
    task.disposePosition = position.destroy;
    return task;
};

const beginTask = (protyle: IProtyle, source: IAIEditorSource) => {
    if (isDisabledFeature("ai")) {
        return;
    }
    const state = getState(protyle);
    const start = () => {
        if (state.task) {
            cleanupTask(state.task);
        }
        const task = createTask(protyle, source);
        state.task = task;
        startTaskStream(task);
    };
    if (!state.task) {
        start();
        return;
    }
    confirmDialog({title: window.siyuan.languages.aiEdit, text: window.siyuan.languages.aiReplaceCurrentTask, confirm: start});
};

export const startAIEditorAction = (protyle: IProtyle, elements: HTMLElement[], range: Range | undefined,
                                     action: string) => {
    const source = range && !range.collapsed && protyle.wysiwyg.element.contains(range.startContainer) ?
        buildSelectionSource(protyle, range, action) : buildBlockSource(protyle, elements, action);
    if (!source || (!source.input && source.ids.length === 0)) {
        return;
    }
    beginTask(protyle, source);
};

export const startAIWriting = (protyle: IProtyle, element: HTMLElement, input: string) => {
    const source = buildWritingSource(protyle, element, input);
    if (source) {
        beginTask(protyle, source);
    }
};

export const clearAIEditorHistory = (protyle: IProtyle) => {
    getState(protyle).history = [];
};

export const destroyAIEditor = (protyle: IProtyle) => {
    const state = states.get(protyle);
    if (state?.task) {
        cleanupTask(state.task);
    }
    states.delete(protyle);
};
