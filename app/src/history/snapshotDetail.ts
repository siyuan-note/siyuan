import {MobileDialog} from "../dialog/mobileDialog";
import type {App} from "../index";
import type {DocHistorySnapshot} from "../types/api";
import {Protyle} from "../protyle";
import {fetchSyncPost} from "../util/fetch";
import {escapeHtml} from "../util/escape";
import {isMobile} from "../util/functions";
import {renderRepoFile} from "./repoFile";
import dayjs from "dayjs";
import {forgetNotebookHistoryDialog, trackNotebookHistoryDialog} from "./notebookDialogs";
import {isPluginSnapshotPath, TPluginSnapshotPart} from "./pluginSnapshotPaths";

export const openSnapshotDetail = async (app: App, reference: DocHistorySnapshot, notebook: string) => {
    const dialog = new MobileDialog({
        mobileSheet: {mode: "expanded"},
        title: escapeHtml(reference.tags.join(" / ")),
        content: "",
        width: isMobile() ? "100vw" : "85vw",
        height: isMobile() ? "100dvh" : "80vh",
        containerClassName: "b3-dialog__container--theme",
        destroyCallback: () => {
            forgetNotebookHistoryDialog(dialog);
            detail?.destroy();
        }
    });
    const detail = mountSnapshotDetail(app, dialog.element.querySelector(".b3-dialog__body"), reference, notebook, {
        onNotebooks: notebooks => trackNotebookHistoryDialog(dialog, notebooks),
    });
    await detail.loaded;
};

export const mountSnapshotDetail = (app: App, root: HTMLElement, reference: DocHistorySnapshot, notebook: string,
                                    options: {plugin?: {name: string, part: TPluginSnapshotPart}, onNotebooks?: (notebooks: string[]) => void} = {}) => {
    const lang = window.siyuan.languages;
    let editor: Protyle;
    const abort = new AbortController();
    root.innerHTML = `<div class="history__snapshot-detail"><div class="history__snapshot-detail-status" data-detail-status role="status">${lang.loading}</div><div class="history__snapshot-detail-content fn__none"><div class="history__snapshot-detail-meta"></div><div class="history__snapshot-detail-panels"><ul class="b3-list b3-list--background history__snapshot-detail-files"></ul><div class="history__snapshot-detail-preview"></div></div></div></div>`;
    const notebooks = new Set([notebook]);
    options.onNotebooks?.(Array.from(notebooks));
    const status = root.querySelector<HTMLElement>("[data-detail-status]");
    const list = root.querySelector<HTMLElement>(".history__snapshot-detail-files");
    const preview = root.querySelector<HTMLElement>(".history__snapshot-detail-preview");
    const select = (row: HTMLElement) => {
        if (row.dataset.notebook) {
            notebooks.add(row.dataset.notebook);
            options.onNotebooks?.(Array.from(notebooks));
        }
        editor?.destroy();
        editor = undefined;
        list.querySelector(".b3-list-item--focus")?.classList.remove("b3-list-item--focus");
        row.classList.add("b3-list-item--focus");
        renderRepoFile(app, row, preview, value => { editor = value; });
    };
    list.addEventListener("click", event => {
        const row = (event.target as Element).closest<HTMLElement>("[data-id]");
        if (row && list.contains(row)) {
            select(row);
        }
    });
    list.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
            const row = (event.target as Element).closest<HTMLElement>("[data-id]");
            if (row) {
                event.preventDefault();
                select(row);
            }
        }
    });
    const loaded = fetchSyncPost("/api/repo/getRepoSnapshots", {id: reference.id, page: 1, includeFiles: true}, undefined, false, abort.signal).then(response => {
        if (abort.signal.aborted || !root.isConnected) {
            return;
        }
        if (response.code !== 0) {
            throw new Error(response.msg);
        }
        const snapshot = response.data.snapshots.find(item => item.id === reference.id);
        if (!snapshot) {
            throw new Error(lang.historySnapshotMissing);
        }
        root.querySelector(".history__snapshot-detail-meta").innerHTML = `<div class="ft__on-surface">${dayjs(snapshot.created).format("YYYY-MM-DD HH:mm:ss")} <code>${escapeHtml(snapshot.id)}</code></div><div class="history__association-memo">${escapeHtml(snapshot.memo)}</div>`;
        const fragment = document.createDocumentFragment();
        let selected: HTMLElement;
        snapshot.files.forEach(file => {
            if (options.plugin && !isPluginSnapshotPath(file.path, options.plugin.name, options.plugin.part)) {
                return;
            }
            const row = document.createElement("li");
            row.className = "b3-list-item";
            row.tabIndex = 0;
            row.setAttribute("role", "button");
            row.dataset.id = file.id;
            row.dataset.snapshot = snapshot.id;
            row.dataset.notebook = file.path.split("/").filter(Boolean)[0];
            row.title = file.path;
            const text = document.createElement("span");
            text.className = "b3-list-item__text";
            text.textContent = file.path;
            row.append(text);
            fragment.append(row);
            if (file.id === reference.fileID) {
                selected = row;
            }
        });
        list.replaceChildren(fragment);
        if (!list.children.length) { list.textContent = lang.emptyContent; }
        status.classList.add("fn__none");
        root.querySelector(".history__snapshot-detail-content").classList.remove("fn__none");
        if (selected) {
            select(selected);
            selected.scrollIntoView({block: "start"});
        }
    }).catch(error => {
        if (!abort.signal.aborted && root.isConnected) {
            status.textContent = error instanceof Error ? error.message : String(error);
            status.classList.add("ft__error");
        }
    });
    return {loaded, destroy: () => {
        abort.abort();
        preview.removeAttribute("data-request-id");
        editor?.destroy();
    }};
};
