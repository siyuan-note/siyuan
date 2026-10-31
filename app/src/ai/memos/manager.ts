import {renderMemoryOverview} from "./overview";
import {showMessage} from "../../dialog/message";
import {Dialog} from "../../dialog";
import {confirmDialog} from "../../dialog/confirmDialog";
import {fetchSyncPost} from "../../util/fetch";
import {escapeHtmlTextAndAttr as escapeHtml} from "../../util/escape";
import {genUUID} from "../../util/genID";
import {isMobile} from "../../util/functions";
import {isOnlyMeta} from "../../protyle/util/compatibility";
import {MemoryOperationState, memoryModelOptions} from "./state";
import {memoryTaskErrorMessage} from "./taskError";

// 当前页面重新打开管理器时继续查询后台任务，关闭窗口不取消模型处理。
let activeMemoryTask = "";

export const openMemoryManager = () => {
    const lang = window.siyuan.languages;
    const isReadOnly = () => window.siyuan.config?.readonly === true;
    const operation = new MemoryOperationState();
    let closed = false;
    let taskDirty = false;
    let submitting = false;
    let running = false;
    let discovering = true;
    let taskId = activeMemoryTask;
    let inputRevision = 0;
    let submittedInput: {id: string; text: string; revision: number};
    let taskGeneration = 0;
    let overviewGeneration = 0;
    let taskFailures = 0;
    let overviewFailures = 0;
    let taskTimer: number;
    let overviewTimer: number;
    let overviewSource = "";
    type Translation = {promise: Promise<{memory?: string; error?: unknown}>; controller: AbortController; settled: boolean};
    const translations = new Map<string, Translation>();
    let translationProviders = window.siyuan.config.ai?.providers;
    const abortTranslations = (keepKey?: string) => {
        translations.forEach((entry, key) => {
            if (key !== keepKey && !entry.settled) {
                entry.controller.abort();
                translations.delete(key);
            }
        });
    };
    const dialog = new Dialog({
        title: lang.aiMemorySummary,
        width: isMobile() ? "94vw" : "860px",
        content: `<div class="b3-dialog__content memory-manager">
<div class="memory-manager__hint" data-memory-translation-status role="status" aria-live="polite" aria-label="${escapeHtml(lang.loading)}" hidden><span class="b3-loading b3-loading--small" aria-hidden="true"></span></div>
<div class="memory-manager__content b3-typography" data-memory-overview aria-label="${escapeHtml(lang.aiMemoryOverview)}"></div>
<input type="text" class="b3-text-field fn__block" data-memory-task-input aria-label="${escapeHtml(lang.aiMemoryOrganize)}" placeholder="${escapeHtml(lang.aiMemoryTaskInputTip)}">
<div class="memory-manager__actions"><button type="button" class="b3-button" data-memory-action="maintain"><span class="b3-loading b3-loading--small" data-memory-loading aria-hidden="true" hidden></span>${escapeHtml(lang.aiMemoryOrganize)}</button></div>
</div>`,
        beforeClose: () => {
            if (submitting) { return false; }
            if (!taskDirty) { return true; }
            confirmDialog(lang.aiMemory, lang.discardUnsavedChanges, () => { taskDirty = false; dialog.destroy(); });
            return false;
        },
        destroyCallback: () => {
            closed = true;
            taskGeneration++;
            overviewGeneration++;
            window.clearTimeout(taskTimer);
            window.clearTimeout(overviewTimer);
            abortTranslations();
            translations.clear();
        },
    });
    const root = dialog.element;
    const input = root.querySelector<HTMLInputElement>("[data-memory-task-input]");
    const maintain = root.querySelector<HTMLButtonElement>('[data-memory-action="maintain"]');
    const overview = root.querySelector<HTMLElement>("[data-memory-overview]");
    const translationStatus = root.querySelector<HTMLElement>("[data-memory-translation-status]");
    const reportedErrors = new Set<string>();
    const reportError = (error: unknown, channel = "task") => {
        const message = String(error);
        if (!closed && message && !reportedErrors.has(channel)) {
            reportedErrors.add(channel);
            showMessage(escapeHtml(message), 5000, "error");
        }
    };
    const retryDelay = (attempt: number) => Math.min(30000, 1000 * 2 ** Math.min(attempt, 5));
    const updateModel = () => {
        const ai = window.siyuan.config.ai;
        const id = ai?.memory?.modelId || "";
        const ready = !!id && memoryModelOptions(ai?.providers || [], id).some(model => model.id === id && !model.unavailable);
        maintain.title = ready ? "" : `${lang.aiSelectModel} (${lang.config} - ${lang.ai} - ${lang.aiMemory})`;
        if (!ready) { reportError(maintain.title, "model"); }
        maintain.disabled = isReadOnly() || !ready || submitting || running || discovering;
        maintain.setAttribute("aria-busy", String(submitting || running));
        root.querySelector<HTMLElement>("[data-memory-loading]").hidden = !submitting && !running;
        input.disabled = isReadOnly() || submitting;
        return ready;
    };
    const translateOverview = async (memory: string, generation: number) => {
        const config = window.siyuan.config;
        const language = config.lang;
        const modelId = config.ai?.memory?.modelId;
        const reasoningEffort = config.ai?.memory?.reasoningEffort;
        const providers = config.ai?.providers;
        if (translationProviders !== providers) {
            abortTranslations();
            translations.clear();
            translationProviders = providers;
        }
        if (!memory.trim() || !language || isReadOnly() || !config.ai?.memory?.enabled ||
            !memoryModelOptions(config.ai?.providers || [], modelId || "").some(model => model.id === modelId && !model.unavailable)) {
            abortTranslations();
            translationStatus.hidden = true;
            renderMemoryOverview(overview, memory);
            return;
        }
        const key = JSON.stringify([memory, language, modelId, reasoningEffort]);
        abortTranslations(key);
        translationStatus.hidden = false;
        // 同一次打开期间保留成功和失败结果，概览重查不重复发起付费翻译。
        if (!translations.has(key)) {
            if (translations.size >= 32) {
                const oldest = translations.keys().next().value;
                translations.get(oldest).controller.abort();
                translations.delete(oldest);
            }
            const controller = new AbortController();
            const entry: Translation = {controller, settled: false, promise: undefined};
            entry.promise = (async () => {
                try {
                    const response = await fetchSyncPost("/api/ai/memory/translate", {memory, language}, undefined, false, controller.signal);
                    if (response.code !== 0) { throw new Error(response.msg); }
                    if (response.data.language !== language || typeof response.data.memory !== "string") { throw new Error(lang.embeddingFailed); }
                    return {memory: response.data.memory};
                } catch (error) { return {error}; }
            })().finally(() => { entry.settled = true; });
            translations.set(key, entry);
        }
        const entry = translations.get(key);
        const result = await entry.promise;
        if (closed || generation !== overviewGeneration || overviewSource !== memory) { return; }
        translationStatus.hidden = true;
        if (window.siyuan.config.lang !== language || window.siyuan.config.ai?.providers !== providers ||
            window.siyuan.config.ai?.memory?.reasoningEffort !== reasoningEffort ||
            window.siyuan.config.ai?.memory?.modelId !== modelId) {
            renderMemoryOverview(overview, memory);
            return;
        }
        if (result.error) {
            if (!entry.controller.signal.aborted) {
                renderMemoryOverview(overview, memory);
                reportError(result.error, "translation");
            }
            return;
        }
        if (!isReadOnly() && window.siyuan.config.ai?.memory?.enabled && window.siyuan.config.ai.memory.modelId === modelId &&
            memoryModelOptions(window.siyuan.config.ai.providers || [], modelId).some(model => model.id === modelId && !model.unavailable)) {
            renderMemoryOverview(overview, result.memory);
        } else {
            renderMemoryOverview(overview, memory);
        }
    };
    const refreshOverview = async () => {
        window.clearTimeout(overviewTimer);
        const generation = ++overviewGeneration;
        overview.textContent = "";
        translationStatus.hidden = false;
        try {
            const response = await fetchSyncPost("/api/ai/memory/overview", {}, undefined, false);
            if (closed || generation !== overviewGeneration) { return; }
            if (response.code !== 0) { throw new Error(response.msg); }
            overviewFailures = 0;
            // 过期概览不能继续显示为当前事实，等待后台重新生成后再展示。
            overviewSource = response.data.stale ? "" : response.data.memory;
            if (response.data.stale) {
                overview.textContent = "";
                translationStatus.hidden = true;
                abortTranslations();
            }
            else {
                void translateOverview(overviewSource, generation);
            }
            if (response.data.stale) {
                overviewTimer = window.setTimeout(() => { void refreshOverview(); }, 30000);
            }
        } catch (error) {
            if (closed || generation !== overviewGeneration) { return; }
            reportError(error, "overview");
            overview.textContent = "";
            translationStatus.hidden = true;
            overviewSource = "";
            abortTranslations();
            overviewTimer = window.setTimeout(() => { void refreshOverview(); }, retryDelay(++overviewFailures));
        }
    };
    const clearTask = () => {
        if (activeMemoryTask === taskId) { activeMemoryTask = ""; }
        taskId = "";
        running = false;
        updateModel();
    };
    const poll = async () => {
        if (closed || !taskId) { return; }
        const generation = ++taskGeneration;
        try {
            const response = await fetchSyncPost("/api/ai/memory/task", {taskId}, undefined, false);
            if (closed || generation !== taskGeneration) { return; }
            if (response.code !== 0) {
                if (response.msg === "memory task unavailable; retry explicitly") {
                    reportError(response.msg, "result");
                    clearTask();
                    void refreshOverview();
                    return;
                }
                throw new Error(response.msg);
            }
            taskFailures = 0;
            const task = response.data;
            running = ["queued", "running"].includes(task.state);
            updateModel();
            if (task.state === "failed" || (!running && (task.error || task.results?.some(result => !!result.error)))) {
                reportError(memoryTaskErrorMessage(task, {
                    target: lang.aiMemoryTargetUnclear, changed: lang.aiMemoryContentChanged,
                    partial: lang.aiMemoryPartialFailure, intent: lang.aiMemoryIntentUnclear,
                    limit: lang.aiMemoryProcessingLimit, read: lang.aiMemoryReadFailed,
                    generic: lang.embeddingFailed, model: lang._kernel,
                }), "result");
            }
            if (running) {
                taskTimer = window.setTimeout(() => { void poll(); }, 1000);
            } else {
                if (task.state === "completed" && !task.error && !task.results?.some(result => !!result.error)) {
                    operation.committed();
                    if (submittedInput?.id === taskId && submittedInput.revision === inputRevision && submittedInput.text === input.value) {
                        input.value = "";
                        inputRevision++;
                        taskDirty = false;
                    }
                }
                submittedInput = undefined;
                clearTask();
                void refreshOverview();
            }
        } catch (error) {
            if (closed || generation !== taskGeneration) { return; }
            reportError(error);
            // 查询故障只重查同一任务，不能自动重新发起可能计费的整理请求。
            taskTimer = window.setTimeout(() => { void poll(); }, retryDelay(++taskFailures));
        }
    };
    const discoverTask = async () => {
        const generation = ++taskGeneration;
        try {
            const response = await fetchSyncPost("/api/ai/memory/list", {limit: 1}, undefined, false);
            if (closed || generation !== taskGeneration) { return; }
            if (response.code !== 0) { throw new Error(response.msg); }
            taskFailures = 0;
            discovering = false;
            const tasks = response.data.tasks || [];
            const task = tasks.find(item => ["queued", "running"].includes(item.state)) || tasks[0];
            if (task) {
                taskId = task.taskId;
                activeMemoryTask = taskId;
                running = true;
                void poll();
            }
            updateModel();
        } catch (error) {
            if (closed || generation !== taskGeneration) { return; }
            reportError(error);
            taskTimer = window.setTimeout(() => { void discoverTask(); }, retryDelay(++taskFailures));
        }
    };
    input.addEventListener("input", () => { inputRevision++; taskDirty = !!input.value.trim(); updateModel(); });
    input.addEventListener("focus", updateModel);
    input.addEventListener("keydown", event => {
        if (event.key !== "Enter" || event.isComposing || event.keyCode === 229 || event.repeat ||
            event.altKey || event.shiftKey || ((event.ctrlKey || event.metaKey) && !isOnlyMeta(event)) ||
            closed || input.disabled || maintain.disabled) { return; }
        event.preventDefault();
        event.stopPropagation();
        maintain.click();
    });
    maintain.addEventListener("click", () => {
        if (closed || isReadOnly() || submitting || running || discovering || !updateModel()) { return; }
        const text = input.value;
        if (!text.trim()) { return; }
        const operationId = operation.operationFor(text, genUUID);
        submittedInput = {id: operationId, text, revision: inputRevision};
        reportedErrors.clear();
        submitting = true;
        taskGeneration++;
        window.clearTimeout(taskTimer);
        updateModel();
        void (async () => {
            try {
                const response = await fetchSyncPost("/api/ai/memory/maintain", {text, operationId}, undefined, false);
                if (closed) { return; }
                if (response.code !== 0) {
                    // A rejected changed request has not started; the next explicit click needs a new identity.
                    if (response.msg === "memory task input changed; start a new task") { operation.committed(); }
                    reportError(response.msg);
                    return;
                }
                taskId = response.data.taskId;
                submittedInput.id = taskId;
                activeMemoryTask = taskId;
                running = true;
                taskFailures = 0;
                void poll();
            } catch (error) {
                if (closed) { return; }
                reportError(error);
                // 提交回包丢失时按提交身份查询，避免用户重复付费处理。
                taskId = operationId;
                activeMemoryTask = taskId;
                running = true;
                taskTimer = window.setTimeout(() => { void poll(); }, retryDelay(1));
            } finally {
                submitting = false;
                if (!closed) { updateModel(); }
            }
        })();
    });
    updateModel();
    void refreshOverview();
    if (taskId) {
        discovering = false;
        running = true;
        updateModel();
        void poll();
    } else {
        void discoverTask();
    }
};
