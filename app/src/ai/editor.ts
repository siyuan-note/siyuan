import {fetchAIEditorSSE, IAIEditorMessage, TAIEditorSSEEvent} from "./editorSSE";
import {genUUID} from "../util/genID";
import {
    focusByOffset,
    getBlockRanges,
    getSelectionOffset,
    setLastNodeRange
} from "../protyle/util/selection";
import {getContenteditableElement} from "../protyle/wysiwyg/getBlock";
import {hasClosestByAttribute, hasClosestByTag, isInEmbedBlock} from "../protyle/util/hasClosest";
import {insertHTML} from "../protyle/util/insertHTML";
import {blockRender} from "../protyle/render/blockRender";
import {processRender} from "../protyle/util/processCode";
import {highlightRender} from "../protyle/render/highlightRender";
import {copyPlainText} from "../protyle/util/compatibility";
import {showMessage} from "../dialog/message";
import {confirmDialog} from "../dialog/confirmDialog";
import {escapeHtml} from "../util/escape";
import {isMobile} from "../util/functions";
import {Constants} from "../constants";

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
    notice: string;
    panel: HTMLElement;
    body: HTMLElement;
    modelElement: HTMLElement;
    statusElement: HTMLElement;
    stopButton: HTMLButtonElement;
    actionsElement: HTMLElement;
    abortController: AbortController;
    mutationObserver?: MutationObserver;
    resizeObserver?: ResizeObserver;
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
    clone.classList.remove("protyle-wysiwyg--select", "protyle-wysiwyg--hl");
    clone.removeAttribute(Constants.ATTRIBUTE_EDITING);
    clone.querySelectorAll(".protyle-wysiwyg--select, .protyle-wysiwyg--hl").forEach(item => {
        item.classList.remove("protyle-wysiwyg--select", "protyle-wysiwyg--hl");
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

const getSourceConflict = (task: IAIEditorTask) => {
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

const sourcePartText = (protyle: IProtyle, range: Range) => {
    const text = range.toString().replace(new RegExp(Constants.ZWSP, "g"), "");
    const fragment = range.cloneContents();
    if (!fragment.querySelector('.img, [data-type~="inline-math"], [data-type~="a"], [data-type~="block-ref"]')) {
        return text;
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
        input: blockRanges.map(item => sourcePartText(protyle, item.range)).filter(Boolean).join("\n\n"),
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

const rebuildSourceRange = (task: IAIEditorTask) => {
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

const getInsertRange = (task: IAIEditorTask) => {
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

const getInsertHTML = (task: IAIEditorTask, range: Range) => {
    const inCode = hasClosestByAttribute(range.startContainer, "data-type", "NodeCodeBlock") ||
        hasClosestByTag(range.startContainer, "CODE");
    const content = task.source.kind === "writing" ? `${task.source.input}\n\n${task.content}` : task.content;
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
    if (task.renderFrame) {
        cancelAnimationFrame(task.renderFrame);
    }
    task.mutationObserver?.disconnect();
    task.resizeObserver?.disconnect();
    task.protyle.contentElement.removeEventListener("scroll", task.updatePosition);
    window.removeEventListener("resize", task.updatePosition);
    task.panel.remove();
    const state = getState(task.protyle);
    if (state.task === task) {
        state.task = undefined;
    }
};

const applyTaskResult = (task: IAIEditorTask) => {
    if (!task.content) {
        return;
    }
    const conflict = getSourceConflict(task);
    const range = getInsertRange(task);
    if (!task.source.insertSupported || conflict.missing ||
        (task.source.kind === "writing" && conflict.changed)) {
        return;
    }
    if (!range || !task.protyle.wysiwyg.element.contains(range.startContainer)) {
        showMessage(window.siyuan.languages.aiSourceChanged, 5000, "error");
        return;
    }
    task.protyle.toolbar.range = range;
    const insertion = getInsertHTML(task, range);
    insertHTML(insertion.html, task.protyle, insertion.isBlock, true);
    renderInsertedContent(task.protyle);
    cleanupTask(task);
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
    task.body.innerHTML = task.protyle.lute.Md2BlockDOM(task.content);
    blockRender(task.protyle, task.body);
    processRender(task.body);
    highlightRender(task.body);
    task.body.querySelectorAll("[contenteditable]").forEach(item => item.setAttribute("contenteditable", "false"));
};

const scheduleTaskPreview = (task: IAIEditorTask) => {
    if (task.renderFrame) {
        return;
    }
    task.renderFrame = requestAnimationFrame(() => {
        task.renderFrame = undefined;
        renderTaskPreview(task);
        task.updatePosition();
    });
};

const updateTaskActions = (task: IAIEditorTask) => {
    const conflict = getSourceConflict(task);
    const sourceButton = task.actionsElement.querySelector<HTMLButtonElement>('[data-action="source"]');
    if (sourceButton) {
        sourceButton.disabled = !task.content || !task.source.insertSupported || conflict.missing ||
            (task.source.kind === "writing" && conflict.changed);
    }
    task.actionsElement.querySelectorAll<HTMLButtonElement>("button").forEach(item => {
        if (item.dataset.action !== "retry" && !task.content) {
            item.disabled = true;
        }
    });
    if (conflict.missing || conflict.changed) {
        task.statusElement.textContent = window.siyuan.languages.aiSourceChanged;
    } else if (task.status === "streaming") {
        task.statusElement.textContent = window.siyuan.languages.loading;
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
    task.stopButton.classList.add("fn__none");
    task.actionsElement.classList.remove("fn__none");
    renderTaskPreview(task, true);
    updateTaskActions(task);
};

const handleTaskEvent = (task: IAIEditorTask, event: TAIEditorSSEEvent) => {
    if (event.type === "content") {
        task.content += event.token;
        scheduleTaskPreview(task);
    } else if (event.type === "truncated") {
        task.notice = event.message;
    } else if (event.type === "error") {
        task.status = "error";
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
    task.content = "";
    task.notice = "";
    task.body.textContent = "";
    updateTaskModel(task);
    task.statusElement.textContent = window.siyuan.languages.loading;
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

const createTask = (protyle: IProtyle, source: IAIEditorSource) => {
    const panel = document.createElement("div");
    panel.className = `ai-editor-panel${isMobile() ? " ai-editor-panel--mobile" : ""}`;
    panel.setAttribute("contenteditable", "false");
    panel.style.zIndex = (++window.siyuan.zIndex).toString();
    panel.innerHTML = `<div class="ai-editor-panel__header">
    <span class="fn__flex-1 fn__ellipsis">${escapeHtml(window.siyuan.languages.aiEdit)}<span class="ai-editor-panel__model"></span></span>
    <span class="ai-editor-panel__status"></span>
    <button class="b3-button b3-button--outline ai-editor-panel__stop">${escapeHtml(window.siyuan.languages.agentStop)}</button>
</div>
<div class="ai-editor-panel__body protyle-wysiwyg" data-readonly="true"></div>
<div class="ai-editor-panel__actions fn__none"></div>`;
    const actionsElement = panel.querySelector(".ai-editor-panel__actions") as HTMLElement;
    actionsElement.append(createTaskButton("source", source.kind === "writing" ?
        window.siyuan.languages.aiInsertAtOriginal : window.siyuan.languages.insertAfter, true));
    actionsElement.append(createTaskButton("copy", window.siyuan.languages.copy, true));
    actionsElement.append(createTaskButton("retry", window.siyuan.languages.retry, true));

    const task: IAIEditorTask = {
        id: genUUID(),
        protyle,
        source,
        status: "streaming",
        content: "",
        notice: "",
        panel,
        body: panel.querySelector(".ai-editor-panel__body") as HTMLElement,
        modelElement: panel.querySelector(".ai-editor-panel__model") as HTMLElement,
        statusElement: panel.querySelector(".ai-editor-panel__status") as HTMLElement,
        stopButton: panel.querySelector(".ai-editor-panel__stop") as HTMLButtonElement,
        actionsElement,
        abortController: new AbortController(),
        historySnapshot: getState(protyle).history.map(item => ({...item})),
        historyCommitted: false,
        updatePosition: () => undefined,
    };
    task.updatePosition = () => {
        if (!task.panel.isConnected || task.panel.classList.contains("ai-editor-panel--mobile")) {
            return;
        }
        const anchorPart = task.source.parts[task.source.parts.length - 1];
        const anchorElement = findSourceElement(protyle, anchorPart.id);
        const protyleRect = protyle.element.getBoundingClientRect();
        const panelRect = panel.getBoundingClientRect();
        if (!anchorElement) {
            panel.style.left = `${Math.max(8, protyle.element.clientWidth - panelRect.width - 16)}px`;
            panel.style.top = `${Math.max(8, protyle.element.clientHeight - panelRect.height - 16)}px`;
            return;
        }
        const anchorRect = anchorElement.getBoundingClientRect();
        const left = Math.min(Math.max(8, anchorRect.left - protyleRect.left),
            Math.max(8, protyle.element.clientWidth - panelRect.width - 16));
        let top = anchorRect.bottom - protyleRect.top + 4;
        if (top + panelRect.height > protyle.element.clientHeight - 8) {
            top = Math.max(8, anchorRect.top - protyleRect.top - panelRect.height - 4);
        }
        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
    };
    task.stopButton.addEventListener("click", () => stopTask(task));
    actionsElement.addEventListener("click", event => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]");
        if (!button || button.disabled) {
            return;
        }
        switch (button.dataset.action) {
            case "source":
                applyTaskResult(task);
                break;
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
    task.resizeObserver = new ResizeObserver(task.updatePosition);
    task.resizeObserver.observe(panel);
    protyle.contentElement.addEventListener("scroll", task.updatePosition);
    window.addEventListener("resize", task.updatePosition);
    requestAnimationFrame(task.updatePosition);
    return task;
};

const beginTask = (protyle: IProtyle, source: IAIEditorSource) => {
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
    confirmDialog(window.siyuan.languages.aiEdit, window.siyuan.languages.aiReplaceCurrentTask, start);
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
