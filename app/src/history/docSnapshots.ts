import type {App} from "../index";
import type {DocHistorySnapshot, DocHistorySnapshotEntry} from "../types/api";
import {fetchSyncPost} from "../util/fetch";
import {escapeAttr, escapeHtml} from "../util/escape";
import * as dayjs from "dayjs";
import {openSnapshotDetail} from "./snapshotDetail";

const views = new WeakMap<Element, DocHistorySnapshots>();

export const getDocHistorySnapshots = (element: Element) => views.get(element);

export class DocHistorySnapshots {
    private entries = new Map<string, DocHistorySnapshotEntry>();
    private request = 0;
    private created: string[] = [];
    private op = "all";
    private selected = "";
    private error = "";
    private loading = false;
    private abort?: AbortController;
    private panel: HTMLElement;

    constructor(private app: App, private element: HTMLElement, private id: string, private notebook = "") {
        views.set(element, this);
        this.panel = document.createElement("section");
        this.panel.className = "history__associations fn__none";
        this.panel.setAttribute("aria-live", "polite");
        const title = element.querySelector(".protyle-title__input");
        title.before(this.panel);
        element.addEventListener("click", event => {
            const target = (event.target as Element).closest<HTMLElement>("[data-history-snapshot], [data-history-retry]");
            if (!target || !element.contains(target)) {
                return;
            }
            event.stopPropagation();
            if (target.hasAttribute("data-history-retry")) {
                void this.load(this.created, this.op);
                return;
            }
            const entry = this.entries.get(target.dataset.historyCreated);
            const snapshot = entry?.snapshots.find(item => item.id === target.dataset.historySnapshot);
            if (snapshot) {
                void openSnapshotDetail(this.app, snapshot, this.notebook || entry.historyPath.split("/").filter(Boolean)[2]);
            }
        });
    }

    reset() {
        this.abort?.abort();
        this.request++;
        this.entries.clear();
        this.selected = "";
        this.error = "";
        this.loading = false;
        this.panel.innerHTML = "";
        this.panel.classList.add("fn__none");
    }

    destroy() {
        this.reset();
        views.delete(this.element);
    }

    select(created: string) {
        this.selected = created;
        this.renderPanel();
    }

    setEntries(entries: DocHistorySnapshotEntry[]) {
        this.entries = new Map(entries.map(entry => [entry.created, entry]));
        this.error = "";
        this.loading = false;
        this.renderSummaries();
        this.renderPanel();
    }

    async load(created: string[], op: string) {
        this.abort?.abort();
        this.abort = new AbortController();
        const request = ++this.request;
        this.created = created;
        this.op = op;
        this.error = "";
        this.loading = true;
        this.entries.clear();
        this.renderPanel();
        if (created.length === 0) {
            this.loading = false;
            this.renderPanel();
            return;
        }
        try {
            const response = await fetchSyncPost("/api/history/getDocHistorySnapshots", {
                id: this.id, created, op
            }, undefined, false, this.abort.signal);
            if (request !== this.request || !this.element.isConnected) {
                return;
            }
            if (response.code !== 0) {
                throw new Error(response.msg);
            }
            response.data.histories.forEach(entry => this.entries.set(entry.created, entry));
        } catch (error) {
            if (request !== this.request || !this.element.isConnected) {
                return;
            }
            this.error = error instanceof Error ? error.message : String(error);
        }
        this.loading = false;
        this.renderSummaries();
        this.renderPanel();
    }

    private renderSummaries() {
        this.element.querySelectorAll<HTMLElement>("[data-history-tags]").forEach(summary => {
            const created = summary.dataset.historyTags;
            const snapshots = this.entries.get(created)?.snapshots || [];
            if (this.error) {
                summary.innerHTML = `<button class="b3-button b3-button--text" data-history-retry title="${escapeAttr(escapeHtml(this.error))}">${window.siyuan.languages.historySnapshotsError}</button>`;
            } else if (snapshots.length) {
                const names = snapshots.flatMap(item => item.tags).join(" / ");
                summary.innerHTML = `<button class="b3-button b3-button--text history__association-link" data-history-created="${escapeAttr(created)}" data-history-snapshot="${snapshots[0].id}" title="${escapeAttr(escapeHtml(names))}"><svg><use xlink:href="#iconTags"></use></svg><span class="fn__ellipsis">${escapeHtml(snapshots[0].tags.join(" / "))}</span>${snapshots.length > 1 ? `<span class="fn__space"></span><span>+${snapshots.length - 1}</span>` : ""}</button>`;
            } else {
                summary.innerHTML = "";
            }
        });
    }

    private renderPanel() {
        const snapshots = this.entries.get(this.selected)?.snapshots || [];
        this.panel.classList.toggle("fn__none", !this.selected || (!this.loading && !this.error && !snapshots.length));
        if (!this.selected) {
            return;
        }
        const lang = window.siyuan.languages;
        if (this.loading) {
            this.panel.textContent = lang.loading;
        } else if (this.error) {
            this.panel.innerHTML = `<span class="ft__error">${lang.historySnapshotsError}</span><span class="fn__space"></span><button class="b3-button b3-button--outline" data-history-retry title="${escapeAttr(escapeHtml(this.error))}">${lang.retry}</button>`;
        } else {
            const open = this.panel.querySelector("details")?.open ?? true;
            this.panel.innerHTML = `<details${open ? " open" : ""}><summary>${lang.historySnapshots} (${snapshots.length})</summary><div class="history__association-list">${snapshots.map(snapshot => this.renderSnapshot(snapshot)).join("")}</div></details>`;
        }
    }

    private renderSnapshot(snapshot: DocHistorySnapshot) {
        return `<div class="history__association">
    <div class="history__association-heading"><button class="b3-button b3-button--text history__association-link" data-history-created="${escapeAttr(this.selected)}" data-history-snapshot="${snapshot.id}"><svg><use xlink:href="#iconTags"></use></svg><span class="fn__ellipsis">${escapeHtml(snapshot.tags.join(" / "))}</span></button><span class="ft__on-surface">${dayjs(snapshot.created).format("YYYY-MM-DD HH:mm:ss")}</span></div>
    <div class="history__association-memo">${escapeHtml(snapshot.memo)}</div>
</div>`;
    }
}
