import {SessionIndexItem, SessionStore} from "./SessionStore";
import {escapeHtml} from "../../../util/escape";
import {setPosition} from "../../../util/setPosition";
import {hasClosestByClassName} from "../../../protyle/util/hasClosest";
import {upDownHint} from "../../../util/upDownHint";
/// #if !BROWSER
import * as path from "path";
import {useShell} from "../../../util/pathName";

/// #endif

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
    ) {
    }

    toggle() {
        if (this.isRendering) {
            return;
        }
        if (this.popup) {
            this.close();
            return;
        }
        this.render();
    }

    close() {
        this.closeMoreMenu();
        document.querySelectorAll(".agent-session-popup").forEach(function (el) {
            el.remove();
        });
        this.popup = null;
        this.searchKeyword = "";
        this.items = [];
        this.total = 0;
        this.page = 0;
        if (this.searchTimer !== null) {
            clearTimeout(this.searchTimer);
            this.searchTimer = null;
        }
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
            html += '<div class="b3-list b3-list--background fn__flex-1"></div>';

            this.popup.innerHTML = html;

            const itemsContainer = this.popup.querySelector(".b3-list") as HTMLElement;
            this.renderItems(itemsContainer, result.sessions, false);
            const searchInput = this.popup.querySelector(".agent-session-popup__search") as HTMLInputElement;
            searchInput.addEventListener("input", (event: InputEvent) => {
                event.stopPropagation();
                if (event.isComposing) {
                    return;
                }
                this.filter(searchInput.value, itemsContainer);
            });
            searchInput.addEventListener("compositionend", () => {
                this.filter(searchInput.value, itemsContainer);
            });
            searchInput.addEventListener("keydown", (event) => {
                if (event.isComposing) {
                    return;
                }
                upDownHint(itemsContainer, event);
            });
            itemsContainer.addEventListener("scroll", () => {
                if (this.isLoadingMore) {
                    return;
                }
                if (this.items.length >= this.total) {
                    return;
                }
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
            const onResize = () => {
                this.close();
            };
            window.addEventListener("resize", onResize);
            const closeOut = () => {
                this.close();
                document.removeEventListener("click", closeOut);
                window.removeEventListener("resize", onResize);
            };
            setTimeout(() => {
                document.addEventListener("click", closeOut);
            }, 10);
            searchInput.focus();
        } finally {
            this.isRendering = false;
        }
    }

    private renderItems(container: HTMLElement, listItems: SessionIndexItem[], append: boolean) {
        let html = "";
        if (listItems.length === 0 && !append) {
            html += '<div class="b3-list--empty"><span class="b3-list-item__text">' + (window.siyuan.languages.emptyContent) + "</span></div>";
        } else {
            const currentId = this.getCurrentSessionId();
            const defaultTitle = this.getDefaultTitle();
            for (let i = 0; i < listItems.length; i++) {
                const s = listItems[i];
                const isActive = s.id === currentId;
                html += '<div class="b3-list-item  b3-list-item--hide-action' + (isActive ? " b3-list-item--focus" : "") + '" data-id="' + s.id + '">' +
                    '<span class="b3-list-item__text ariaLabel" data-position="parentW" aria-label="' + escapeHtml(s.title || defaultTitle) + '">' + escapeHtml(s.title || defaultTitle) + "</span>" +
                    '<span class="b3-list-item__action b3-tooltips b3-tooltips__nw" data-id="' + s.id + '" aria-label="' + window.siyuan.languages.rename + '"><svg><use xlink:href="#iconEdit"></use></svg></span>' +
                    '<span class="b3-list-item__action b3-tooltips b3-tooltips__nw agent-session-more" data-id="' + s.id + '" aria-label="' + (window.siyuan.languages.method || "More") + '"><svg><use xlink:href="#iconMore"></use></svg></span>' +
                    "</div>";
            }
        }
        if (append) {
            container.insertAdjacentHTML("beforeend", html);
        } else {
            container.innerHTML = html;
        }
        if (!container.querySelector(".b3-list-item--focus, .b3-list--empty")) {
            container.firstElementChild.classList.add("b3-list-item--focus");
        }
        this.bindEvents(container);
        this.highlightCurrent();
    }

    private bindEvents(container: HTMLElement) {
        if (container.dataset.eventsBound) {
            return;
        }
        container.dataset.eventsBound = "1";

        container.addEventListener("click", (e: MouseEvent) => {
            const target = e.target as HTMLElement;

            const actionBtn = hasClosestByClassName(target, "b3-list-item__action");
            if (actionBtn) {
                // "更多"按钮：弹出文件夹（桌面端）和删除操作。
                if (actionBtn.classList.contains("agent-session-more")) {
                    e.stopPropagation();
                    const id = (actionBtn as HTMLElement).getAttribute("data-id") || "";
                    if (id) {
                        this.showMoreMenu(actionBtn as HTMLElement, id);
                    }
                    return;
                }
                e.stopPropagation();
                const id = (actionBtn as HTMLElement).getAttribute("data-id") || "";
                if (id) {
                    this.startRename(id, actionBtn.parentElement);
                }
                return;
            }

            if (hasClosestByClassName(target, "b3-text-field")) {
                return;
            }

            const item = hasClosestByClassName(target, "b3-list-item");
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
        if (this.isLoadingMore) {
            return;
        }
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
        if (this.searchTimer !== null) {
            clearTimeout(this.searchTimer);
        }
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
        const titleEl = rowEl.querySelector(".b3-list-item__text") as HTMLElement;
        const oldTitle = titleEl.textContent || "";
        const input = document.createElement("input");
        input.type = "text";
        input.value = oldTitle;
        input.className = "b3-text-field b3-text-field--small fn__flex-1";
        titleEl.replaceWith(input);
        input.focus();
        input.select();
        input.addEventListener("blur", () => {
            this.finishRename(id, input.value, input, titleEl);
        });
        input.addEventListener("keydown", (e: KeyboardEvent) => {
            if (e.key === "Enter") {
                input.blur();
            }
            if (e.key === "Escape") {
                input.value = oldTitle;
                input.blur();
            }
        });
    }

    private async finishRename(id: string, newTitle: string, input: HTMLInputElement, titleEl: HTMLElement) {
        const title = newTitle.trim() || this.getDefaultTitle();
        input.replaceWith(titleEl);
        titleEl.textContent = title;
        await this.callbacks.onRename(id, title);
        const listItem = this.items.find((s) => s.id === id);
        if (listItem) {
            listItem.title = title;
        }
    }

    private highlightCurrent() {
        const items = this.popup?.querySelectorAll(".b3-list-item");
        if (!items) {
            return;
        }
        this.popup.querySelector(".b3-menu__checked")?.remove();
        const currentId = this.getCurrentSessionId();
        for (let i = 0; i < items.length; i++) {
            if (items[i].getAttribute("data-id") === currentId) {
                items[i].insertAdjacentHTML("beforeend", '<svg class="b3-menu__checked"><use xlink:href="#iconSelect"></use></svg>');
                break;
            }
        }
    }

    // 跨实例会话变更（ws agentSessionChanged）时由 AgentChat.onWsMessage 调用，刷新已打开的列表。
    // popup 未打开时直接返回（下次 toggle/render 会拉取最新数据），避免无谓请求。
    async refresh() {
        const itemsContainer = this.popup?.querySelector(".b3-list") as HTMLElement;
        if (!itemsContainer) {
            return;
        }
        const result = await SessionStore.list({page: 1, pageSize: 30, keyword: this.searchKeyword});
        this.items = result.sessions;
        this.total = result.total;
        this.page = 1;
        this.renderItems(itemsContainer, result.sessions, false);
    }

    // 会话条目的"更多"菜单：桌面端显示"打开文件位置"和"删除"两项。
    private moreMenu: HTMLElement | null = null;
    private moreMenuCleanup: (() => void) | null = null;

    private showMoreMenu(anchor: HTMLElement, id: string) {
        this.closeMoreMenu();
        let isDesktop = false;
        /// #if !BROWSER
        isDesktop = true;
        /// #endif
        const L = window.siyuan.languages;
        const menu = document.createElement("div");
        menu.className = "b3-menu agent-session-more-menu";
        let html = "";
        if (isDesktop) {
            html += '<button class="b3-menu__item" data-action="folder"><svg class="b3-menu__icon"><use xlink:href="#iconFolder"></use></svg><span class="b3-menu__label">' + escapeHtml(L.showInFolder) + "</span></button>";
        }
        html += '<button class="b3-menu__item b3-menu__item--warning" data-action="delete"><svg class="b3-menu__icon"><use xlink:href="#iconTrashcan"></use></svg><span class="b3-menu__label">' + escapeHtml(L.delete) + "</span></button>";
        menu.innerHTML = html;
        menu.addEventListener("click", (e: MouseEvent) => {
            const btn = hasClosestByClassName(e.target as HTMLElement, "b3-menu__item");
            if (!btn) { return; }
            const action = btn.getAttribute("data-action");
            if (action === "delete") {
                this.callbacks.onDelete(id).then(() => {
                    this.refresh();
                });
            }
            if (action === "folder") {
                /// #if !BROWSER
                useShell("openPath", path.join(window.siyuan.config.system.dataDir, "storage", "ai", "agent", "sessions", id));
                /// #endif
            }
            this.closeMoreMenu();
        });
        // 悬浮效果：mouseenter 添加 --current，鼠标移出菜单后清除（与 SiYuan Menu 组件一致）。
        menu.querySelectorAll(".b3-menu__item").forEach((item) => {
            item.addEventListener("mouseenter", () => {
                menu.querySelectorAll(".b3-menu__item--current").forEach((el) => {
                    el.classList.remove("b3-menu__item--current");
                });
                item.classList.add("b3-menu__item--current");
            });
        });
        menu.addEventListener("mouseleave", () => {
            menu.querySelectorAll(".b3-menu__item--current").forEach((el) => {
                el.classList.remove("b3-menu__item--current");
            });
        });
        const onOutside = (e: MouseEvent) => {
            if (menu.contains(e.target as Node)) {
                return;
            }
            this.closeMoreMenu();
        };
        document.addEventListener("mousedown", onOutside, {once: true});
        this.moreMenuCleanup = () => document.removeEventListener("mousedown", onOutside);
        this.moreMenu = menu;
        document.body.appendChild(menu);
        menu.style.zIndex = (++window.siyuan.zIndex).toString();
        const btnRect = anchor.getBoundingClientRect();
        setPosition(menu, btnRect.right - 8, btnRect.top - 8, btnRect.height);
    }

    private closeMoreMenu() {
        if (this.moreMenu) {
            this.moreMenu.remove();
            this.moreMenu = null;
        }
        if (this.moreMenuCleanup) {
            this.moreMenuCleanup();
            this.moreMenuCleanup = null;
        }
    }
}
