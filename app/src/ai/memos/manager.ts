import {renderMemoryOverview} from "./overview";
import {showMessage} from "../../dialog/message";
import {Dialog} from "../../dialog";
import {confirmDialog} from "../../dialog/confirmDialog";
import {fetchSyncPost} from "../../util/fetch";
import {escapeHtmlTextAndAttr as escapeHtml} from "../../util/escape";
import {genUUID} from "../../util/genID";
import {isMobile} from "../../util/functions";
import type {AIMemoryTaskData} from "../../types/api";
import {MemoryOperationState, memoryModelOptions} from "./state";

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
    let submittedInput: {id: string; text: string};
    let lastTask: AIMemoryTaskData;
    let taskSummaryReady = false;
    let count: number;
    let taskGeneration = 0;
    let overviewGeneration = 0;
    let taskFailures = 0;
    let overviewFailures = 0;
    let taskTimer: number;
    let overviewTimer: number;
    const dialog = new Dialog({
        title: lang.aiMemory,
        width: isMobile() ? "94vw" : "860px",
        content: `<div class="b3-dialog__content memory-manager">
<p class="memory-manager__hint">${escapeHtml(lang.aiMemoryTip)}</p>
<textarea class="b3-text-field fn__block" data-memory-task-input rows="4" aria-label="${escapeHtml(lang.aiMemoryOrganize)}" placeholder="${escapeHtml(lang.aiMemoryTaskInputTip)}"></textarea>
<p class="memory-manager__hint" data-memory-model-hint role="status" hidden></p>
<div class="memory-manager__actions"><button type="button" class="b3-button" data-memory-action="maintain"><span class="b3-loading b3-loading--small" data-memory-loading aria-hidden="true" hidden></span>${escapeHtml(lang.aiMemoryOrganize)}</button></div>
<pre class="memory-manager__status" data-memory-task-status role="status" aria-live="polite"></pre>
<p class="memory-manager__hint" data-memory-count role="status" aria-live="polite"></p>
<p class="memory-manager__hint" data-memory-overview-status role="status"></p>
<div class="memory-manager__content b3-typography" data-memory-overview aria-label="${escapeHtml(lang.aiMemoryOverview)}"></div>
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
        },
    });
    const root = dialog.element;
    const input = root.querySelector<HTMLTextAreaElement>("[data-memory-task-input]");
    const maintain = root.querySelector<HTMLButtonElement>('[data-memory-action="maintain"]');
    const taskStatus = root.querySelector<HTMLElement>("[data-memory-task-status]");
    const countStatus = root.querySelector<HTMLElement>("[data-memory-count]");
    const overviewStatus = root.querySelector<HTMLElement>("[data-memory-overview-status]");
    const overview = root.querySelector<HTMLElement>("[data-memory-overview]");
    const taskLabels: Record<string, string> = {queued: lang.agentConfirmPending, running: lang.loading,
        completed: lang.taskStatusDone, failed: lang.embeddingFailed, cancelled: lang.cancel};
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
        const hint = root.querySelector<HTMLElement>("[data-memory-model-hint]");
        hint.hidden = ready;
        hint.textContent = ready ? "" : `${lang.aiSelectModel} (${lang.config} - ${lang.ai} - ${lang.aiMemory})`;
        maintain.disabled = isReadOnly() || !ready || submitting || running || discovering;
        root.querySelector<HTMLElement>("[data-memory-loading]").hidden = !submitting && !running;
        input.disabled = isReadOnly() || submitting;
        return ready;
    };
    const renderTask = () => {
        if (!lastTask) { return; }
        taskStatus.textContent = [taskLabels[lastTask.state] || lastTask.state, lastTask.error,
            lastTask.state === "completed" && taskSummaryReady && count === 0 ? lang.aiMemoryTaskNoNewUsable : ""].filter(Boolean).join("\n");
    };
    const refreshOverview = async () => {
        window.clearTimeout(overviewTimer);
        const generation = ++overviewGeneration;
        try {
            const response = await fetchSyncPost("/api/ai/memory/overview", {}, undefined, false);
            if (closed || generation !== overviewGeneration) { return; }
            if (response.code !== 0) { throw new Error(response.msg); }
            overviewFailures = 0;
            count = response.data.countComplete ? response.data.count : undefined;
            countStatus.textContent = count === undefined ? lang.aiMemoryCountUnavailable :
                lang.aiMemoryRememberedCount.replace("${count}", String(count));
            overviewStatus.textContent = response.data.stale ? lang.aiMemoryOverviewPending : "";
            // 过期概览不能继续显示为当前事实，等待后台重新生成后再展示。
            if (response.data.stale) { overview.textContent = ""; }
            else { renderMemoryOverview(overview, response.data.memory); }
            taskSummaryReady = true;
            if (lastTask?.state === "completed") { renderTask(); }
            if (!response.data.countComplete || response.data.stale) {
                overviewTimer = window.setTimeout(() => { void refreshOverview(); }, 30000);
            }
        } catch (error) {
            if (closed || generation !== overviewGeneration) { return; }
            count = undefined;
            countStatus.textContent = lang.aiMemoryCountUnavailable;
            overviewStatus.textContent = lang.embeddingFailed;
            reportError(error, "overview");
            overview.textContent = "";
            if (lastTask?.state === "completed") { renderTask(); }
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
                    taskStatus.textContent = response.msg;
                    reportError(response.msg);
                    lastTask = undefined;
                    clearTask();
                    void refreshOverview();
                    return;
                }
                throw new Error(response.msg);
            }
            taskFailures = 0;
            lastTask = response.data;
            running = ["queued", "running"].includes(lastTask.state);
            if (!running) { taskSummaryReady = false; }
            updateModel();
            renderTask();
            if (lastTask.state === "failed") { reportError(lastTask.error || lang.embeddingFailed, "result"); }
            if (running) {
                taskTimer = window.setTimeout(() => { void poll(); }, 1000);
            } else {
                if (lastTask.state === "completed") {
                    operation.committed();
                    if (submittedInput?.id === taskId && submittedInput.text === input.value) { taskDirty = false; }
                }
                clearTask();
                void refreshOverview();
            }
        } catch (error) {
            if (closed || generation !== taskGeneration) { return; }
            taskStatus.textContent = String(error);
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
            } else {
                taskStatus.textContent = "";
            }
            updateModel();
        } catch (error) {
            if (closed || generation !== taskGeneration) { return; }
            taskStatus.textContent = String(error);
            reportError(error);
            taskTimer = window.setTimeout(() => { void discoverTask(); }, retryDelay(++taskFailures));
        }
    };
    input.addEventListener("input", () => { taskDirty = !!input.value.trim(); updateModel(); });
    input.addEventListener("focus", updateModel);
    maintain.addEventListener("click", () => {
        if (closed || isReadOnly() || submitting || running || discovering || !updateModel()) { return; }
        const text = input.value;
        if (!text.trim()) { taskStatus.textContent = lang.aiMemoryTaskInputTip; return; }
        const operationId = operation.operationFor(text, genUUID);
        reportedErrors.clear();
        submitting = true;
        taskGeneration++;
        window.clearTimeout(taskTimer);
        lastTask = undefined;
        taskSummaryReady = false;
        taskStatus.textContent = lang.loading;
        updateModel();
        void (async () => {
            try {
                const response = await fetchSyncPost("/api/ai/memory/maintain", {text, operationId}, undefined, false);
                if (closed) { return; }
                if (response.code !== 0) {
                    taskStatus.textContent = response.msg;
                    reportError(response.msg);
                    return;
                }
                taskId = response.data.taskId;
                submittedInput = {id: taskId, text};
                activeMemoryTask = taskId;
                running = true;
                taskFailures = 0;
                void poll();
            } catch (error) {
                if (closed) { return; }
                taskStatus.textContent = String(error);
                reportError(error);
                // 提交回包丢失时按提交身份查询，避免用户重复付费处理。
                taskId = operationId;
                submittedInput = {id: taskId, text};
                activeMemoryTask = taskId;
                running = true;
                taskTimer = window.setTimeout(() => { void poll(); }, retryDelay(1));
            } finally {
                submitting = false;
                if (!closed) { updateModel(); }
            }
        })();
    });
    countStatus.textContent = lang.loading;
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
