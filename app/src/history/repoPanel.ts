import {confirmDialog} from "../dialog/confirmDialog";
import {fetchSyncPost} from "../util/fetch";
import {escapeHtml} from "../util/escape";
import {isMobile} from "../util/functions";
import {removeSelectedRepoTags, repoSelectionKey, RepoSource, RepoTagSelection} from "./repoBatch";
import {canPurgeRepo} from "./repoPurge";

interface RepoPanelState {
    selected: Map<string, RepoTagSelection>;
    managing: boolean;
    busy: boolean;
    tagged: boolean;
}

const states = new WeakMap<Element, RepoPanelState>();

export const getRepoSnapshotType = (pane: Element) => {
    const tagged = states.get(pane.closest(".history__snapshots"))?.tagged;
    return pane.getAttribute("data-repo-source") === "local" ?
        (tagged ? "getRepoTagSnapshots" : "getRepoSnapshots") :
        (tagged ? "getCloudRepoTagSnapshots" : "getCloudRepoSnapshots");
};

export const updateRepoSelection = (pane: Element) => {
    const root = pane.closest(".history__snapshots");
    const state = states.get(root);
    if (!state) {
        return;
    }
    const lang = window.siyuan.languages;
    root.classList.toggle("history__snapshots--managing", state.managing);
    root.querySelector('[data-action="manage"]').textContent = state.managing ? lang.repoBatchDone : lang.repoBatchManage;
    root.querySelector('[data-action="manage"]').classList.toggle("fn__none", !state.tagged);
    root.querySelector('[data-role="batch"]').classList.toggle("fn__none", !state.managing);
    const counts = {local: 0, cloud: 0};
    state.selected.forEach(item => counts[item.source]++);
    root.querySelector('[data-role="selection"]').textContent = lang.repoBatchSelection.replace("${x}", String(counts.local)).replace("${y}", String(counts.cloud));
    root.querySelector<HTMLButtonElement>('[data-action="delete"]').disabled = state.busy || state.selected.size === 0;
    root.querySelectorAll<HTMLElement>("[data-repo-source]").forEach(column => {
        const source = column.dataset.repoSource as RepoSource;
        column.querySelector('[data-action="purge"]').classList.toggle("fn__none", !canPurgeRepo(source, window.siyuan.config.sync.provider));
        const comparison: {id: string}[] = JSON.parse(column.querySelector('[data-type="compare"]').getAttribute("data-ids") || "[]");
        column.querySelectorAll<HTMLLIElement>('li[data-type="repoitem"]').forEach(row => {
            row.classList.toggle("b3-list-item--focus", !state.managing && comparison.some(item => item.id === row.dataset.id));
            row.querySelectorAll(".b3-list-item__action").forEach(action => action.classList.toggle("fn__none", state.managing));
            const item = {source, tag: row.getAttribute("data-tag"), id: row.dataset.id};
            let checkbox = row.querySelector<HTMLInputElement>("input[data-repo-select]");
            if (!checkbox) {
                checkbox = document.createElement("input");
                checkbox.type = "checkbox";
                checkbox.className = "history__snapshot-check";
                checkbox.setAttribute("data-repo-select", "true");
                checkbox.setAttribute("aria-label", `${lang.selected} ${item.tag}`);
                row.prepend(checkbox);
                checkbox.addEventListener("click", event => event.stopPropagation());
                checkbox.addEventListener("change", () => {
                    const key = repoSelectionKey(item);
                    if (checkbox.checked) {
                        state.selected.set(key, item);
                    } else {
                        state.selected.delete(key);
                    }
                    updateRepoSelection(column);
                });
            }
            checkbox.checked = state.selected.has(repoSelectionKey(item));
            checkbox.disabled = state.busy;
            checkbox.classList.toggle("fn__none", !state.managing);
            row.classList.toggle("history__snapshot--selected", state.managing && checkbox.checked);
        });
        const all = column.querySelector<HTMLInputElement>("[data-repo-all]");
        const checkboxes = Array.from(column.querySelectorAll<HTMLInputElement>("[data-repo-select]"));
        all.checked = checkboxes.length > 0 && checkboxes.every(item => item.checked);
        all.indeterminate = checkboxes.some(item => item.checked) && !all.checked;
        all.disabled = state.busy || checkboxes.length === 0;
        all.parentElement.classList.toggle("fn__none", !state.managing);
    });
};

export const initRepoPanel = (root: HTMLElement, render: (pane: Element, page: number) => void) => {
    const lang = window.siyuan.languages;
    const state: RepoPanelState = {selected: new Map(), managing: false, busy: false, tagged: false};
    states.set(root, state);
    root.classList.add("history__snapshots");
    root.classList.toggle("history__snapshots--narrow", isMobile());
    root.dataset.source = "local";
    const template = root.innerHTML;
    root.innerHTML = `<div class="history__snapshot-toolbar">
    <button class="b3-button b3-button--text" data-action="normal" aria-pressed="true">${lang.dataSnapshot}</button>
    <button class="b3-button b3-button--text" data-action="tagged" aria-pressed="false">${lang.repoTaggedSnapshots}</button>
    <span class="fn__flex-1"></span>
    <button class="b3-button b3-button--outline fn__none" data-action="manage">${lang.repoBatchManage}</button>
    <button class="b3-button b3-button--outline" data-type="genRepo">${lang.createSnapshot}</button>
</div>
<div class="history__snapshot-columns"></div>
<div class="history__snapshot-toolbar fn__none" data-role="batch">
    <span data-role="selection" aria-live="polite"></span><span class="fn__flex-1"></span>
    <button class="b3-button b3-button--outline" data-action="clear">${lang.repoBatchClear}</button>
    <button class="b3-button b3-button--outline ft__error" data-action="delete">${lang.repoBatchDelete}</button>
</div>
<div class="history__snapshot-message fn__none" data-role="result" aria-live="polite"></div>`;
    const columns = root.querySelector(".history__snapshot-columns");
    for (const source of ["local", "cloud"] as const) {
        const pane = document.createElement("div");
        pane.className = "history__repo history__snapshot-pane";
        pane.dataset.repoSource = source;
        pane.innerHTML = `<div class="history__snapshot-toolbar history__snapshot-heading">
    <span class="history__snapshot-label">${source === "local" ? lang.localSnapshot : lang.cloudSnapshot}</span>
    <div class="history__snapshot-sources">
        <button class="b3-button b3-button--text" data-action="local" aria-pressed="true">${lang.localSnapshot}</button>
        <button class="b3-button b3-button--text" data-action="cloud" aria-pressed="false">${lang.cloudSnapshot}</button>
    </div><span class="fn__flex-1"></span>
    <button class="b3-button b3-button--text${canPurgeRepo(source, window.siyuan.config.sync.provider) ? "" : " fn__none"}" data-action="purge">${source === "local" ? lang.dataRepoPurge : lang.cloudStoragePurge}</button>
</div>
<label class="history__snapshot-toolbar fn__none"><input type="checkbox" class="history__snapshot-check" data-repo-all> ${lang.selectAll}</label>${template}`;
        pane.querySelector('[data-type="genRepo"]').remove();
        if (source === "cloud") {
            pane.querySelector('[data-type="compare"]').classList.add("fn__none");
        }
        pane.querySelector("[data-repo-all]").addEventListener("change", (event) => {
            const checked = (event.target as HTMLInputElement).checked;
            pane.querySelectorAll<HTMLElement>('li[data-type="repoitem"]').forEach(row => {
                const item = {source, tag: row.getAttribute("data-tag"), id: row.dataset.id};
                const key = repoSelectionKey(item);
                if (checked) {
                    state.selected.set(key, item);
                } else {
                    state.selected.delete(key);
                }
            });
            updateRepoSelection(pane);
        });
        columns.append(pane);
    }
    const panes = () => Array.from(columns.querySelectorAll<HTMLElement>("[data-repo-source]"));
    const refresh = () => panes().forEach(pane => render(pane, 1));
    const message = (text: string) => {
        const result = root.querySelector('[data-role="result"]');
        result.textContent = text;
        result.classList.remove("fn__none");
    };
    const setBusy = (busy: boolean) => {
        state.busy = busy;
        root.setAttribute("aria-busy", String(busy));
        root.querySelectorAll<HTMLButtonElement>("button[data-action], button[data-type=genRepo]").forEach(button => button.disabled = busy);
        updateRepoSelection(panes()[0]);
    };
    root.addEventListener("click", event => {
        if (state.busy) {
            event.stopPropagation();
            event.preventDefault();
        }
    }, true);
    root.addEventListener("click", event => {
        const target = event.target as HTMLElement;
        if (state.busy) {
            event.stopPropagation();
            event.preventDefault();
            return;
        }
        if (state.managing && target.closest('li[data-type="repoitem"]')) {
            event.stopPropagation();
            target.closest('li[data-type="repoitem"]').querySelector<HTMLInputElement>("[data-repo-select]").click();
            return;
        }
        const button = target.closest<HTMLElement>("[data-action]");
        if (!button) {
            return;
        }
        event.stopPropagation();
        const action = button.dataset.action;
        if (action === "normal" || action === "tagged") {
            state.tagged = action === "tagged";
            state.managing = false;
            state.selected.clear();
            root.querySelectorAll("[data-action=normal], [data-action=tagged]").forEach(item => item.setAttribute("aria-pressed", String(item === button)));
            panes().forEach(pane => {
                pane.querySelector<HTMLInputElement>(".b3-text-field").value = "";
                const compare = pane.querySelector('[data-type="compare"]');
                compare.removeAttribute("data-ids");
                compare.setAttribute("disabled", "disabled");
            });
            updateRepoSelection(panes()[0]);
            refresh();
        } else if (action === "local" || action === "cloud") {
            root.dataset.source = action;
            root.querySelectorAll<HTMLElement>("[data-action=local], [data-action=cloud]").forEach(item => item.setAttribute("aria-pressed", String(item.dataset.action === action)));
        } else if (action === "manage" || action === "clear") {
            if (action === "manage") {
                state.managing = !state.managing;
            }
            state.selected.clear();
            updateRepoSelection(panes()[0]);
        } else if (action === "delete") {
            const items = Array.from(state.selected.values());
            const summary = lang.repoBatchSelection.replace("${x}", String(items.filter(item => item.source === "local").length)).replace("${y}", String(items.filter(item => item.source === "cloud").length));
            const details = `<p>${summary}</p>` + ["local", "cloud"].map(source => `<div>${source === "local" ? lang.localSnapshot : lang.cloudSnapshot}</div><ul>${items.filter(item => item.source === source).map(item => `<li>${escapeHtml(item.tag)}</li>`).join("")}</ul>`).join("");
            confirmDialog(lang.deleteOpConfirm, `${details}<p>${lang.repoRemoveTagsTip}</p>`, async () => {
                setBusy(true);
                try {
                    const removed = await removeSelectedRepoTags(items, async item => {
                        const response = await fetchSyncPost(item.source === "local" ? "/api/repo/removeRepoTagSnapshot" : "/api/repo/removeCloudRepoTagSnapshot", {tag: item.tag});
                        return response.code === 0;
                    }, async source => {
                        const response = await fetchSyncPost(source === "local" ? "/api/repo/getRepoTagSnapshots" : "/api/repo/getCloudRepoTagSnapshots", {});
                        if (response.code !== 0) {
                            throw new Error(response.msg);
                        }
                        return response.data.snapshots;
                    });
                    removed.forEach(key => state.selected.delete(key));
                    message(lang.repoBatchResult.replace("${x}", String(removed.size)).replace("${y}", String(items.length - removed.size)));
                    refresh();
                } finally {
                    setBusy(false);
                }
            }, undefined, true);
        } else if (action === "purge") {
            const pane = button.closest<HTMLElement>("[data-repo-source]");
            const source = pane.dataset.repoSource as RepoSource;
            const provider = window.siyuan.config.sync.provider;
            if (!canPurgeRepo(source, provider)) {
                updateRepoSelection(pane);
                return;
            }
            const local = source === "local";
            confirmDialog(local ? lang.dataRepoPurge : lang.cloudStoragePurge, local ? lang.dataRepoPurgeConfirm : lang.cloudStoragePurgeConfirm, async () => {
                if (!local && (provider !== window.siyuan.config.sync.provider || !canPurgeRepo(source, window.siyuan.config.sync.provider))) {
                    updateRepoSelection(pane);
                    return;
                }
                setBusy(true);
                try {
                    await fetchSyncPost(local ? "/api/repo/purgeRepo" : "/api/repo/purgeCloudRepo", {});
                } catch (error) {
                    message(String(error));
                } finally {
                    setBusy(false);
                    render(pane, 1);
                }
            });
        }
    });
    const observer = new ResizeObserver(entries => {
        const width = entries[0].contentRect.width;
        if (width > 0) {
            root.classList.toggle("history__snapshots--narrow", isMobile() || width < 960);
        }
        if (!root.isConnected) {
            observer.disconnect();
        }
    });
    observer.observe(root);
    return () => observer.disconnect();
};
