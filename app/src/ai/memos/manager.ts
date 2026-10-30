import {Dialog} from "../../dialog";
import {confirmDialog} from "../../dialog/confirmDialog";
import {showMessage} from "../../dialog/message";
import {fetchSyncPost} from "../../util/fetch";
import {escapeHtmlTextAndAttr as escapeHtml} from "../../util/escape";
import {genUUID} from "../../util/genID";
import {isMobile} from "../../util/functions";
import type {AIMemoryRecord, AIMemoryTaskData} from "../../types/api";
import {MemoryEditorState, memoryModelOptions} from "./state";

// 当前页面重新打开管理器时仍可查询或取消已启动任务，不承诺重启后恢复。
let activeMemoryTask = "";

export const openMemoryManager = () => {
    const lang = window.siyuan.languages;
    const isReadOnly = () => window.siyuan.config?.readonly === true;
    const state = new MemoryEditorState();
    const taskState = new MemoryEditorState();
    let selected: AIMemoryRecord;
    let revision = "missing";
    let offset = 0;
    let closed = false;
    let busy = false;
    let taskDirty = false;
    let taskSubmitting = false;
    let taskRunning = false;
    let submittedInput: {id: string; text: string};
    let listGeneration = 0;
    let taskId = activeMemoryTask;
    let taskGeneration = 0;
    let pollTimer: number;
    const button = (action: string, title: string, primary = false) =>
        `<button type="button" class="b3-button ${primary ? "" : "b3-button--outline"}" data-memory-action="${action}">${escapeHtml(title)}</button>`;
    const summary = (title: string) => `<summary class="b3-list-item"><svg class="b3-list-item__arrow" aria-hidden="true"><use xlink:href="#iconRight"></use></svg><span class="fn__space"></span><span class="b3-list-item__text">${escapeHtml(title)}</span></summary>`;
    const optionLabels: Record<string, string> = {
        fact: lang.aiMemoryKindFact, preference: lang.aiMemoryKindPreference,
        background: lang.aiMemoryKindBackground, decision: lang.aiMemoryKindDecision,
        active: lang.aiMemoryStateActive, candidate: lang.aiMemoryStateCandidate,
        review: lang.aiMemoryStateReview, disabled: lang.aiMemoryStateDisabled,
        superseded: lang.aiMemoryStateSuperseded,
    };
    const dialog = new Dialog({
        title: lang.aiMemory,
        width: isMobile() ? "94vw" : "860px",
        content: `<div class="b3-dialog__content memory-manager">
<p class="memory-manager__hint">${escapeHtml(lang.aiMemoryTip)}</p>
<section class="memory-manager__model" data-memory-model>
<textarea class="b3-text-field fn__block" data-memory-task-input rows="4" aria-label="${escapeHtml(lang.aiMemoryOrganize)}" placeholder="${escapeHtml(lang.aiMemoryTaskInputTip)}"></textarea>
<p class="memory-manager__hint" data-memory-model-hint role="status" hidden></p>
<div class="memory-manager__actions">${button("maintain", lang.aiMemoryOrganize, true)}${button("cancel", lang.cancel)}${button("task", lang.refresh)}</div>
<label class="memory-manager__field" data-memory-task-history hidden>${lang.aiMemoryTaskHistory}<select class="b3-select fn__block" data-memory-task-choice></select></label>
<pre class="memory-manager__evidence" data-memory-task-status role="status" aria-live="polite"></pre></section>
<div class="memory-manager__actions"><input class="b3-text-field fn__flex-1" data-memory-query aria-label="${escapeHtml(lang.search)}" placeholder="${escapeHtml(lang.search)}">${button("search", lang.search)}</div>
<div class="memory-manager__actions">${button("refresh", lang.refresh)}${button("overview", lang.aiMemoryOverview)}</div>
<p class="memory-manager__hint" data-memory-status role="status" aria-live="polite"></p>
<div class="memory-manager__empty" data-memory-empty hidden><strong data-memory-empty-title></strong><p class="memory-manager__hint" data-memory-empty-tip></p></div>
<div class="memory-manager__list" data-memory-list></div>
<div class="memory-manager__actions" data-memory-pagination hidden>${button("previous", lang.previous)}${button("next", lang.next)}</div>
<section class="memory-manager__detail" data-memory-detail hidden>
<p class="memory-manager__hint" data-memory-record-status></p>
<pre class="memory-manager__content" data-memory-content></pre>
<details>${summary(lang.aiMemoryDetails)}
<pre class="memory-manager__evidence" data-memory-evidence></pre></details>
<div class="memory-manager__actions">${button("enable", lang.enable)}${button("disable", lang.disable)}${button("forget", lang.aiMemoryForget)}</div></section>
</div>`,
        beforeClose: () => {
            if (busy || taskSubmitting) { return false; }
            if (!taskDirty) { return true; }
            confirmDialog(lang.aiMemory, lang.discardUnsavedChanges, () => { taskDirty = false; dialog.destroy(); });
            return false;
        },
        destroyCallback: () => {
            closed = true;
            state.nextRead();
            taskGeneration++;
            window.clearTimeout(pollTimer);
        },
    });
    const root = dialog.element;
    const taskInput = root.querySelector<HTMLTextAreaElement>("[data-memory-task-input]");
    const status = root.querySelector<HTMLElement>("[data-memory-status]");
    const taskStatus = root.querySelector<HTMLElement>("[data-memory-task-status]");
    const taskChoice = root.querySelector<HTMLSelectElement>("[data-memory-task-choice]");
    const action = (name: string) => root.querySelector<HTMLButtonElement>(`[data-memory-action="${name}"]`);
    const taskLabels: Record<string, string> = {queued: lang.agentConfirmPending, running: lang.loading,
            completed: lang.taskStatusDone, failed: lang.embeddingFailed, cancelled: lang.cancel};
    const updateModel = () => {
        const ai = window.siyuan.config.ai;
        const id = ai?.memory?.modelId || "";
        const ready = !!id && memoryModelOptions(ai?.providers || [], id).some(option => option.id === id && !option.unavailable);
        const hint = root.querySelector<HTMLElement>("[data-memory-model-hint]");
        hint.hidden = ready;
        hint.textContent = ready ? "" : `${lang.aiSelectModel} (${lang.config} - ${lang.ai} - ${lang.aiMemory})`;
        action("maintain").disabled = isReadOnly() || !ready || taskSubmitting || taskRunning;
        taskInput.disabled = isReadOnly() || taskSubmitting;
        return ready;
    };
    const renderTask = (task: AIMemoryTaskData) => {
        if (task.state === "completed" && submittedInput?.id === task.taskId && submittedInput.text === taskInput.value) {
            taskDirty = false;
        }
        const results = task.results || [];
        const saved = results.filter(result => result.saved).length;
        const outcome = saved > 0 ? lang.aiMemoryTaskSavedCount.replace("${count}", String(saved)) :
            task.state === "completed" && results.length === 0 ? lang.aiMemoryTaskNoChanges :
                ["failed", "cancelled"].includes(task.state) ? lang.aiMemoryTaskNotSaved : "";
        taskStatus.textContent = [taskLabels[task.state] || task.state, task.error, outcome,
            ...results.map(result => `${result.id}: ${result.saved ? lang.aiMemoryTaskSaved : result.error}`),
            saved > 0 && task.overviewPending ? lang.aiMemoryOverviewPending : ""].filter(Boolean).join("\n");
        taskRunning = ["queued", "running"].includes(task.state);
        action("cancel").disabled = isReadOnly() || !taskRunning;
        updateModel();
        action("task").disabled = false;
        return taskRunning;
    };
    const setBusy = (value: boolean) => {
        busy = value;
        action("enable").hidden = !selected || !["candidate", "review", "disabled"].includes(selected.state);
        action("enable").disabled = value || isReadOnly() || !selected;
        action("disable").disabled = value || isReadOnly() || !selected;
        action("disable").hidden = !selected || selected.state === "disabled" || selected.state === "superseded";
        action("forget").disabled = value || isReadOnly() || !selected;
    };
    const read = async (id: string, mutationRefresh = false) => {
        if (busy && !mutationRefresh) {
            return;
        }
        const generation = state.nextRead();
        const response = await fetchSyncPost("/api/ai/memory/get", {id}).catch((error): null => {
            showMessage(String(error));
            return null;
        });
        if (!response || closed || !state.accepts(generation) || (busy && !mutationRefresh)) {
            return;
        }
        if (response.code !== 0) {
            showMessage(response.msg);
            return;
        }
        root.querySelector<HTMLElement>("[data-memory-detail]").hidden = false;
        selected = response.data.record;
        revision = response.data.revision;
        root.querySelector("[data-memory-content]").textContent = selected.content;
        root.querySelector("[data-memory-record-status]").textContent = `${optionLabels[selected.state] || selected.state} · ${optionLabels[selected.kind] || selected.kind}`;
        root.querySelector("[data-memory-evidence]").textContent = JSON.stringify({id: selected.id,
            subject: selected.subject, scope: selected.scope,
            created: selected.created, updated: selected.updated, confirmed: selected.confirmed,
            validFrom: selected.validFrom, validUntil: selected.validUntil, reason: selected.reason,
            supersedes: selected.supersedes, sources: selected.sources}, null, 2);
        state.committed();
        setBusy(busy);
    };
    const list = async () => {
        const generation = ++listGeneration;
        const response = await fetchSyncPost("/api/ai/memory/list", {
            query: root.querySelector<HTMLInputElement>("[data-memory-query]").value, offset, limit: 50,
        });
        if (closed || generation !== listGeneration) {
            return;
        }
        if (response.code !== 0) {
            status.textContent = response.msg;
            return;
        }
        const records = response.data.records || [];
        const container = root.querySelector("[data-memory-list]");
        container.replaceChildren();
        for (const record of records) {
            const item = document.createElement("button");
            item.type = "button";
            item.className = "b3-list-item memory-manager__record";
            item.textContent = `[${optionLabels[record.state] || record.state}] ${record.content.slice(0, 160)}`;
            item.addEventListener("click", () => { void read(record.id); });
            container.append(item);
        }
        root.querySelector<HTMLElement>("[data-memory-empty]").hidden = records.length > 0;
        const searching = root.querySelector<HTMLInputElement>("[data-memory-query]").value.trim() !== "";
        root.querySelector("[data-memory-empty-title]").textContent = searching || offset > 0 ? lang.aiMemoryNoResults : lang.aiMemoryEmpty;
        root.querySelector("[data-memory-empty-tip]").textContent = searching || offset > 0 ? "" : lang.aiMemoryTaskInputTip;
        root.querySelector<HTMLElement>("[data-memory-pagination]").hidden = offset === 0 && records.length < 50;
        status.textContent = [response.data.incomplete ? lang.aiMemoryIncomplete : (records.length ? `${offset + 1}–${offset + records.length}` : ""),
            ...(response.data.errors || [])].join("\n");
        action("previous").disabled = offset === 0;
        action("next").disabled = records.length < 50;
        const tasks = response.data.tasks || [];
        taskChoice.replaceChildren();
        for (const task of tasks) {
            const option = document.createElement("option");
            option.value = task.taskId;
            option.textContent = `${taskLabels[task.state] || task.state}: ${task.taskId}`;
            taskChoice.append(option);
        }
        if (!taskId && tasks.length) {
            taskId = tasks[0].taskId;
            activeMemoryTask = taskId;
            if (renderTask(tasks[0])) {
                pollTimer = window.setTimeout(() => { void poll().catch(error => { taskStatus.textContent = String(error); }); }, 1000);
            }
        }
        if (taskId && !tasks.some(task => task.taskId === taskId)) {
            const option = document.createElement("option");
            option.value = taskId;
            option.textContent = taskId;
            taskChoice.append(option);
        }
        taskChoice.value = taskId;
        taskChoice.disabled = !taskId;
        root.querySelector<HTMLElement>("[data-memory-task-history]").hidden = !taskId;
    };
    const setRecordState = async (nextState: "active" | "disabled") => {
        if (!selected || busy || isReadOnly() || closed) {
            return;
        }
        const draft = {id: selected.id, revision, content: selected.content,
            kind: selected.kind, subject: selected.subject, scope: selected.scope, state: nextState};
        const operationId = state.operationFor(JSON.stringify(draft), genUUID);
        state.nextRead();
        setBusy(true);
        try {
            const response = await fetchSyncPost("/api/ai/memory/save", {...draft, operationId});
            if (response.code !== 0) {
                showMessage(response.msg);
                return;
            }
            if (response.data.saved) {
                state.committed();
                revision = response.data.revision;
                selected = {...selected, state: nextState, revision};
                root.querySelector("[data-memory-record-status]").textContent = `${optionLabels[selected.state]} · ${optionLabels[selected.kind] || selected.kind}`;
                await read(response.data.id, true);
                await list();
                status.textContent = response.data.overviewPending ? lang.aiMemoryPending : lang.save;
            }
        } finally {
            setBusy(false);
        }
    };
    const reset = (keepBusy = false) => {
        root.querySelector<HTMLElement>("[data-memory-detail]").hidden = true;
        state.nextRead();
        state.committed();
        selected = undefined;
        revision = "missing";
        root.querySelector("[data-memory-content]").textContent = "";
        root.querySelector("[data-memory-evidence]").textContent = "";
        setBusy(keepBusy);
    };
    taskInput.addEventListener("input", () => { taskDirty = !!taskInput.value.trim(); updateModel(); });
    taskInput.addEventListener("focus", updateModel);
    const poll = async () => {
        if (!taskId || closed) {
            return;
        }
        const generation = ++taskGeneration;
        const response = await fetchSyncPost("/api/ai/memory/task", {taskId});
        if (closed || generation !== taskGeneration) {
            return;
        }
        if (response.code !== 0) {
            taskStatus.textContent = response.msg;
            if (response.msg === "memory task unavailable; retry explicitly") {
                if (activeMemoryTask === taskId) { activeMemoryTask = ""; }
                taskId = "";
                taskRunning = false;
                taskChoice.value = "";
                taskChoice.disabled = true;
                root.querySelector<HTMLElement>("[data-memory-task-history]").hidden = true;
                action("cancel").disabled = true;
                action("task").disabled = true;
                updateModel();
            }
            return;
        }
        const running = renderTask(response.data);
        if (running) {
            pollTimer = window.setTimeout(() => {
                void poll().catch(error => { taskStatus.textContent = String(error); });
            }, 1000);
        } else {
            if (response.data.state === "completed") { taskState.committed(); }
            await list();
        }
    };
    root.querySelector("[data-memory-query]").addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.key === "Enter") { offset = 0; void list().catch(error => { status.textContent = String(error); }); }
    });
    taskChoice.addEventListener("change", () => {
        if (taskSubmitting) { return; }
        taskId = taskChoice.value;
        activeMemoryTask = taskId;
        window.clearTimeout(pollTimer);
        void poll().catch(error => { taskStatus.textContent = String(error); });
    });
    root.addEventListener("click", event => {
        const target = (event.target as Element).closest<HTMLElement>("[data-memory-action]");
        if (!target) {
            return;
        }
        const run = async () => {
            switch (target.dataset.memoryAction) {
                case "enable": {
                    if (!selected || busy || isReadOnly() || !["candidate", "review", "disabled"].includes(selected.state)) { break; }
                    const id = selected.id;
                    const expected = revision;
                    confirmDialog(lang.enable, escapeHtml(selected.content), () => {
                        if (selected?.id === id && revision === expected) { void setRecordState("active").catch(error => showMessage(String(error))); }
                    });
                    break;
                }
                case "disable": await setRecordState("disabled"); break;
                case "search": offset = 0; await list(); break;
                case "refresh": updateModel(); await list(); break;
                case "previous": offset = Math.max(0, offset - 50); await list(); break;
                case "next": offset += 50; await list(); break;
                case "overview": {
                    const response = await fetchSyncPost("/api/ai/memory/overview", {});
                    if (response.code !== 0) { showMessage(response.msg); break; }
                    new Dialog({title: lang.aiMemoryOverview, width: isMobile() ? "94vw" : "700px",
                        content: `<div class="b3-dialog__content"><p>${response.data.stale ? lang.aiMemoryOverviewPending : ""}</p><pre class="ft__breakword">${escapeHtml("USER.md\n" + response.data.user + "\n\nMEMORY.md\n" + response.data.memory)}</pre></div>`});
                    break;
                }
                case "forget": {
                    if (!selected || busy || isReadOnly()) { break; }
                    const id = selected.id;
                    const expected = revision;
                    confirmDialog(lang.aiMemoryForget, lang.aiMemoryForgetTip, async () => {
                        if (busy || closed || isReadOnly() || selected?.id !== id || revision !== expected) { return; }
                        state.nextRead();
                        setBusy(true);
                        try {
                            const operationId = state.operationFor(`forget:${id}:${expected}`, genUUID);
                            const response = await fetchSyncPost("/api/ai/memory/forget", {id, revision: expected, operationId});
                            if (response.code !== 0) { showMessage(response.msg); return; }
                            if (response.data.saved) {
                                reset(true);
                                if (response.data.cleanupPending) { showMessage(lang.aiMemoryCleanupPending); }
                                await list();
                            }
                        } catch (error) { showMessage(String(error)); } finally { setBusy(false); }
                    });
                    break;
                }
                case "maintain": {
                    if (isReadOnly() || taskSubmitting || taskRunning || !updateModel()) { break; }
                    const text = taskInput.value;
                    if (!text.trim()) { taskStatus.textContent = lang.aiMemoryTaskInputTip; return; }
                    const operationId = taskState.operationFor(`maintain:${text}`, genUUID);
                    taskSubmitting = true;
                    taskGeneration++;
                    window.clearTimeout(pollTimer);
                    taskChoice.disabled = true;
                    updateModel();
                    try {
                        const response = await fetchSyncPost("/api/ai/memory/maintain", {text, operationId});
                        if (closed) { break; }
                        if (response.code !== 0) { taskStatus.textContent = response.msg; break; }
                        taskId = response.data.taskId;
                        submittedInput = {id: taskId, text};
                        activeMemoryTask = taskId;
                        taskRunning = true;
                        action("task").disabled = false;
                        await poll();
                    } finally {
                        taskSubmitting = false;
                        taskChoice.disabled = !taskId;
                        updateModel();
                    }
                    break;
                }
                case "task": window.clearTimeout(pollTimer); await poll(); break;
                case "cancel":
                    if (!isReadOnly()) { await fetchSyncPost("/api/ai/memory/cancel", {taskId}); window.clearTimeout(pollTimer); await poll(); }
                    break;
            }
        };
        void run().catch(error => {
            showMessage(String(error));
            if (target.dataset.memoryAction === "maintain") { updateModel(); }
        });
    });
    reset();
    action("cancel").disabled = isReadOnly() || !taskId;
    updateModel();
    action("task").disabled = !taskId;
    void list().catch(error => { status.textContent = String(error); });
    if (taskId) { void poll().catch(error => { taskStatus.textContent = String(error); }); }
};
