import {SessionIndexItem, SessionStore} from "./SessionStore";
import {escapeHtml} from "../../../util/escape";
import {setPosition} from "../../../util/setPosition";
import {hasClosestByClassName} from "../../../protyle/util/hasClosest";

export class AgentSessionPanel {
    private popup: HTMLElement | null = null;
    private isRendering = false;
    private items: SessionIndexItem[] = [];
    private total = 0;
    private page = 0;
    private isLoadingMore = false;
    private searchTimer: number | null = null;
    private searchKeyword = "";

    constructor(
        private triggerBtn: HTMLElement,
        private host: HTMLElement,
        private getCurrentSessionId: () => string,
        private getDefaultTitle: () => string,
        private callbacks: {
            onSwitch: (id: string) => Promise<void>;
            onDelete: (id: string) => Promise<void>;
            onRename: (id: string, title: string) => Promise<void>;
        }
    ) {}

    toggle() {
        if (this.isRendering) { return; }
        if (this.popup) {
            this.close();
            return;
        }
        this.render();
    }

    close() {
        document.querySelectorAll(".agent-session-popup").forEach(function (el) { el.remove(); });
        this.popup = null;
        this.searchKeyword = "";
        this.items = [];
        this.total = 0;
        this.page = 0;
        if (this.searchTimer !== null) { clearTimeout(this.searchTimer); this.searchTimer = null; }
    }

    destroy() {
        this.close();
    }

    private async render() {
        this.isRendering = true;
        this.close();
        try {
            const result = await SessionStore.list({page: 1, pageSize: 30});
            this.items = result.sessions;
            this.total = result.total;
            this.page = 1;

            this.popup = document.createElement("div");
            this.popup.className = "agent-session-popup b3-menu";

            const L = window.siyuan.languages;

            let html = '<input class="b3-text-field agent-session-popup__search" placeholder="' + L.agentSessionSearch + '">';
            html += '<div class="b3-menu__items"></div>';

            this.popup.innerHTML = html;

            const itemsContainer = this.popup.querySelector(".b3-menu__items") as HTMLElement;
            this.renderItems(itemsContainer, result.sessions, false);
            const searchInput = this.popup.querySelector(".agent-session-popup__search") as HTMLInputElement;
            searchInput.addEventListener("input", () => {
                this.filter(searchInput.value, itemsContainer);
            });
            searchInput.addEventListener("click", (e: MouseEvent) => {
                e.stopPropagation();
            });

            itemsContainer.addEventListener("scroll", () => {
                if (this.isLoadingMore) { return; }
                if (this.items.length >= this.total) { return; }
                if (itemsContainer.scrollHeight - itemsContainer.scrollTop - itemsContainer.clientHeight <= 30) {
                    this.loadMore(itemsContainer);
                }
            });

            this.host.appendChild(this.popup);
            this.popup.style.zIndex = (++window.siyuan.zIndex).toString();

            const btnRect = this.triggerBtn.getBoundingClientRect();
            setPosition(this.popup, btnRect.right - 280, btnRect.bottom, btnRect.height, btnRect.width);

            this.popup.addEventListener("click", (e: MouseEvent) => {
                e.stopPropagation();
            });
            const onResize = () => { this.close(); };
            window.addEventListener("resize", onResize);
            const closeOut = () => {
                this.close();
                document.removeEventListener("click", closeOut);
                window.removeEventListener("resize", onResize);
            };
            setTimeout(() => {
                document.addEventListener("click", closeOut);
            }, 10);
        } finally {
            this.isRendering = false;
        }
    }

    private renderItems(container: HTMLElement, listItems: SessionIndexItem[], append: boolean) {
        let html = "";
        if (listItems.length === 0 && !append) {
            html += '<div class="b3-menu__item"><span class="b3-menu__label" style="text-align:center;color:var(--b3-theme-on-surface-light)">' + (window.siyuan.languages.emptyContent || "No sessions") + "</span></div>";
        } else {
            const currentId = this.getCurrentSessionId();
            const defaultTitle = this.getDefaultTitle();
            for (let i = 0; i < listItems.length; i++) {
                const s = listItems[i];
                const isActive = s.id === currentId;
                html += '<div class="b3-menu__item' + (isActive ? " b3-menu__item--current" : "") + '" data-id="' + s.id + '">' +
                    '<span class="b3-menu__label ariaLabel" data-position="east" aria-label="' + escapeHtml(s.title || defaultTitle) + '">' + escapeHtml(s.title || defaultTitle) + "</span>" +
                    '<span class="agent-session-popup__actions">' +
                        '<svg class="agent-session-popup__rename ariaLabel" data-position="north" data-id="' + s.id + '" aria-label="' + window.siyuan.languages.rename + '"><use xlink:href="#iconEdit"></use></svg>' +
                        '<svg class="agent-session-popup__delete ariaLabel" data-position="north" data-id="' + s.id + '" aria-label="' + window.siyuan.languages.delete + '"><use xlink:href="#iconTrashcan"></use></svg>' +
                        "</span>" +
                    "</div>";
            }
        }
        if (append) {
            container.insertAdjacentHTML("beforeend", html);
        } else {
            container.innerHTML = html;
        }
        this.bindEvents(container);
    }

    private bindEvents(container: HTMLElement) {
        if (container.dataset.eventsBound) { return; }
        container.dataset.eventsBound = "1";

        container.addEventListener("click", (e: MouseEvent) => {
            const target = e.target as HTMLElement;

            const deleteBtn = hasClosestByClassName(target, "agent-session-popup__delete");
            if (deleteBtn) {
                e.stopPropagation();
                const id = (deleteBtn as HTMLElement).getAttribute("data-id") || "";
                if (id) { this.callbacks.onDelete(id).then(() => { this.refresh(); }); }
                return;
            }

            const renameBtn = hasClosestByClassName(target, "agent-session-popup__rename");
            if (renameBtn) {
                e.stopPropagation();
                const id = (renameBtn as HTMLElement).getAttribute("data-id") || "";
                if (id) {
                    const parent = (renameBtn as HTMLElement).parentElement;
                    const row = parent ? parent.parentElement as HTMLElement : null;
                    if (row) { this.startRename(id, row); }
                }
                return;
            }

            if (hasClosestByClassName(target, "agent-session-popup__rename-input")) {
                return;
            }

            const item = hasClosestByClassName(target, "b3-menu__item");
            if (item) {
                const id = (item as HTMLElement).getAttribute("data-id") || "";
                if (id && id !== this.getCurrentSessionId()) {
                    this.close();
                    this.callbacks.onSwitch(id);
                }
            }
        });
    }

    private async loadMore(container: HTMLElement) {
        if (this.isLoadingMore) { return; }
        this.isLoadingMore = true;
        try {
            const result = await SessionStore.list({page: this.page + 1, pageSize: 30, keyword: this.searchKeyword});
            this.page = result.page;
            this.items = this.items.concat(result.sessions);
            this.total = result.total;
            this.renderItems(container, result.sessions, true);
        } finally {
            this.isLoadingMore = false;
        }
    }

    private filter(keyword: string, container: HTMLElement) {
        this.searchKeyword = keyword.trim();
        if (this.searchTimer !== null) { clearTimeout(this.searchTimer); }
        this.searchTimer = window.setTimeout(async () => {
            const result = await SessionStore.list({page: 1, pageSize: 30, keyword: this.searchKeyword});
            this.items = result.sessions;
            this.total = result.total;
            this.page = 1;
            this.searchTimer = null;
            this.renderItems(container, result.sessions, false);
            container.scrollTop = 0;
            this.highlightCurrent();
        }, 300);
    }

    private startRename(id: string, rowEl: HTMLElement) {
        const titleEl = rowEl.querySelector(".b3-menu__label") as HTMLElement;
        const oldTitle = titleEl.textContent || "";
        const input = document.createElement("input");
        input.type = "text";
        input.value = oldTitle;
        input.className = "agent-session-popup__rename-input";
        titleEl.replaceWith(input);
        input.focus();
        input.select();
        input.addEventListener("blur", () => { this.finishRename(id, input.value, input, titleEl); });
        input.addEventListener("keydown", (e: KeyboardEvent) => {
            if (e.key === "Enter") { input.blur(); }
            if (e.key === "Escape") { input.value = oldTitle; input.blur(); }
        });
    }

    private async finishRename(id: string, newTitle: string, input: HTMLInputElement, titleEl: HTMLElement) {
        const title = newTitle.trim() || this.getDefaultTitle();
        input.replaceWith(titleEl);
        titleEl.textContent = title;
        await this.callbacks.onRename(id, title);
        const listItem = this.items.find((s) => s.id === id);
        if (listItem) { listItem.title = title; }
    }

    private highlightCurrent() {
        const items = this.popup?.querySelectorAll(".b3-menu__item");
        if (!items) { return; }
        const currentId = this.getCurrentSessionId();
        for (let i = 0; i < items.length; i++) {
            const item = items[i] as HTMLElement;
            const sid = item.getAttribute("data-id");
            item.classList.toggle("b3-menu__item--current", sid === currentId);
        }
    }

    // 跨实例会话变更（ws agentSessionChanged）时由 AgentChat.onWsMessage 调用，刷新已打开的列表。
    // popup 未打开时直接返回（下次 toggle/render 会拉取最新数据），避免无谓请求。
    async refresh() {
        const itemsContainer = this.popup?.querySelector(".b3-menu__items") as HTMLElement;
        if (!itemsContainer) { return; }
        const result = await SessionStore.list({page: 1, pageSize: 30, keyword: this.searchKeyword});
        this.items = result.sessions;
        this.total = result.total;
        this.page = 1;
        this.renderItems(itemsContainer, result.sessions, false);
    }
}
