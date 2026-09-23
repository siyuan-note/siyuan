import type {AVTableRow} from "../../../../types/api";
import {fetchSyncPost} from "../../../../util/fetch";
import {escapeAttr, escapeHtml} from "../../../../util/escape";
import {calendarDayDistance} from "./date";
import {getCalendarDropDay} from "./hitTest";
import type {ICalendarState} from "./state";

const PAGE_SIZE = 50;

const toUndatedRow = (source: AVTableRow, dateKeyID: string): IAVRow | undefined => {
    const primary = source.cells?.find(cell => cell?.value?.type === "block");
    const date = source.cells?.find(cell => cell?.value?.type === "date" && cell.value.keyID === dateKeyID);
    if (!primary?.value?.block || !date?.value) {
        return;
    }
    return {id: source.id, cells: [
        {id: primary.id, valueType: "block", value: {id: primary.value.id, type: "block", isDetached: primary.value.isDetached,
            block: {content: primary.value.block.content, id: primary.value.block.id, icon: primary.value.block.icon}}},
        {id: date.id, valueType: "date", value: {id: date.value.id, keyID: dateKeyID, type: "date", date: date.value.date || {}}},
    ]};
};

export const getCalendarUndatedHTML = (state: ICalendarState) => `<div class="b3-menu av__calendar-undated-panel${state.undatedOpen ? "" : " fn__none"}" data-calendar-undated-panel role="dialog" aria-label="${escapeAttr(window.siyuan.languages.calendarUndated)}">
    <div class="av__calendar-undated-head"><strong>${escapeHtml(window.siyuan.languages.calendarUndated)}</strong><span data-calendar-undated-count></span>
        <button type="button" class="block__icon block__icon--show" data-calendar-undated-close aria-label="${escapeAttr(window.siyuan.languages.close)}"><svg><use xlink:href="#iconClose"></use></svg></button>
    </div>
    <div class="av__calendar-undated-search"><input type="search" class="b3-text-field" data-calendar-undated-search aria-label="${escapeAttr(window.siyuan.languages.search)}" placeholder="${escapeAttr(window.siyuan.languages.searchPlaceholder)}" value="${escapeAttr(state.undatedSearch)}"></div>
    <div class="av__calendar-undated-hint ft__on-surface">${escapeHtml(window.siyuan.languages.calendarUndatedHint)}</div>
    <div class="b3-menu__items av__calendar-undated-list" data-calendar-undated-list></div>
    <button type="button" class="b3-button b3-button--cancel av__calendar-undated-more fn__none" data-calendar-undated-more>${escapeHtml(window.siyuan.languages.loadMore)}</button>
</div>`;

export const bindCalendarUndated = (options: {
    root: HTMLElement;
    blockElement: HTMLElement;
    data: IAV;
    state: ICalendarState;
    query: string;
    onOpen: (row: IAVRow) => void;
    onSchedule: (row: IAVRow, cell: IAVCell, day: number, onUpdated: () => void) => void;
}) => {
    const {root, blockElement, data, state, query, onOpen, onSchedule} = options;
    const panel = root.querySelector<HTMLElement>("[data-calendar-undated-panel]");
    const toggle = blockElement.querySelector<HTMLButtonElement>("[data-calendar-undated-toggle]");
    const search = panel.querySelector<HTMLInputElement>("[data-calendar-undated-search]");
    const list = panel.querySelector<HTMLElement>("[data-calendar-undated-list]");
    const count = panel.querySelector<HTMLElement>("[data-calendar-undated-count]");
    const more = panel.querySelector<HTMLButtonElement>("[data-calendar-undated-more]");
    const dateKeyID = (data.view as IAVTable).calendar.dateKeyID;
    let rows: IAVRow[] = [];
    let total = 0;
    let page = 0;
    let selectedID = "";
    let loading = false;
    let request: AbortController;
    let searchTimer: number;
    let suppressClick = false;

    const updateSelection = () => {
        list.querySelectorAll<HTMLElement>("[data-calendar-undated-row]").forEach(item => {
            const selected = item.dataset.calendarUndatedRow === selectedID;
            item.classList.toggle("av__calendar-undated-item--selected", selected);
            item.setAttribute("aria-pressed", selected.toString());
        });
    };
    const renderRows = () => {
        count.textContent = `(${total})`;
        list.innerHTML = rows.length ? rows.map(row => {
            const primary = row.cells.find(cell => cell.value?.type === "block")?.value;
            const title = primary?.block?.content || window.siyuan.languages.untitled;
            return `<div class="b3-menu__item av__calendar-undated-item" role="button" tabindex="0" aria-pressed="false" data-calendar-undated-row="${escapeAttr(row.id)}"><svg class="b3-menu__icon"><use xlink:href="#iconFile"></use></svg><span class="b3-menu__label fn__ellipsis">${escapeHtml(title)}</span><button type="button" class="block__icon block__icon--show" data-calendar-undated-open="${escapeAttr(row.id)}" aria-label="${escapeAttr(window.siyuan.languages.open)}"><svg><use xlink:href="#iconOpen"></use></svg></button></div>`;
        }).join("") : `<div class="av__calendar-undated-empty ft__on-surface">${escapeHtml(window.siyuan.languages.empty)}</div>`;
        more.classList.toggle("fn__none", page * PAGE_SIZE >= total);
        updateSelection();
    };
    const load = async (reset = false) => {
        if (!root.isConnected || !state.undatedOpen) {
            return;
        }
        if (reset) {
            request?.abort();
            rows = [];
            page = 0;
            selectedID = "";
        } else if (loading) {
            return;
        }
        const nextPage = page + 1;
        const controller = new AbortController();
        request = controller;
        loading = true;
        more.classList.add("fn__none");
        if (reset) {
            list.innerHTML = `<div class="av__calendar-undated-empty ft__on-surface">${escapeHtml(window.siyuan.languages.loading)}</div>`;
        }
        try {
            const response = await fetchSyncPost("/api/av/getAttributeViewCalendarUndated", {
                id: data.id, blockID: blockElement.dataset.nodeId || "", viewID: data.viewID,
                query: query.trim(), search: state.undatedSearch.trim(), page: nextPage, pageSize: PAGE_SIZE,
            }, undefined, false, controller.signal);
            if (controller.signal.aborted || !root.isConnected) {
                return;
            }
            if (response.code !== 0 || !response.data) {
                throw new Error(response.msg || "");
            }
            const nextRows = (response.data.rows || []).filter((row): row is AVTableRow => !!row)
                .map(row => toUndatedRow(row, dateKeyID)).filter((row): row is IAVRow => !!row);
            rows.push(...nextRows);
            page = nextPage;
            total = response.data.total;
            renderRows();
        } catch {
            if (!controller.signal.aborted && root.isConnected) {
                list.innerHTML = `<button type="button" class="b3-button b3-button--cancel av__calendar-undated-retry" data-calendar-undated-retry>${escapeHtml(window.siyuan.languages.retry)}</button>`;
            }
        } finally {
            if (request === controller) {
                loading = false;
            }
        }
    };
    const setOpen = (open: boolean, focusSearch = false) => {
        state.undatedOpen = open;
        panel.classList.toggle("fn__none", !open);
        root.classList.toggle("av__calendar--undated-open", open);
        toggle.setAttribute("aria-expanded", open.toString());
        root.querySelectorAll<HTMLElement>("[data-calendar-day]").forEach(day => {
            if (open) {
                day.tabIndex = 0;
                day.setAttribute("role", "button");
                day.setAttribute("aria-label", new Date(Number(day.dataset.calendarDay)).toLocaleDateString(window.siyuan.config.lang));
            } else {
                day.removeAttribute("tabindex");
                day.removeAttribute("role");
                day.removeAttribute("aria-label");
            }
        });
        if (open) {
            void load(true);
            if (focusSearch) {
                search.focus();
            }
        } else {
            clearTimeout(searchTimer);
            request?.abort();
            selectedID = "";
            if (focusSearch) {
                toggle.focus();
            }
        }
    };
    const schedule = (rowID: string, day: number) => {
        const row = rows.find(item => item.id === rowID);
        const cell = row?.cells.find(item => item.value?.type === "date" && item.value.keyID === dateKeyID);
        const year = new Date(day).getFullYear();
        if (!row || !cell?.value || year < 1 || year > 9999) {
            return;
        }
        onSchedule(row, cell, day, () => {
            if (root.isConnected && state.undatedOpen) {
                void load(true);
            }
        });
        rows = rows.filter(item => item.id !== rowID);
        total = Math.max(0, total - 1);
        selectedID = "";
        renderRows();
    };
    const clearPreview = () => {
        root.querySelectorAll(".av__calendar-undated-preview-layer").forEach(layer => layer.remove());
    };
    const preview = (day?: number) => {
        clearPreview();
        root.classList.toggle("av__calendar--invalid", day === undefined);
        if (day === undefined) {
            return;
        }
        for (const week of root.querySelectorAll<HTMLElement>("[data-calendar-week]")) {
            const column = calendarDayDistance(Number(week.dataset.calendarWeek), day);
            if (column < 0 || column > 6) {
                continue;
            }
            const layer = document.createElement("div");
            layer.className = "av__calendar-preview-layer av__calendar-undated-preview-layer";
            layer.innerHTML = `<div class="av__calendar-drop" style="left:${column * 100 / 7}%;width:${100 / 7}%"></div>`;
            week.append(layer);
            break;
        }
    };
    const dropDay = (x: number, y: number) => {
        const rect = panel.getBoundingClientRect();
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
            return;
        }
        return getCalendarDropDay(root, x, y);
    };

    toggle.addEventListener("click", event => {
        event.stopPropagation();
        setOpen(!state.undatedOpen, true);
    });
    panel.querySelector("[data-calendar-undated-close]").addEventListener("click", () => setOpen(false, true));
    more.addEventListener("click", () => { void load(); });
    search.addEventListener("input", () => {
        state.undatedSearch = search.value;
        clearTimeout(searchTimer);
        searchTimer = window.setTimeout(() => { void load(true); }, 200);
    });
    panel.addEventListener("click", event => {
        event.stopPropagation();
        const target = event.target as HTMLElement;
        if (target.closest("[data-calendar-undated-retry]")) {
            void load(page === 0);
            return;
        }
        const open = target.closest<HTMLElement>("[data-calendar-undated-open]");
        if (open) {
            const row = rows.find(item => item.id === open.dataset.calendarUndatedOpen);
            if (row) {
                onOpen(row);
            }
            return;
        }
        const item = target.closest<HTMLElement>("[data-calendar-undated-row]");
        if (item && !suppressClick) {
            selectedID = selectedID === item.dataset.calendarUndatedRow ? "" : item.dataset.calendarUndatedRow;
            updateSelection();
        }
    });
    panel.addEventListener("keydown", event => {
        if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false, true);
        } else if ((event.key === "Enter" || event.key === " ") &&
            (event.target as HTMLElement).matches("[data-calendar-undated-row]")) {
            event.preventDefault();
            (event.target as HTMLElement).click();
        }
    });
    root.addEventListener("click", event => {
        if (!selectedID || !state.undatedOpen) {
            return;
        }
        const day = (event.target as HTMLElement).closest<HTMLElement>("[data-calendar-day]");
        if (day) {
            event.preventDefault();
            event.stopImmediatePropagation();
            schedule(selectedID, Number(day.dataset.calendarDay));
        }
    }, true);
    root.addEventListener("keydown", event => {
        if ((event.key !== "Enter" && event.key !== " ") || !selectedID || !state.undatedOpen) {
            return;
        }
        const day = (event.target as HTMLElement).closest<HTMLElement>("[data-calendar-day]");
        if (day) {
            event.preventDefault();
            event.stopImmediatePropagation();
            schedule(selectedID, Number(day.dataset.calendarDay));
        }
    }, true);
    root.addEventListener("click", event => {
        if (suppressClick) {
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    }, true);
    panel.addEventListener("pointerdown", event => {
        const item = (event.target as HTMLElement).closest<HTMLElement>("[data-calendar-undated-row]");
        if (event.button !== 0 || event.pointerType === "touch" || !item ||
            (event.target as HTMLElement).closest("[data-calendar-undated-open]")) {
            return;
        }
        const controller = new AbortController();
        let dragging = false;
        let destination: number;
        const clean = () => {
            controller.abort();
            clearPreview();
            root.classList.remove("av__calendar--dragging", "av__calendar--invalid");
            item.classList.remove("av__calendar-item--dragging");
            if (dragging) {
                suppressClick = true;
                setTimeout(() => { suppressClick = false; });
            }
        };
        document.addEventListener("pointermove", move => {
            if (move.pointerId !== event.pointerId) {
                return;
            }
            if (!root.isConnected) {
                clean();
                return;
            }
            if (!dragging && Math.hypot(move.clientX - event.clientX, move.clientY - event.clientY) < 5) {
                return;
            }
            move.preventDefault();
            dragging = true;
            root.classList.add("av__calendar--dragging");
            item.classList.add("av__calendar-item--dragging");
            destination = dropDay(move.clientX, move.clientY);
            preview(destination);
        }, {signal: controller.signal, passive: false});
        document.addEventListener("pointerup", up => {
            if (up.pointerId !== event.pointerId) {
                return;
            }
            destination = dropDay(up.clientX, up.clientY);
            if (dragging && root.isConnected && destination !== undefined) {
                schedule(item.dataset.calendarUndatedRow, destination);
            }
            clean();
        }, {signal: controller.signal});
        document.addEventListener("pointercancel", cancel => {
            if (cancel.pointerId === event.pointerId) {
                clean();
            }
        }, {signal: controller.signal});
        window.addEventListener("blur", clean, {signal: controller.signal});
        document.addEventListener("keydown", key => {
            if (key.key === "Escape") {
                key.preventDefault();
                clean();
            }
        }, {signal: controller.signal, capture: true});
    });
    if (state.undatedOpen) {
        setOpen(true);
    }
};
