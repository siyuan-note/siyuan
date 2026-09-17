import type {App} from "../../index";
/// #if MOBILE
import {registerMobileSecondaryEditor} from "../../mobile/util/secondaryEditors";
/// #endif
import type {GlobalBacklinkItem, GlobalBacklinkListRequestInput} from "../../types/api";
import {fetchSyncPost} from "../../util/fetch";
import {Protyle} from "../../protyle";
import {hasAVEditorSession} from "../../protyle/render/av/editorSession";
import {searchMarkRender} from "../../protyle/render/searchMarkRender";
import {waitForPendingTransactions} from "../../protyle/util/transactionQueue";
import {registerViewFoldContext, unregisterViewFoldContext} from "../../protyle/util/viewFold";
import {configureBacklinkTypeFold} from "../../protyle/wysiwyg/backlinkTypeFold";
import type {ViewStateService} from "../../util/viewState";
import {GLOBAL_BACKLINK_PAGE_SIZE, globalBacklinkPageWindow} from "./globalBacklinkPaging";

interface IGlobalBacklinkRecord {
    item: GlobalBacklinkItem;
    element: HTMLElement;
    source: HTMLElement;
    body: HTMLElement;
    editor?: Protyle;
    releasing?: boolean;
}

type GlobalBacklinkQueryInput = Omit<GlobalBacklinkListRequestInput, "snapshot" | "offset" | "anchorID">;

interface IGlobalBacklinkAnchor {
    id: string;
    offset: number;
}

// 固定数量的页容器与编辑器留在视口附近，其余位置由高度占位维持。
export class GlobalBacklinkList {
    public readonly element = document.createElement("div");
    private top = document.createElement("div");
    private bottom = document.createElement("div");
    private message = document.createElement("button");
    private records = new Map<string, IGlobalBacklinkRecord>();
    private pages = new Map<number, HTMLElement>();
    private heights = new Map<number, number>();
    private query?: GlobalBacklinkQueryInput;
    private key = "";
    private snapshot = "";
    private total = 0;
    private generation = 0;
    private loading = false;
    private loadingContexts = false;
    private frame = 0;
    private destroyed = false;
    private dirty = false;
    private failed = false;
    private composing = false;
    private dragging = false;
    private scrollVersion = 0;
    private onUserScroll = () => { this.scrollVersion++; this.onScroll(); };
    private controller = new AbortController();
    private collapsed = false;
    private pendingAnchor?: IGlobalBacklinkAnchor;
    private lastAnchor?: IGlobalBacklinkAnchor;
    private onScroll = () => {
        if (!this.frame) {
            this.frame = window.requestAnimationFrame(() => {
                this.frame = 0;
                this.lastAnchor = this.captureAnchor() || this.lastAnchor;
                this.options.state()?.set(this.anchorField(), this.lastAnchor);
                void this.updateViewport();
            });
        }
    };
    private onFocusout = () => window.setTimeout(() => {
        if (this.dirty && !this.isEditing()) {
            void this.refresh(true);
        } else {
            this.onScroll();
        }
    }, 100);
    private onCompositionStart = () => { this.composing = true; };
    private onCompositionEnd = () => { this.composing = false; this.onFocusout(); };
    private onDragStart = () => { this.dragging = true; };
    private onDragEnd = () => { this.dragging = false; this.onFocusout(); };
    private resize: ResizeObserver;

    constructor(private options: {
        app: App;
        host: HTMLElement;
        scroll: HTMLElement;
        state: () => ViewStateService | undefined;
        foldedTypes: () => string[];
        open: (id: string) => void;
        editorAdded: (editor: Protyle) => void;
        editorRemoved: (editor: Protyle) => void;
        count: (total: number) => void;
    }) {
        this.element.className = "backlinkList__global";
        this.message.className = "b3-button b3-button--text fn__block";
        this.message.addEventListener("click", () => {
            if (!this.snapshot) { void this.refresh(true); } else { this.onScroll(); }
        });
        this.element.append(this.top, this.bottom, this.message);
        options.host.replaceChildren(this.element);
        options.scroll.addEventListener("scroll", this.onUserScroll, {passive: true});
        this.element.addEventListener("focusout", this.onFocusout);
        this.element.addEventListener("av-editor-close", this.onFocusout);
        this.element.addEventListener("compositionstart", this.onCompositionStart);
        this.element.addEventListener("compositionend", this.onCompositionEnd);
        this.element.addEventListener("dragstart", this.onDragStart);
        this.element.addEventListener("dragend", this.onDragEnd);
        this.resize = new ResizeObserver(this.onScroll);
        this.resize.observe(options.scroll);
    }

    private anchorField() { return `anchor:global:${this.query?.sort}`; }

    public search(query: GlobalBacklinkQueryInput, refresh: boolean) {
        const key = JSON.stringify(query);
        if (key !== this.key) {
            this.generation++;
            this.controller.abort();
            this.key = key;
            this.query = query;
            this.lastAnchor = this.options.state()?.get<IGlobalBacklinkAnchor>(this.anchorField());
            this.heights.clear();
            void this.refresh(false);
        } else if (refresh) {
            this.dirty = true;
            if (!this.isEditing()) { void this.refresh(true); }
        }
    }

    public markDirty() { this.dirty = true; }

    public updateFoldTypes() {
        const state = this.options.state();
        if (state) {
            this.records.forEach(record => {
                if (record.editor) { configureBacklinkTypeFold(record.editor.protyle, this.options.foldedTypes(), state); }
            });
        }
    }

    public get count() { return this.total; }

    public get hasError() { return this.failed; }

    public setCollapsed(value: boolean) {
        this.collapsed = value;
        this.records.forEach(record => {
            record.body.classList.toggle("fn__none", value);
            record.source.classList.toggle("fn__none", !value && Boolean(record.editor));
        });
        this.onScroll();
    }

    private isEditing() {
        return this.composing || this.dragging || hasAVEditorSession(this.element) ||
            Array.from(this.records.values()).some(record => record.editor?.protyle.element.contains(document.activeElement));
    }

    private captureAnchor(): IGlobalBacklinkAnchor | undefined {
        const viewport = this.options.scroll.getBoundingClientRect();
        for (const page of Array.from(this.pages.entries()).sort((a, b) => a[0] - b[0])) {
            for (const element of Array.from(page[1].children)) {
                const rect = element.getBoundingClientRect();
                if (rect.bottom > viewport.top && rect.top < viewport.bottom) {
                    return {id: element.getAttribute("data-global-backlink-id"), offset: rect.top - viewport.top};
                }
            }
        }
    }

    private restoreAnchor(anchor?: IGlobalBacklinkAnchor) {
        const record = anchor && this.records.get(anchor.id);
        if (record) {
            this.options.scroll.scrollTop += record.element.getBoundingClientRect().top -
                this.options.scroll.getBoundingClientRect().top - anchor.offset;
        }
    }

    private async refresh(preserve: boolean) {
        if (this.destroyed || !this.query || this.isEditing()) { this.dirty = true; return; }
        const generation = ++this.generation;
        this.controller.abort();
        this.controller = new AbortController();
        const anchor = preserve ? this.captureAnchor() || this.lastAnchor : this.lastAnchor;
        this.pendingAnchor = anchor;
        this.dirty = false;
        await Promise.all(Array.from(this.records.values()).map(record =>
            record.editor ? waitForPendingTransactions(record.editor.protyle) : Promise.resolve()));
        if (generation !== this.generation || this.destroyed || this.isEditing()) { this.dirty = true; return; }
        this.clearPages();
        this.snapshot = "";
        this.loading = false;
        this.loadingContexts = false;
        this.total = 0;
        this.top.style.height = this.bottom.style.height = "0px";
        await this.loadPage(0, anchor?.id);
    }

    private async loadPage(offset: number, anchorID?: string) {
        if (this.loading || this.destroyed || !this.query) { return; }
        this.loading = true;
        const generation = this.generation;
        this.message.textContent = window.siyuan.languages.loading;
        try {
            const response = await fetchSyncPost("/api/ref/getGlobalBacklinks", {...this.query, snapshot: this.snapshot, offset, anchorID}, undefined, true, this.controller.signal);
            if (this.destroyed || generation !== this.generation) { return; }
            if (response.code !== 0 || !response.data) {
                this.clearUnavailable();
                throw new Error(response.msg);
            }
            const data = response.data;
            if (data.expired) { this.snapshot = ""; this.dirty = true; this.onFocusout(); return; }
            this.snapshot = data.snapshot;
            this.total = data.total;
            this.failed = false;
            this.options.count(this.total);
            const anchor = this.captureAnchor();
            this.addPage(data.offset, data.items);
            this.updateSpacers();
            this.restoreAnchor(this.pendingAnchor || anchor);
            this.lastAnchor = this.pendingAnchor || anchor || this.lastAnchor;
            this.pendingAnchor = undefined;
            this.message.textContent = this.total === 0 ? window.siyuan.languages.emptyContent : "";
            this.message.classList.toggle("fn__none", this.total > 0);
            this.onScroll();
        } catch (error) {
            if (generation === this.generation && !this.destroyed) {
                this.failed = true;
                this.options.count(this.total);
                this.message.classList.remove("fn__none");
                this.message.textContent = window.siyuan.languages.retry;
                console.error(error);
            }
        } finally {
            if (generation === this.generation) { this.loading = false; }
        }
    }

    private addPage(offset: number, items: GlobalBacklinkItem[]) {
        if (this.pages.has(offset)) { return; }
        const page = document.createElement("div");
        this.pages.set(offset, page);
        items.forEach(item => {
            const element = document.createElement("div");
            element.className = "backlinkList__item";
            element.setAttribute("data-global-backlink-id", item.id);
            const source = document.createElement("button");
            source.className = "backlinkList__source";
            source.type = "button";
            source.textContent = item.hPath;
            source.title = item.hPath;
            source.addEventListener("click", event => { event.stopPropagation(); this.options.open(item.id); });
            const body = document.createElement("div");
            body.style.minHeight = "72px";
            body.classList.toggle("fn__none", this.collapsed);
            body.textContent = item.anchor || window.siyuan.languages.loading;
            element.append(source, body);
            page.append(element);
            this.records.set(item.id, {item, element, source, body});
        });
        const next = Array.from(this.pages.keys()).sort((a, b) => a - b).find(value => value > offset);
        this.element.insertBefore(page, next === undefined ? this.bottom : this.pages.get(next));
    }

    private height(offset: number) {
        return this.heights.get(offset) ?? Math.min(GLOBAL_BACKLINK_PAGE_SIZE, this.total - offset) * 104;
    }

    private updateSpacers() {
        const offsets = Array.from(this.pages.keys()).sort((a, b) => a - b);
        if (offsets.length === 0) { return; }
        let top = 0;
        let bottom = 0;
        for (let offset = 0; offset < this.total; offset += GLOBAL_BACKLINK_PAGE_SIZE) {
            if (offset < offsets[0]) { top += this.height(offset); }
            if (offset > offsets[offsets.length - 1]) { bottom += this.height(offset); }
        }
        this.top.style.height = `${top}px`;
        this.bottom.style.height = `${bottom}px`;
        this.element.querySelectorAll("[data-global-gap]").forEach(element => element.remove());
        offsets.forEach((offset, index) => {
            if (index === 0) { return; }
            let height = 0;
            for (let missing = offsets[index - 1] + GLOBAL_BACKLINK_PAGE_SIZE; missing < offset; missing += GLOBAL_BACKLINK_PAGE_SIZE) {
                height += this.height(missing);
            }
            if (height > 0) {
                const gap = document.createElement("div");
                gap.setAttribute("data-global-gap", "true");
                gap.style.height = `${height}px`;
                this.element.insertBefore(gap, this.pages.get(offset));
            }
        });
    }

    private trimPages(center: number) {
        const range = globalBacklinkPageWindow(center, this.total);
        this.pages.forEach((page, offset) => {
            if (offset >= range.start && offset < range.end || page.contains(document.activeElement) || hasAVEditorSession(page)) { return; }
            if (Array.from(this.records.values()).some(record => page.contains(record.element) && record.editor)) {
                this.records.forEach(record => { if (page.contains(record.element)) { void this.release(record); } });
                return;
            }
            this.heights.set(offset, page.getBoundingClientRect().height);
            this.records.forEach((record, id) => { if (page.contains(record.element)) { this.records.delete(id); } });
            page.remove();
            this.pages.delete(offset);
        });
    }

    private async updateViewport() {
        if (this.destroyed || !this.snapshot || !this.element.getClientRects().length) { return; }
        const generation = this.generation;
        const viewport = this.options.scroll.getBoundingClientRect();
        const candidates: IGlobalBacklinkRecord[] = [];
        this.records.forEach(record => {
            const rect = record.element.getBoundingClientRect();
            if (!this.collapsed && rect.bottom > viewport.top - 320 && rect.top < viewport.bottom + 320) {
                candidates.push(record);
            } else { void this.release(record); }
        });
        const centerY = (viewport.top + viewport.bottom) / 2;
        candidates.sort((a, b) => Math.abs(a.element.getBoundingClientRect().top - centerY) - Math.abs(b.element.getBoundingClientRect().top - centerY));
        candidates.slice(16).forEach(record => { void this.release(record); });
        void this.loadContexts(candidates.slice(0, 16).filter(record => !record.editor && !record.releasing));
        let y = this.element.getBoundingClientRect().top;
        let center = 0;
        for (; center + GLOBAL_BACKLINK_PAGE_SIZE < this.total; center += GLOBAL_BACKLINK_PAGE_SIZE) {
            const height = this.pages.get(center)?.getBoundingClientRect().height ?? this.height(center);
            if (y + height > centerY) { break; }
            y += height;
        }
        const range = globalBacklinkPageWindow(center, this.total);
        if (this.pages.has(center)) {
            const offsets: number[] = [];
            for (let offset = range.start; offset < range.end; offset += GLOBAL_BACKLINK_PAGE_SIZE) { offsets.push(offset); }
            offsets.sort((a, b) => Math.abs(a - center) - Math.abs(b - center));
            for (const offset of offsets) {
                if (!this.pages.has(offset)) { await this.loadPage(offset); break; }
            }
        } else { await this.loadPage(center); }
        if (this.destroyed || generation !== this.generation) { return; }
        const anchor = this.captureAnchor();
        this.trimPages(center);
        this.updateSpacers();
        this.restoreAnchor(anchor);
    }

    private async loadContexts(records: IGlobalBacklinkRecord[]) {
        if (this.loadingContexts || records.length === 0) { return; }
        this.loadingContexts = true;
        const generation = this.generation;
        try {
            const response = await fetchSyncPost("/api/ref/getGlobalBacklinkContexts", {...this.query, snapshot: this.snapshot, ids: records.map(record => record.item.id)}, undefined, true, this.controller.signal);
            if (generation !== this.generation || this.destroyed) { return; }
            if (response.code !== 0 || !response.data) {
                this.clearUnavailable();
                throw new Error(response.msg);
            }
            if (response.data.expired) { this.dirty = true; this.onFocusout(); return; }
            this.failed = false;
            this.options.count(this.total);
            this.message.classList.add("fn__none");
            const anchor = this.captureAnchor();
            const scrollVersion = this.scrollVersion;
            for (const item of response.data.items || []) {
                const record = this.records.get(item.id);
                if (!record || record.editor || !records.includes(record) || this.collapsed) { continue; }
                const viewport = this.options.scroll.getBoundingClientRect();
                const rect = record.element.getBoundingClientRect();
                if (rect.bottom <= viewport.top - 320 || rect.top >= viewport.bottom + 320 ||
                    Array.from(this.records.values()).filter(value => value.editor).length >= 16) { continue; }
                record.body.style.minHeight = `${rect.height}px`;
                record.body.replaceChildren();
                record.body.setAttribute("data-defid", this.query.id);
                record.body.setAttribute("data-ismention", "false");
                record.body.setAttribute("data-notebook-id", record.item.box);
                record.body.setAttribute("data-backlink-show-document", "true");
                const editor = new Protyle(this.options.app, record.body, {
                    blockId: record.item.rootID,
                    notebookId: record.item.box,
                    backlinkData: [item],
                    click: {preventInsetEmptyBlock: true},
                    render: {background: false, gutter: true, scroll: false, breadcrumb: false},
                });
                record.editor = editor;
                record.source.classList.add("fn__none");
                /// #if MOBILE
                registerMobileSecondaryEditor(editor, () => this.options.open(record.item.id));
                /// #endif
                this.options.editorAdded(editor);
                searchMarkRender(editor.protyle, this.query.keyword?.trim().split(/\s+/) || [], undefined, undefined, {
                    excludeSelector: ".protyle-breadcrumb__bar[data-backlink-id]",
                });
                const state = this.options.state();
                if (state) {
                    configureBacklinkTypeFold(editor.protyle, this.options.foldedTypes(), state);
                    await registerViewFoldContext(editor.protyle, {
                        store: state, pane: "backlink", rootID: record.item.rootID,
                        getOccurrenceID: () => `global:${item.id}`,
                        getOccurrenceRevision: () => item.revision,
                    });
                }
                if (this.destroyed || generation !== this.generation) { return; }
            }
            if (scrollVersion === this.scrollVersion) { this.restoreAnchor(anchor); }
        } catch (error) {
            if (generation !== this.generation || this.destroyed) { return; }
            this.failed = true;
            this.options.count(this.total);
            console.error(error);
            this.message.classList.remove("fn__none");
            this.message.textContent = window.siyuan.languages.retry;
        } finally {
            if (generation === this.generation) { this.loadingContexts = false; }
        }
    }

    private async release(record: IGlobalBacklinkRecord) {
        const editor = record.editor;
        if (!editor || record.releasing || this.composing || this.dragging ||
            record.element.contains(document.activeElement) || hasAVEditorSession(record.element)) { return; }
        record.releasing = true;
        await waitForPendingTransactions(editor.protyle);
        record.releasing = false;
        if (this.destroyed || this.composing || this.dragging || record.editor !== editor ||
            record.element.contains(document.activeElement) || hasAVEditorSession(record.element)) { return; }
        const height = record.element.getBoundingClientRect().height;
        unregisterViewFoldContext(editor.protyle);
        this.options.editorRemoved(editor);
        editor.destroy();
        record.editor = undefined;
        record.body.replaceChildren();
        record.body.textContent = record.item.anchor;
        record.source.classList.remove("fn__none");
        // 占位总高度包含重新显示的来源行，避免回收时重复增加面包屑的高度。
        record.body.style.minHeight = `${Math.max(0, height - record.source.getBoundingClientRect().height)}px`;
        this.onScroll();
    }

    private clearPages() {
        this.records.forEach(record => {
            if (record.editor) {
                unregisterViewFoldContext(record.editor.protyle);
                this.options.editorRemoved(record.editor);
                record.editor.destroy();
                record.editor = undefined;
            }
        });
        this.records.clear();
        this.pages.forEach(page => page.remove());
        this.pages.clear();
        this.element.querySelectorAll("[data-global-gap]").forEach(element => element.remove());
    }

    private clearUnavailable() {
        this.generation++;
        this.controller.abort();
        this.controller = new AbortController();
        this.loading = this.loadingContexts = false;
        this.clearPages();
        this.snapshot = "";
        this.total = 0;
        this.failed = true;
        this.top.style.height = this.bottom.style.height = "0px";
        this.options.count(0);
        this.message.classList.remove("fn__none");
        this.message.textContent = window.siyuan.languages.retry;
    }

    public destroy() {
        this.lastAnchor = this.captureAnchor() || this.lastAnchor;
        if (this.lastAnchor) { this.options.state()?.set(this.anchorField(), this.lastAnchor); }
        this.destroyed = true;
        this.controller.abort();
        this.generation++;
        window.cancelAnimationFrame(this.frame);
        this.resize.disconnect();
        this.options.scroll.removeEventListener("scroll", this.onUserScroll);
        this.clearPages();
        this.element.remove();
    }
}
