import type {AVTableRow} from "../../../../types/api";
import {Constants} from "../../../../constants";
import {fetchSyncPost} from "../../../../util/fetch";
import {escapeAttr, escapeHtml} from "../../../../util/escape";
import {isMobile} from "../../../../util/functions";
import {calendarDayDistance} from "./date";
import {getCalendarDropDay} from "./hitTest";
import type {ICalendarState} from "./state";

const PAGE_SIZE = 50;
const dismissControllers = new WeakMap<ICalendarState, AbortController>();

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
    <div class="av__calendar-undated-head"><span class="b3-menu__label">${escapeHtml(window.siyuan.languages.calendarUndated)}</span><span class="counter ${isMobile() ? "counter--compact" : "counter--bg"} fn__none" data-calendar-undated-count></span></div>
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
    const toggle = root.querySelector<HTMLButtonElement>("[data-calendar-undated-toggle]");
    const search = panel.querySelector<HTMLInputElement>("[data-calendar-undated-search]");
    const list = panel.querySelector<HTMLElement>("[data-calendar-undated-list]");
    const count = panel.querySelector<HTMLElement>("[data-calendar-undated-count]");
    const more = panel.querySelector<HTMLButtonElement>("[data-calendar-undated-more]");
    const dateKeyID = (data.view as IAVTable).calendar.dateKeyID;
    const mobile = isMobile();
    const normalizedQuery = query.trim();
    const cache = state.undatedCache?.dateKeyID === dateKeyID && state.undatedCache.query === normalizedQuery &&
        state.undatedCache.search === state.undatedSearch.trim() ? state.undatedCache : undefined;
    let rows: IAVRow[] = cache ? [...cache.rows] : [];
    let total = cache?.total || 0;
    let page = cache?.page || 0;
    let hasResult = !!cache;
    let selectedID = cache?.rows.some(row => row.id === state.undatedSelectedID) ? state.undatedSelectedID : "";
    state.undatedSelectedID = selectedID;
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
    const updateDayTargets = () => {
        const active = state.undatedOpen || !!selectedID;
        root.classList.toggle("av__calendar--undated-open", active);
        root.querySelectorAll<HTMLElement>("[data-calendar-day]").forEach(day => {
            if (active) {
                day.tabIndex = 0;
                day.setAttribute("role", "button");
                day.setAttribute("aria-label", new Date(Number(day.dataset.calendarDay)).toLocaleDateString(window.siyuan.config.lang));
            } else {
                day.removeAttribute("tabindex");
                day.removeAttribute("role");
                day.removeAttribute("aria-label");
            }
        });
    };
    const renderRows = () => {
        state.undatedCache = {dateKeyID, query: normalizedQuery, search: state.undatedSearch.trim(), rows: [...rows], total, page};
        count.textContent = total.toString();
        count.classList.remove("fn__none");
        const rowHTML = rows.map(row => {
            const primary = row.cells.find(cell => cell.value?.type === "block")?.value;
            const title = primary?.block?.content || window.siyuan.languages.untitled;
            const previewID = primary?.isDetached ? "" : primary?.block?.id;
            return `<div class="b3-menu__item av__calendar-undated-item" role="button" tabindex="0" aria-pressed="false" data-calendar-undated-row="${escapeAttr(row.id)}"><svg class="b3-menu__icon${previewID ? " popover__block" : ""}"${previewID ? ` data-id="${escapeAttr(previewID)}"` : ""}><use xlink:href="#iconFile"></use></svg><span class="b3-menu__label fn__ellipsis"><span${previewID ? ' class="av__celltext--ref"' : ""}>${escapeHtml(title)}</span></span><button type="button" class="block__icon block__icon--show ariaLabel" data-calendar-undated-open="${escapeAttr(row.id)}" data-position="4west" aria-label="${escapeAttr(window.siyuan.languages.openBy)}"><svg><use xlink:href="#iconOpen"></use></svg></button></div>`;
        }).join("");
        list.innerHTML = rows.length ? mobile ? `<div class="b3-menu__group-items">${rowHTML}</div>` : rowHTML :
            `<div class="av__calendar-undated-empty ft__on-surface">${escapeHtml(window.siyuan.languages.empty)}</div>`;
        more.classList.toggle("fn__none", page * PAGE_SIZE >= total);
        updateSelection();
        hasResult = true;
    };
    const load = async (reset = false) => {
        if (!root.isConnected || !state.undatedOpen) {
            return;
        }
        if (reset) {
            request?.abort();
            selectedID = "";
            state.undatedSelectedID = "";
            updateDayTargets();
        } else if (loading) {
            return;
        }
        const nextPage = reset ? 1 : page + 1;
        const controller = new AbortController();
        const searchValue = state.undatedSearch.trim();
        request = controller;
        loading = true;
        more.classList.add("fn__none");
        if (reset && !hasResult) {
            list.innerHTML = `<div class="av__calendar-undated-empty ft__on-surface">${escapeHtml(window.siyuan.languages.loading)}</div>`;
        }
        try {
            const response = await fetchSyncPost("/api/av/getAttributeViewCalendarUndated", {
                id: data.id, blockID: blockElement.dataset.nodeId || "", viewID: data.viewID,
                query: normalizedQuery, search: searchValue, page: nextPage, pageSize: PAGE_SIZE,
            }, undefined, false, controller.signal);
            if (controller.signal.aborted || !root.isConnected || searchValue !== state.undatedSearch.trim()) {
                return;
            }
            if (response.code !== 0 || !response.data) {
                throw new Error(response.msg || "");
            }
            const nextRows = (response.data.rows || []).filter((row): row is AVTableRow => !!row)
                .map(row => toUndatedRow(row, dateKeyID)).filter((row): row is IAVRow => !!row);
            rows = reset ? nextRows : [...rows, ...nextRows];
            page = nextPage;
            total = response.data.total;
            renderRows();
        } catch {
            if (!controller.signal.aborted && root.isConnected && searchValue === state.undatedSearch.trim()) {
                list.innerHTML = `<button type="button" class="b3-button b3-button--cancel av__calendar-undated-retry" data-calendar-undated-retry>${escapeHtml(window.siyuan.languages.retry)}</button>`;
            }
        } finally {
            if (request === controller) {
                loading = false;
            }
        }
    };
    let keepMobileSelection = false;
    const setOpen = (open: boolean, focusSearch = false) => {
        const menu = mobile ? window.siyuan.menus.menu : undefined;
        if (!open && mobile && menu.element.lastElementChild.contains(panel)) {
            menu.closeSheet();
            return;
        }
        if (open && mobile) {
            menu.remove();
        }
        dismissControllers.get(state)?.abort();
        dismissControllers.delete(state);
        state.undatedOpen = open;
        panel.classList.toggle("fn__none", !open);
        toggle.setAttribute("aria-expanded", open.toString());
        updateDayTargets();
        if (open) {
            if (mobile) {
                panel.classList.remove("b3-menu");
                list.classList.remove("b3-menu__items");
                list.classList.add("b3-menu__groups");
                menu.append(panel);
                menu.removeCB = () => {
                    panel.classList.add("fn__none");
                    if (root.isConnected) {
                        root.querySelector(".av__calendar-scroll")?.before(panel);
                    } else {
                        panel.remove();
                    }
                    if (!keepMobileSelection) {
                        selectedID = "";
                        state.undatedSelectedID = "";
                    }
                    keepMobileSelection = false;
                    setOpen(false);
                };
                menu.fullscreen("bottom");
            } else {
                const dismissController = new AbortController();
                dismissControllers.set(state, dismissController);
                document.addEventListener("pointerdown", event => {
                    const target = event.target as HTMLElement;
                    if (panel.contains(target) || toggle.contains(target) ||
                        selectedID && target.closest("[data-calendar-day]")) {
                        return;
                    }
                    setOpen(false);
                }, {signal: dismissController.signal, capture: true});
            }
            void load(true);
            if (focusSearch && !mobile) {
                search.focus();
            }
        } else {
            clearTimeout(searchTimer);
            request?.abort();
            if (!mobile) {
                selectedID = "";
                state.undatedSelectedID = "";
                updateDayTargets();
            }
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
            return false;
        }
        const closeMobileSheet = mobile && state.undatedOpen;
        if (closeMobileSheet) {
            state.undatedOpen = false;
        }
        request?.abort();
        onSchedule(row, cell, day, () => {
            if (root.isConnected && state.undatedOpen) {
                void load(true);
            }
        });
        rows = rows.filter(item => item.id !== rowID);
        total = Math.max(0, total - 1);
        selectedID = "";
        state.undatedSelectedID = "";
        updateDayTargets();
        renderRows();
        if (closeMobileSheet) {
            window.siyuan.menus.menu.closeSheet();
        }
        return true;
    };
    const clearPreview = () => {
        root.querySelectorAll(".av__calendar-undated-preview-layer").forEach(layer => layer.remove());
    };
    let previewed = false;
    let previewDay: number | undefined;
    const preview = (day?: number) => {
        if (previewed && day === previewDay) {
            return;
        }
        previewed = true;
        previewDay = day;
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
    let dragPreview = false;
    const setDragPreview = (active: boolean) => {
        dragPreview = active;
        if (mobile) {
            if (window.siyuan.menus.menu.element.lastElementChild.contains(panel)) {
                window.siyuan.menus.menu.setSheetDragPreview(active);
            }
        } else {
            panel.style.visibility = active ? "hidden" : "";
        }
    };
    const dropDay = (x: number, y: number) => {
        if (!dragPreview) {
            const rect = mobile && state.undatedOpen ? window.siyuan.menus.menu.element.getBoundingClientRect() :
                panel.getBoundingClientRect();
            if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
                return;
            }
        }
        return getCalendarDropDay(root, x, y);
    };

    toggle.addEventListener("click", event => {
        event.stopPropagation();
        setOpen(!state.undatedOpen, true);
    });
    more.addEventListener("click", () => { void load(); });
    panel.addEventListener("beforeinput", event => event.stopPropagation());
    panel.addEventListener("keyup", event => event.stopPropagation());
    panel.addEventListener("compositionstart", event => event.stopPropagation());
    panel.addEventListener("compositionend", event => event.stopPropagation());
    search.addEventListener("input", event => {
        event.stopPropagation();
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
                if (mobile) {
                    window.siyuan.menus.menu.remove();
                }
                onOpen(row);
            }
            return;
        }
        const item = target.closest<HTMLElement>("[data-calendar-undated-row]");
        if (item && !suppressClick) {
            selectedID = selectedID === item.dataset.calendarUndatedRow ? "" : item.dataset.calendarUndatedRow;
            state.undatedSelectedID = selectedID;
            updateSelection();
            if (mobile && selectedID) {
                keepMobileSelection = true;
                window.siyuan.menus.menu.closeSheet();
            }
        }
    });
    panel.addEventListener("keydown", event => {
        event.stopPropagation();
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
        if (!selectedID) {
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
        if ((event.key !== "Enter" && event.key !== " ") || !selectedID) {
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
    const createGhost = (item: HTMLElement) => {
        const rect = item.getBoundingClientRect();
        const ghost = item.cloneNode(true) as HTMLElement;
        ghost.classList.add("b3-menu__item--show", "av__calendar-undated-ghost");
        ghost.removeAttribute("data-calendar-undated-row");
        ghost.removeAttribute("role");
        ghost.removeAttribute("tabindex");
        ghost.removeAttribute("aria-pressed");
        ghost.setAttribute("aria-hidden", "true");
        ghost.style.width = `${rect.width}px`;
        ghost.style.height = `${rect.height}px`;
        document.body.append(ghost);
        root.classList.add("av__calendar--dragging");
        item.classList.add("av__calendar-item--dragging");
        return ghost;
    };
    const moveGhost = (ghost: HTMLElement, x: number, y: number) => {
        ghost.style.left = `${Math.max(8, Math.min(x + 12, window.innerWidth - parseFloat(ghost.style.width) - 8))}px`;
        ghost.style.top = `${Math.max(8, Math.min(y + 12, window.innerHeight - parseFloat(ghost.style.height) - 8))}px`;
    };
    panel.addEventListener("pointerdown", event => {
        const item = (event.target as HTMLElement).closest<HTMLElement>("[data-calendar-undated-row]");
        if (event.button !== 0 || event.pointerType === "touch" || !item ||
            (event.target as HTMLElement).closest("[data-calendar-undated-open]")) {
            return;
        }
        const controller = new AbortController();
        let dragging = false;
        let scheduled = false;
        let destination: number;
        let ghost: HTMLElement;
        const clean = () => {
            controller.abort();
            clearPreview();
            root.classList.remove("av__calendar--dragging", "av__calendar--invalid");
            item.classList.remove("av__calendar-item--dragging");
            ghost?.remove();
            if (dragging) {
                if (!mobile || (!scheduled && state.undatedOpen)) {
                    setDragPreview(false);
                }
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
            if (!dragging) {
                dragging = true;
                ghost = createGhost(item);
                setDragPreview(true);
            }
            moveGhost(ghost, move.clientX, move.clientY);
            destination = dropDay(move.clientX, move.clientY);
            preview(destination);
        }, {signal: controller.signal, passive: false});
        document.addEventListener("pointerup", up => {
            if (up.pointerId !== event.pointerId) {
                return;
            }
            destination = dropDay(up.clientX, up.clientY);
            if (dragging && root.isConnected && destination !== undefined) {
                scheduled = schedule(item.dataset.calendarUndatedRow, destination);
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
    panel.addEventListener("touchstart", event => {
        if (!mobile || event.touches.length !== 1) {
            return;
        }
        const item = (event.target as HTMLElement).closest<HTMLElement>("[data-calendar-undated-row]");
        if (!item || (event.target as HTMLElement).closest("[data-calendar-undated-open]")) {
            return;
        }
        const touch = event.touches[0];
        const identifier = touch.identifier;
        const startX = touch.clientX;
        const startY = touch.clientY;
        const controller = new AbortController();
        let dragging = false;
        let scheduled = false;
        let ghost: HTMLElement;
        const clean = () => {
            clearTimeout(timer);
            controller.abort();
            clearPreview();
            root.classList.remove("av__calendar--dragging", "av__calendar--invalid");
            item.classList.remove("av__calendar-item--dragging");
            ghost?.remove();
            if (dragging) {
                if (!scheduled && state.undatedOpen && window.siyuan.menus.menu.element.lastElementChild.contains(panel)) {
                    setDragPreview(false);
                }
                suppressClick = true;
                setTimeout(() => { suppressClick = false; }, 300);
            }
        };
        const timer = window.setTimeout(() => {
            if (!root.isConnected || !panel.isConnected) {
                clean();
                return;
            }
            dragging = true;
            ghost = createGhost(item);
            moveGhost(ghost, startX, startY);
            setDragPreview(true);
        }, Constants.TIMEOUT_LONGPRESS);
        panel.addEventListener("touchmove", move => {
            if (move.touches.length !== 1) {
                clean();
                return;
            }
            const point = Array.from(move.touches).find(current => current.identifier === identifier);
            if (!point) {
                clean();
                return;
            }
            if (!dragging) {
                if (Math.hypot(point.clientX - startX, point.clientY - startY) > 5) {
                    clean();
                }
                return;
            }
            move.preventDefault();
            move.stopPropagation();
            moveGhost(ghost, point.clientX, point.clientY);
            preview(dropDay(point.clientX, point.clientY));
        }, {signal: controller.signal, passive: false});
        panel.addEventListener("touchend", end => {
            const point = Array.from(end.changedTouches).find(current => current.identifier === identifier);
            if (!point) {
                return;
            }
            if (dragging) {
                end.preventDefault();
                end.stopPropagation();
                const day = dropDay(point.clientX, point.clientY);
                if (root.isConnected && day !== undefined) {
                    scheduled = schedule(item.dataset.calendarUndatedRow, day);
                }
            }
            clean();
        }, {signal: controller.signal});
        panel.addEventListener("touchcancel", clean, {signal: controller.signal});
        window.addEventListener("blur", clean, {signal: controller.signal});
    }, {passive: true});
    panel.addEventListener("contextmenu", event => {
        if (mobile && (event.target as HTMLElement).closest("[data-calendar-undated-row]")) {
            event.preventDefault();
        }
    });
    if (cache) {
        renderRows();
    }
    updateDayTargets();
    if (state.undatedOpen) {
        setOpen(true);
    }
};
