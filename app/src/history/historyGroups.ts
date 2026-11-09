import type {APIPOSTRoutes} from "../types/api";

type HistoryItems = Extract<APIPOSTRoutes["/api/history/getHistoryItems"]["response"], {code: 0}>["data"];
type HistoryFilter = Omit<APIPOSTRoutes["/api/history/getHistoryItems"]["request"], "created" | "page">;
type Group = {
    list: HTMLElement;
    tail: HTMLElement;
    button: HTMLButtonElement;
    page: number;
    pageCount: number;
    loading: boolean;
    failed: boolean;
};

export class HistoryGroups {
    private groups = new Map<HTMLElement, Group>();
    private abort = new AbortController();

    constructor(private root: HTMLElement, private filter: HistoryFilter, private options: {
        load: (request: HistoryFilter & {created: string, page: number}, signal: AbortSignal) => Promise<HistoryItems>;
        render: (items: HistoryItems["items"], created: string) => string;
        more: string;
        retry: string;
    }) {
        root.addEventListener("scroll", this.refresh, {passive: true});
    }

    destroy() {
        this.abort.abort();
        this.root.removeEventListener("scroll", this.refresh);
        this.groups.clear();
    }

    toggle(row: HTMLElement) {
        const arrow = row.querySelector(".b3-list-item__arrow");
        let group = this.groups.get(row);
        if (group) {
            const closed = group.list.classList.toggle("fn__none");
            arrow.classList.toggle("b3-list-item__arrow--open", !closed);
            if (!closed) {
                if (group.failed) {
                    void this.load(row, group);
                } else {
                    this.refresh();
                }
            }
            return;
        }
        const list = document.createElement("ul");
        const tail = document.createElement("li");
        tail.className = "b3-list-item";
        const button = document.createElement("button");
        button.type = "button";
        button.className = "b3-button b3-button--text";
        button.textContent = this.options.more;
        tail.append(button);
        list.append(tail);
        row.after(list);
        arrow.classList.add("b3-list-item__arrow--open");
        group = {list, tail, button, page: 0, pageCount: 1, loading: false, failed: false};
        this.groups.set(row, group);
        button.addEventListener("click", event => {
            event.stopPropagation();
            void this.load(row, group);
        });
        void this.load(row, group);
    }

    refresh = () => {
        if (this.abort.signal.aborted || !this.root.isConnected || this.root.getClientRects().length === 0) {
            return;
        }
        const viewport = this.root.getBoundingClientRect();
        for (const [row, group] of this.groups) {
            if (group.loading || group.failed || group.page >= group.pageCount || group.list.classList.contains("fn__none")) {
                continue;
            }
            const bounds = group.tail.getBoundingClientRect();
            if (bounds.bottom >= viewport.top && bounds.top <= viewport.bottom + 80) {
                void this.load(row, group);
            }
        }
    };

    private async load(row: HTMLElement, group: Group) {
        if (this.abort.signal.aborted || group.loading || group.page >= group.pageCount) {
            return;
        }
        group.loading = true;
        group.failed = false;
        group.button.disabled = true;
        const created = row.dataset.created;
        try {
            const data = await this.options.load({...this.filter, created, page: group.page + 1}, this.abort.signal);
            if (this.abort.signal.aborted || !row.isConnected) {
                return;
            }
            group.tail.insertAdjacentHTML("beforebegin", this.options.render(data.items, created));
            group.page++;
            group.pageCount = data.pageCount;
            row.querySelector(".counter").textContent = String(data.totalCount);
            group.tail.classList.toggle("fn__none", group.page >= group.pageCount);
            group.button.textContent = this.options.more;
        } catch (error) {
            if (!this.abort.signal.aborted) {
                group.failed = true;
                group.button.textContent = this.options.retry;
                console.warn("Load history items failed", error);
            }
        } finally {
            group.loading = false;
            group.button.disabled = false;
        }
        this.refresh();
    }
}
