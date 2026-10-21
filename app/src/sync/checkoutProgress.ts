import {escapeHtml} from "../util/escape";
import {fetchSyncPost} from "../util/fetch";
import {Constants} from "../constants";
import {getAllEditor} from "../layout/getAll";
import {reloadProtyleAndWait} from "../protyle/util/reload";
import {waitForSyncReloads} from "../util/reloadSync";
import {flushPendingEditorSaves, getEditorSaveFailureVersion} from "../protyle/util/editorSave";
import type {SyncCheckoutState} from "../types/api";
import {getProgressContentHTML, updateProgressContent} from "../dialog/progress";

type CheckoutState = SyncCheckoutState & {compact: boolean; expanded: boolean};
let state: CheckoutState | undefined;
let previousFocus: HTMLElement | undefined;
let revision = 0;
let connection: {appID: string; clientID: string};
let preparation: string;
let unsavedPreparation = false;
let refreshing: string;
let refreshTail = Promise.resolve();
let statePoll: number;
let kernelID: string;

const blockEditing = (event: Event) => {
    const root = document.getElementById("sync-checkout-progress");
    if (!root || !state?.blocking) return;
    if (event.type === "keydown" && (event as KeyboardEvent).key === "Tab") {
        const controls = Array.from(root.querySelectorAll<HTMLButtonElement>("button")).filter(button => !button.disabled);
        const index = controls.indexOf(document.activeElement as HTMLButtonElement);
        const backwards = (event as KeyboardEvent).shiftKey;
        const next = index < 0 ? (backwards ? controls.length - 1 : 0) :
            backwards ? (index - 1 + controls.length) % controls.length : (index + 1) % controls.length;
        controls[next]?.focus();
    } else if (root.contains(event.target as Node)) {
        return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
};

const setEditingGuard = (enabled: boolean) => {
    ["keydown", "beforeinput", "paste", "drop"].forEach(name => {
        if (enabled) document.addEventListener(name, blockEditing, true);
        else document.removeEventListener(name, blockEditing, true);
    });
};

const clear = () => {
    state = undefined;
    preparation = undefined;
    unsavedPreparation = false;
    refreshing = undefined;
    window.clearInterval(statePoll);
    statePoll = undefined;
    document.getElementById("sync-checkout-progress")?.remove();
    setEditingGuard(false);
    if (previousFocus?.isConnected) previousFocus.focus();
    previousFocus = undefined;
};

const render = () => {
    if (!state) return;
    if (!state.blocking && !state.expanded) {
        document.getElementById("sync-checkout-progress")?.remove();
        setEditingGuard(false);
        return;
    }
    let root = document.getElementById("sync-checkout-progress");
    if (!root) {
        root = document.createElement("div");
        root.id = "sync-checkout-progress";
        root.className = "sync-checkout";
        root.style.zIndex = String(++window.siyuan.zIndex);
        document.body.appendChild(root);
        root.innerHTML = `<div class="b3-dialog__scrim sync-checkout__scrim"></div>
<div class="sync-checkout__panel b3-dialog__loading" role="dialog" aria-label="${escapeHtml(window.siyuan.languages.sync)}">
    <div class="sync-checkout__details">${getProgressContentHTML()}</div>
    <div class="sync-checkout__notice ft__smaller">${escapeHtml(window.siyuan.languages._kernel[436])}</div>
    <div class="fn__flex sync-checkout__actions">
        <button class="b3-button b3-button--cancel b3-button--wrap" data-action="toggle"><span></span></button>
        <button class="b3-button b3-button--cancel b3-button--wrap" data-action="cancel">${escapeHtml(window.siyuan.languages.cancel)}</button>
    </div>
</div>`;
        root.querySelector('[data-action="toggle"]').addEventListener("click", () => {
            if (!state.blocking) state.expanded = false;
            else state.compact = !state.compact;
            render();
        });
        root.querySelector('[data-action="cancel"]').addEventListener("click", () => {
            if (state.canceling) return;
            const taskID = state.taskID;
            state.canceling = true;
            render();
            void fetchSyncPost("/api/sync/cancelSyncCheckout", {taskID}).then(response => {
                if (state?.taskID !== taskID) return;
                if (response.code !== 0) {
                    state.canceling = false;
                    render();
                } else if (!response.data.requested) {
                    void reconcileSyncCheckout();
                }
            }).catch(() => {
                if (state?.taskID === taskID) {
                    state.canceling = false;
                    render();
                }
            });
        });
    }
    setEditingGuard(state.blocking);
    if (state.blocking && !statePoll) {
        statePoll = window.setInterval((): void => { void reconcileSyncCheckout(); }, 1500);
    }
    const panel = root.querySelector<HTMLElement>(".sync-checkout__panel");
    panel.setAttribute("aria-modal", String(state.blocking));
    root.classList.toggle("sync-checkout--background", !state.blocking);
    root.classList.toggle("sync-checkout--compact", state.compact || !state.blocking);
    root.querySelector(".sync-checkout__details").classList.toggle("fn__none", state.compact);
    root.querySelector(".sync-checkout__notice").classList.toggle("fn__none", !state.blocking);
    updateProgressContent(root, state.message, state.current, state.total, "percent");
    root.querySelector('[data-action="toggle"] span').textContent = state.compact ?
        window.siyuan.languages.expand : window.siyuan.languages.collapseSyncDetails;
    root.querySelector<HTMLButtonElement>('[data-action="cancel"]').disabled = state.canceling;
    if (state.blocking && !root.contains(document.activeElement)) {
        previousFocus ||= document.activeElement as HTMLElement;
        root.querySelector<HTMLButtonElement>('[data-action="toggle"]').focus();
    }
};

const prepare = async (task: CheckoutState) => {
    if (!task.token || preparation === task.token) return;
    preparation = task.token;
    let saved = false;
    const failureVersion = getEditorSaveFailureVersion();
    try {
        await refreshTail;
        if (state?.taskID !== task.taskID || preparation !== task.token) return;
        unsavedPreparation = true;
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        await Promise.all(getAllEditor().filter(editor => editor?.protyle?.wysiwyg)
            .map(editor => {
                editor.protyle.title?.flushPendingInput();
                return editor.flushPendingTransactions();
            }));
        await flushPendingEditorSaves(failureVersion);
        saved = true;
        if (state?.taskID === task.taskID && preparation === task.token) unsavedPreparation = false;
    } catch (error) {
        console.error("Could not save input before sync checkout", error);
    }
    try {
        await fetchSyncPost("/api/sync/confirmSyncCheckout", {taskID: task.taskID, token: task.token, saved}, undefined, false);
    } catch (error) {
        if (preparation === task.token) preparation = undefined;
        console.error(error);
    }
};

const finish = (task: CheckoutState, resume?: CheckoutState) => {
    const refreshID = task.taskID + ":" + task.revision;
    if (refreshing === refreshID) return;
    refreshing = refreshID;
    // 未确认保存的准备轮次不会进入落盘，保留当前草稿并直接恢复输入。
    if (!task.blocking || unsavedPreparation) {
        clear();
        return;
    }
    state.phase = "refreshing";
    state.revision = task.revision;
    state.canceling = true;
    render();
    refreshTail = refreshTail.then(async () => {
        await waitForSyncReloads();
        const removed = new Set(task.removeRootIDs);
        if (getAllEditor().some(editor => removed.has(editor?.protyle?.block?.rootID))) {
            window.location.reload();
            return;
        }
        const changed = new Set(task.upsertRootIDs);
        await Promise.all(getAllEditor().filter(editor => editor?.protyle?.wysiwyg &&
            changed.has(editor.protyle.block.rootID)).map(editor => reloadProtyleAndWait(editor.protyle)));
        if (state?.taskID === task.taskID && state.phase === "refreshing" && state.revision === task.revision) {
            if (resume) {
                state = resume;
                refreshing = undefined;
                preparation = undefined;
                window.clearInterval(statePoll);
                statePoll = undefined;
                setEditingGuard(false);
                render();
                if (previousFocus?.isConnected) previousFocus.focus();
                previousFocus = undefined;
            } else clear();
        }
    }).catch(error => {
        console.error("Could not refresh synchronized documents", error);
        if (state?.taskID === task.taskID) window.location.reload();
    });
};

export const openSyncCheckoutProgress = () => {
    if (!state) return false;
    state.expanded = true;
    state.compact = false;
    render();
    return true;
};

export const syncCheckoutProgress = (data: IWebSocketData) => {
    const incoming = data.data;
    if (typeof incoming?.taskID !== "string" || !incoming.taskID) return;
    const nextRevision = Number(incoming.revision) || 0;
    if (nextRevision < revision) return;
    if (data.code === 2) {
        revision = nextRevision;
        if (state?.taskID === incoming.taskID) {
            finish({...state, revision: nextRevision, upsertRootIDs: incoming.upsertRootIDs || [], removeRootIDs: incoming.removeRootIDs || []});
        }
        return;
    }
    if (nextRevision === revision && state?.phase === "refreshing") return;
    revision = nextRevision;
    const same = state?.taskID === incoming.taskID;
    const next: CheckoutState = {...incoming, phase: incoming.phase || "applying", blocking: incoming.blocking !== false,
        message: incoming.message || data.msg || "", current: Number(incoming.current) || 0, total: Number(incoming.total) || 0,
        canceling: Boolean(incoming.canceling), upsertRootIDs: incoming.upsertRootIDs || [], removeRootIDs: incoming.removeRootIDs || [],
        compact: same ? state.compact : false, expanded: same ? state.expanded : false};
    if (same && state.blocking && !next.blocking) {
        finish({...state, revision: nextRevision, upsertRootIDs: next.upsertRootIDs, removeRootIDs: next.removeRootIDs}, next);
        return;
    }
    state = next;
    render();
    if (state.phase === "preparing") void prepare(state);
};

// 仅使用内核当前状态恢复任务；已保存并阻断的窗口重载后重新读取文档，避免写回旧界面。
export const reconcileSyncCheckout = async (clientID?: string, reconnect = false) => {
    if (clientID) connection = {appID: Constants.SIYUAN_APPID, clientID};
    try {
        const response = await fetchSyncPost("/api/sync/getSyncCheckout", connection || {}, undefined, false);
        if (response.code !== 0) return;
        if (kernelID && kernelID !== response.data.kernelID) revision = 0;
        kernelID = response.data.kernelID;
        if (reconnect && state?.blocking && !unsavedPreparation) {
            window.location.reload();
            return;
        }
        if (response.data.revision < revision) return;
        if (!response.data.task) {
            revision = response.data.revision;
            if (state?.blocking && !unsavedPreparation) window.location.reload();
            else clear();
        } else {
            syncCheckoutProgress({cmd: "syncProgress", code: response.data.task.phase === "done" ? 2 : 0, msg: "", data: response.data.task});
        }
    } catch (error) {
        console.error("Could not restore sync checkout state", error);
    }
};
