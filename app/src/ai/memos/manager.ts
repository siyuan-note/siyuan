import {Dialog} from "../../dialog";
import {confirmDialog} from "../../dialog/confirmDialog";
import {showMessage} from "../../dialog/message";
import {fetchSyncPost} from "../../util/fetch";
import {escapeHtmlTextAndAttr as escapeHtml} from "../../util/escape";
import {genUUID} from "../../util/genID";
import {isMobile} from "../../util/functions";
import type {AIMemoryRecord, AIMemoryTaskData} from "../../types/api";
import {MemoryEditorState} from "./state";

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
    let dirty = false;
    let listGeneration = 0;
    let taskId = activeMemoryTask;
    let taskGeneration = 0;
    let displayedTaskId = "";
    let pollTimer: number;
    const button = (action: string, title: string, primary = false) =>
        `<button type="button" class="b3-button ${primary ? "" : "b3-button--outline"}" data-memory-action="${action}">${escapeHtml(title)}</button>`;
    const optionLabels: Record<string, string> = {
        fact: lang.aiMemoryKindFact, preference: lang.aiMemoryKindPreference,
        background: lang.aiMemoryKindBackground, decision: lang.aiMemoryKindDecision,
        active: lang.aiMemoryStateActive, candidate: lang.aiMemoryStateCandidate,
        review: lang.aiMemoryStateReview, disabled: lang.aiMemoryStateDisabled,
        superseded: lang.aiMemoryStateSuperseded,
    };
    const select = (field: string, values: string[]) => `<select class="b3-select" aria-label="${escapeHtml(field === "kind" ? lang.aiMemoryKind : lang.aiMemoryState)}" data-memory-field="${field}">${values.map(value =>
        `<option value="${value}">${escapeHtml(optionLabels[value])}</option>`).join("")}</select>`;
    const dialog = new Dialog({
        title: lang.aiMemory,
        width: isMobile() ? "94vw" : "860px",
        content: `<div class="b3-dialog__content memory-manager">
<p class="memory-manager__hint">${escapeHtml(lang.aiMemoryTip)}</p>
<div class="memory-manager__actions"><input class="b3-text-field fn__flex-1" data-memory-query aria-label="${escapeHtml(lang.search)}" placeholder="${escapeHtml(lang.search)}">${button("search", lang.search)}</div>
<div class="memory-manager__actions">${button("new", lang.new, true)}${button("refresh", lang.refresh)}${button("overview", lang.aiMemoryOverview)}</div>
<p class="memory-manager__hint" data-memory-status role="status" aria-live="polite"></p>
<div class="memory-manager__empty" data-memory-empty hidden><strong data-memory-empty-title></strong><p class="memory-manager__hint" data-memory-empty-tip></p></div>
<div class="memory-manager__list" data-memory-list></div>
<div class="memory-manager__actions" data-memory-pagination hidden>${button("previous", lang.previous)}${button("next", lang.next)}</div>
<section class="memory-manager__editor" data-memory-editor hidden>
<h3 data-memory-editor-title>${lang.new}</h3>
<label class="memory-manager__field">${lang.text}<textarea class="b3-text-field fn__block" data-memory-field="content" rows="4" placeholder="${escapeHtml(lang.aiMemoryContentTip)}"></textarea></label>
<div class="memory-manager__fields"><label class="memory-manager__field">${lang.aiMemoryKind}${select("kind", ["fact", "preference", "background", "decision"])}</label><label class="memory-manager__field">${lang.aiMemoryState}${select("state", ["active", "candidate", "review", "disabled", "superseded"])}</label></div>
<details><summary>${lang.aiMemoryDetails}</summary>
<div class="memory-manager__fields"><label class="memory-manager__field">${lang.subject}<input class="b3-text-field" data-memory-field="subject" value="user"><span class="memory-manager__hint">${escapeHtml(lang.aiMemorySubjectTip)}</span></label>
<label class="memory-manager__field">${lang.aiMemoryScope}<input class="b3-text-field" data-memory-field="scope" value="workspace"><span class="memory-manager__hint">${escapeHtml(lang.aiMemoryScopeTip)}</span></label></div>
<pre class="memory-manager__evidence" data-memory-evidence></pre></details>
<div class="memory-manager__actions">${button("save", lang.save, true)}${button("disable", lang.disable)}${button("forget", lang.aiMemoryForget)}</div></section>
<details class="memory-manager__model" data-memory-model><summary>${lang.aiMemoryOrganize}</summary>
<label class="memory-manager__field">${lang.text}<span class="memory-manager__hint">${escapeHtml(lang.aiMemoryTaskInputTip)}</span><textarea class="b3-text-field fn__block" data-memory-task-input rows="4" placeholder="${escapeHtml(lang.aiMemoryTaskInputTip)}"></textarea></label>
<div class="memory-manager__actions">${button("maintain", lang.aiMemoryOrganize, true)}${button("cancel", lang.cancel)}${button("task", lang.refresh)}</div>
<label class="memory-manager__field" data-memory-task-history hidden>${lang.aiMemoryTaskHistory}<select class="b3-select fn__block" data-memory-task-choice></select></label>
<pre class="memory-manager__evidence" data-memory-task-status role="status" aria-live="polite"></pre></details>
</div>`,
        beforeClose: () => {
            if (busy) { return false; }
            if (!dirty) { return true; }
            confirmDialog(lang.aiMemory, lang.discardUnsavedChanges, () => { dirty = false; dialog.destroy(); });
            return false;
        },
        destroyCallback: () => {
            closed = true;
            state.nextRead();
            window.clearTimeout(pollTimer);
        },
    });
    const root = dialog.element;
    const field = (name: string) => root.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[data-memory-field="${name}"]`);
    const status = root.querySelector<HTMLElement>("[data-memory-status]");
    const taskStatus = root.querySelector<HTMLElement>("[data-memory-task-status]");
    const taskChoice = root.querySelector<HTMLSelectElement>("[data-memory-task-choice]");
    const action = (name: string) => root.querySelector<HTMLButtonElement>(`[data-memory-action="${name}"]`);
    const taskLabels: Record<string, string> = {queued: lang.agentConfirmPending, running: lang.loading,
            completed: lang.taskStatusDone, failed: lang.embeddingFailed, cancelled: lang.cancel};
    const renderTask = (task: AIMemoryTaskData) => {
        if (displayedTaskId !== task.taskId) {
            root.querySelector<HTMLDetailsElement>("[data-memory-model]").open = true;
            displayedTaskId = task.taskId;
        }
        taskStatus.textContent = [taskLabels[task.state] || task.state, task.error,
            ...(task.results || []).map(result => `${result.id}: ${result.saved ? lang.save : result.error}`),
            task.overviewPending ? lang.aiMemoryPending : ""].filter(Boolean).join("\n");
        const running = ["queued", "running"].includes(task.state);
        action("cancel").disabled = isReadOnly() || !running;
        action("maintain").disabled = isReadOnly() || running;
        action("task").disabled = false;
        return running;
    };
    const setBusy = (value: boolean) => {
        busy = value;
        root.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
            "[data-memory-editor] button, [data-memory-field], [data-memory-action=new]",
        ).forEach(element => { element.disabled = value || isReadOnly(); });
        action("disable").disabled = value || isReadOnly() || !selected;
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
        root.querySelector<HTMLElement>("[data-memory-editor]").hidden = false;
        root.querySelector("[data-memory-editor-title]").textContent = lang.edit;
        selected = response.data.record;
        revision = response.data.revision;
        for (const key of ["subject", "scope", "kind", "state", "content"] as const) {
            field(key).value = selected[key];
        }
        root.querySelector("[data-memory-evidence]").textContent = JSON.stringify({id: selected.id,
            created: selected.created, updated: selected.updated, confirmed: selected.confirmed,
            validFrom: selected.validFrom, validUntil: selected.validUntil, reason: selected.reason,
            supersedes: selected.supersedes, sources: selected.sources}, null, 2);
        state.committed();
        dirty = false;
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
            item.addEventListener("click", () => {
                if (dirty) {
                    confirmDialog(lang.aiMemory, lang.discardUnsavedChanges, () => { void read(record.id); });
                } else {
                    void read(record.id);
                }
            });
            container.append(item);
        }
        root.querySelector<HTMLElement>("[data-memory-empty]").hidden = records.length > 0;
        const searching = root.querySelector<HTMLInputElement>("[data-memory-query]").value.trim() !== "";
        root.querySelector("[data-memory-empty-title]").textContent = searching || offset > 0 ? lang.aiMemoryNoResults : lang.aiMemoryEmpty;
        root.querySelector("[data-memory-empty-tip]").textContent = searching || offset > 0 ? "" : lang.aiMemoryEmptyTip;
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
    const save = async (disable = false) => {
        if (busy || isReadOnly()) {
            return;
        }
        const draft = {id: selected?.id, revision, content: field("content").value,
            kind: field("kind").value, subject: field("subject").value, scope: field("scope").value,
            state: disable ? "disabled" : field("state").value};
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
                // 确认保存后立即采用新身份与修订，随后读取失败不能把重试变成重复新建。
                revision = response.data.revision;
                selected = {...draft, id: response.data.id, revision, sources: selected?.sources || [],
                    created: selected?.created || "", updated: "", confirmed: selected?.confirmed || "",
                    validFrom: selected?.validFrom || "", validUntil: selected?.validUntil || "",
                    reason: selected?.reason || "", supersedes: selected?.supersedes || ""};
                dirty = false;
                await read(response.data.id, true);
                await list();
                status.textContent = response.data.overviewPending ? lang.aiMemoryPending : lang.save;
            }
        } finally {
            setBusy(false);
        }
    };
    const reset = (keepBusy = false, showEditor = true) => {
        root.querySelector<HTMLElement>("[data-memory-editor]").hidden = !showEditor;
        root.querySelector("[data-memory-editor-title]").textContent = lang.new;
        state.nextRead();
        state.committed();
        dirty = false;
        selected = undefined;
        revision = "missing";
        field("subject").value = "user";
        field("scope").value = "workspace";
        field("kind").value = "fact";
        field("state").value = "active";
        field("content").value = "";
        root.querySelector("[data-memory-evidence]").textContent = "";
        setBusy(keepBusy);
    };
    const markDirty = () => { if (!busy) { dirty = true; state.nextRead(); } };
    root.querySelector("[data-memory-editor]").addEventListener("input", markDirty);
    root.querySelector("[data-memory-editor]").addEventListener("change", markDirty);
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
                case "new":
                    if (dirty) { confirmDialog(lang.aiMemory, lang.discardUnsavedChanges, () => reset()); } else { reset(); }
                    break;
                case "save": await save(); break;
                case "disable": await save(true); break;
                case "search": offset = 0; await list(); break;
                case "refresh": await list(); break;
                case "previous": offset = Math.max(0, offset - 50); await list(); break;
                case "next": offset += 50; await list(); break;
                case "overview": {
                    const response = await fetchSyncPost("/api/ai/memory/overview", {});
                    if (response.code !== 0) { showMessage(response.msg); break; }
                    new Dialog({title: lang.aiMemoryOverview, width: isMobile() ? "94vw" : "700px",
                        content: `<div class="b3-dialog__content"><p>${response.data.stale ? lang.aiMemoryPending : ""}</p><pre class="ft__breakword">${escapeHtml("USER.md\n" + response.data.user + "\n\nMEMORY.md\n" + response.data.memory)}</pre></div>`});
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
                                reset(true, false);
                                if (response.data.cleanupPending) { showMessage(lang.aiMemoryCleanupPending); }
                                await list();
                            }
                        } catch (error) { showMessage(String(error)); } finally { setBusy(false); }
                    });
                    break;
                }
                case "maintain": {
                    if (isReadOnly()) { break; }
                    const text = root.querySelector<HTMLTextAreaElement>("[data-memory-task-input]").value;
                    if (!text.trim()) { taskStatus.textContent = lang.aiMemoryTaskInputTip; return; }
                    const operationId = taskState.operationFor(`maintain:${text}`, genUUID);
                    action("maintain").disabled = true;
                    const response = await fetchSyncPost("/api/ai/memory/maintain", {text, operationId});
                    if (response.code !== 0) { taskStatus.textContent = response.msg; action("maintain").disabled = false; break; }
                    taskId = response.data.taskId;
                    activeMemoryTask = taskId;
                    action("task").disabled = false;
                    await poll();
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
            if (target.dataset.memoryAction === "maintain") { action("maintain").disabled = isReadOnly(); }
        });
    });
    reset(false, false);
    action("cancel").disabled = isReadOnly() || !taskId;
    action("maintain").disabled = isReadOnly();
    action("task").disabled = !taskId;
    void list().catch(error => { status.textContent = String(error); });
    if (taskId) { void poll().catch(error => { taskStatus.textContent = String(error); }); }
};
