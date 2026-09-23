import {Constants} from "../../../../constants";
import {setStorageVal} from "../../../util/compatibility";
import * as dayjs from "dayjs";
import {escapeAttr, escapeHtml} from "../../../../util/escape";
import {isMobile} from "../../../../util/functions";
import {transaction} from "../../../wysiwyg/transaction";
import {renderCell} from "../cell";
import {getAVBackgroundColor} from "../color";
import {getColNameByType} from "../col";
import {finishAVLocate} from "../locate";
import {createAttributeViewItem} from "../newItemTemplate";
import {openDatabaseRowByData} from "../openDatabaseRow";
import {avRender, genTabHeaderHTML, updateSearch} from "../render";
import {replaceAVContainer} from "../container";
import {renderAVRichTextElements} from "../richText";
import {avContextmenu} from "../action";
import {bindAvSearch} from "../search";
import {setAVData} from "../virtualScroll";
import {addCalendarDays, calendarDay, calendarDayDistance, getCalendarInterval, getISOWeekForCalendarRow, ICalendarEvent, ICalendarSegment,
    moveCalendarDate, packCalendarWeek, resizeCalendarDate} from "./date";
import {openCalendarJump} from "./jump";
import {getCalendarDropDay} from "./hitTest";
import {createCalendarPreviewLayout} from "./preview";
import {addCalendarDateField, bindCalendarSettings, getCalendarSettingsHTML, isCalendarDateColumn} from "./settings";
import {getCalendarRequestRange, getCalendarState, setCalendarMode} from "./state";
import {bindCalendarUndated, getCalendarUndatedHTML} from "./undated";

const iconButton = (action: string, icon: string, label: string) => `<button type="button" class="block__icon block__icon--show ariaLabel" data-calendar-action="${action}" data-position="8south" aria-label="${escapeAttr(label)}"><svg><use xlink:href="#${icon}"></use></svg></button>`;

const canEditCalendar = (protyle: IProtyle) => !protyle.disabled && !window.siyuan.isPublish &&
    !protyle.options.history?.created && !protyle.options.history?.snapshot;

const openCalendarItem = (protyle: IProtyle, blockElement: HTMLElement, row: IAVRow) => {
    const primary = row.cells.find(cell => cell.valueType === "block" || cell.value?.type === "block");
    if (!primary?.value) {
        return;
    }
    return openDatabaseRowByData(protyle, {
        avID: blockElement.dataset.avId, databaseBlockID: blockElement.dataset.nodeId, notebookID: protyle.notebookId,
        itemID: row.id, valueID: primary.id || primary.value.id,
        title: primary.value.block?.content || window.siyuan.languages.untitled,
        boundBlockID: primary.value.block?.id, isDetached: !!primary.value.isDetached,
    });
};

const updateCalendarDate = (protyle: IProtyle, blockElement: HTMLElement,
                            event: Pick<ICalendarEvent, "row" | "date">, date: IAVCellDateValue,
                            onUpdated?: () => void) => {
    if (event.date.value?.type !== "date" || !canEditCalendar(protyle)) {
        return;
    }
    const operation = {
        action: "updateAttrViewCell" as const, avID: blockElement.dataset.avId, blockID: blockElement.dataset.nodeId,
        id: event.date.id || event.date.value.id, keyID: event.date.value.keyID, rowID: event.row.id,
    };
    transaction(protyle, [{...operation, data: {type: "date", date}}, {
        action: "doUpdateUpdated", id: blockElement.dataset.nodeId, data: dayjs().format("YYYYMMDDHHmmss"),
    }], [{...operation, data: {type: "date", date: {...event.date.value.date}}}, {
        action: "doUpdateUpdated", id: blockElement.dataset.nodeId, data: blockElement.getAttribute("updated"),
    }], {callback: onUpdated});
};

const getEventHTML = (segment: ICalendarSegment, view: IAVTable, editable: boolean) => {
    const {event, starts, ends} = segment;
    const primary = event.row.cells.find(cell => cell.value?.type === "block");
    const colorValue = event.row.cells.find(cell => cell.value?.keyID === view.calendar.colorKeyID)?.value;
    const colorField = view.columns.find(field => field.id === view.calendar.colorKeyID && field.type === "select");
    const option = colorField?.options?.find(item => item.name === colorValue?.mSelect?.[0]?.content);
    const dateValue = event.date.value;
    const column = view.columns.find(field => field.id === dateValue.keyID);
    const rawDate = dateValue.type === "date" ? dateValue.date : dateValue.type === "created" ? dateValue.created : dateValue.updated;
    const showTime = dateValue.type === "date" ? !rawDate.isNotTime : !!column?.[dateValue.type as "created" | "updated"]?.includeTime;
    const formatTime = (value: number) => new Date(value).toLocaleTimeString(window.siyuan.config.lang, {hour: "2-digit", minute: "2-digit"});
    const time = showTime ? formatTime(event.start) + (event.end > event.start && calendarDay(event.start) === calendarDay(event.end) ? ` - ${formatTime(event.end)}` : "") : "";
    const drag = editable && dateValue.type === "date" && !event.invalid;
    const title = `${primary?.value?.block?.content || window.siyuan.languages.untitled}\n${rawDate.formattedContent || ""}${event.invalid ? `\n${window.siyuan.languages.calendarInvalidRange}` : ""}`;
    const fields = event.row.cells.map((cell, index) => {
        const field = view.columns[index];
        if (!field || field.hidden) {
            return "";
        }
        const checkClass = field.type === "checkbox" ? (cell.value?.checkbox?.checked ? " av__cell-check" : " av__cell-uncheck") : "";
        return `<div class="av__calendar-field${checkClass}" data-field-id="${field.id}" data-col-id="${field.id}" data-dtype="${field.type}" data-align="${field.align || ""}" data-wrap="${field.wrap}"${field.renderTemplate?.trim() ? ' data-render-template="true"' : ""} title="${escapeAttr(field.name)}">${renderCell(cell.value, event.rowIndex || 0, view.showIcon, "calendar", field.options, field.dateFormat, field.renderTemplate, false)}</div>`;
    }).join("");
    return `<div class="av__calendar-item${starts ? " av__calendar-item--start" : ""}${ends ? " av__calendar-item--end" : ""}" role="button" tabindex="0" data-calendar-item="${event.row.id}" data-id="${event.row.id}" title="${escapeAttr(title)}" style="grid-column:${segment.column + 1}/span ${segment.span};grid-row:${segment.lane + 1};${option ? `--b3-av-calendar-background:${getAVBackgroundColor(option)}` : ""}">
        ${drag && starts ? `<span class="av__calendar-resize av__calendar-resize--start" data-calendar-resize="start" title="${window.siyuan.languages.calendarResizeStart}"></span>` : ""}
        ${drag && !isMobile() ? `<span class="av__calendar-move" data-calendar-move title="${window.siyuan.languages.move}"><svg><use xlink:href="#iconDrag"></use></svg></span>` : ""}
        <div class="av__calendar-item-content">${time ? `<span class="av__calendar-time">${time}</span>` : ""}${event.invalid ? '<svg class="av__calendar-warning"><use xlink:href="#iconInfo"></use></svg>' : ""}${fields || escapeHtml(primary?.value?.block?.content || window.siyuan.languages.untitled)}</div>
        ${drag && ends ? `<span class="av__calendar-resize av__calendar-resize--end" data-calendar-resize="end" title="${window.siyuan.languages.calendarResizeEnd}"></span>` : ""}
    </div>`;
};

const bindCalendarDrag = (root: HTMLElement, protyle: IProtyle, blockElement: HTMLElement,
                          events: Map<string, ICalendarEvent>, view: IAVTable) => {
    let suppressClick = false;
    root.addEventListener("click", event => {
        if (suppressClick) {
            event.stopImmediatePropagation();
            event.preventDefault();
        }
    }, true);
    const createSession = (entry: ICalendarEvent, endpoint: "start" | "end" | undefined, x: number, y: number) => {
        const origin = getCalendarDropDay(root, x, y);
        let destination = origin;
        let dragging = false;
        let cleaned = false;
        let lastX = x;
        let lastY = y;
        const previewLayout = createCalendarPreviewLayout();
        const sourceItems = Array.from(root.querySelectorAll<HTMLElement>("[data-calendar-item]"))
            .filter(element => element.dataset.calendarItem === entry.row.id);
        const clearPreview = () => {
            root.querySelectorAll(".av__calendar-preview-layer").forEach(element => element.remove());
        };
        const candidate = () => destination === undefined || origin === undefined ? undefined :
            endpoint ? resizeCalendarDate(entry.date.value.date, endpoint, destination) :
                moveCalendarDate(entry.date.value.date, calendarDayDistance(origin, destination));
        const preview = () => {
            clearPreview();
            const date = candidate();
            root.classList.toggle("av__calendar--invalid", !date);
            if (!date) {
                return;
            }
            const value = {...entry.date.value, date};
            const next = {...entry, ...getCalendarInterval(value), date: {...entry.date, value}};
            root.querySelectorAll<HTMLElement>("[data-calendar-week]").forEach(week => {
                const segment = packCalendarWeek([next], Number(week.dataset.calendarWeek))[0];
                if (!segment) {
                    return;
                }
                const layer = document.createElement("div");
                layer.className = "av__calendar-preview-layer";
                layer.setAttribute("aria-hidden", "true");
                layer.innerHTML = `<div class="av__calendar-drop" style="left:${segment.column * 100 / 7}%;width:${segment.span * 100 / 7}%"></div>` +
                    getEventHTML(segment, view, false);
                const card = layer.querySelector<HTMLElement>(".av__calendar-item");
                card.classList.add("av__calendar-preview");
                card.removeAttribute("data-calendar-item");
                card.removeAttribute("data-id");
                card.removeAttribute("tabindex");
                card.style.left = `${segment.column * 100 / 7}%`;
                card.style.width = `calc(${segment.span * 100 / 7}% - 4px)`;
                card.style.top = "0";
                week.append(layer);
                previewLayout.place(week, layer, card);
            });
        };
        const clean = () => {
            if (cleaned) {
                return;
            }
            cleaned = true;
            clearPreview();
            previewLayout.destroy();
            root.classList.remove("av__calendar--dragging", "av__calendar--invalid");
            sourceItems.forEach(element => element.classList.remove("av__calendar-item--dragging"));
            if (dragging) {
                suppressClick = true;
                setTimeout(() => { suppressClick = false; });
            }
        };
        const begin = () => {
            if (dragging) {
                return;
            }
            dragging = true;
            root.classList.add("av__calendar--dragging");
            sourceItems.forEach(element => element.classList.add("av__calendar-item--dragging"));
        };
        return {
            begin,
            move: (clientX: number, clientY: number) => {
                if (!root.isConnected) {
                    clean();
                    return;
                }
                begin();
                if (clientX === lastX && clientY === lastY) {
                    return;
                }
                lastX = clientX;
                lastY = clientY;
                destination = getCalendarDropDay(root, clientX, clientY);
                preview();
            },
            finish: (clientX: number, clientY: number) => {
                // 占位扩展后，同一落点沿用已展示的预览日期，避免松手时跳到相邻周。
                if (clientX !== lastX || clientY !== lastY) {
                    destination = getCalendarDropDay(root, clientX, clientY);
                }
                if (dragging && root.isConnected) {
                    const date = candidate();
                    if (date && JSON.stringify(date) !== JSON.stringify(entry.date.value.date)) {
                        updateCalendarDate(protyle, blockElement, entry, date);
                    }
                }
                clean();
            },
            clean,
        };
    };
    root.addEventListener("pointerdown", event => {
        event.stopPropagation();
        const target = event.target as HTMLElement;
        const item = target.closest<HTMLElement>("[data-calendar-item]");
        const entry = item && events.get(item.dataset.calendarItem);
        const endpoint = target.closest<HTMLElement>("[data-calendar-resize]")?.dataset.calendarResize as "start" | "end" | undefined;
        if (event.button !== 0 || !entry || entry.invalid || entry.date.value.type !== "date" || !canEditCalendar(protyle) ||
            event.pointerType === "touch" && !endpoint && !target.closest("[data-calendar-move]")) {
            return;
        }
        const controller = new AbortController();
        const session = createSession(entry, endpoint, event.clientX, event.clientY);
        let dragging = false;
        const clean = () => {
            controller.abort();
            session.clean();
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
            session.move(move.clientX, move.clientY);
        }, {signal: controller.signal, passive: false});
        document.addEventListener("pointerup", up => {
            if (up.pointerId !== event.pointerId) {
                return;
            }
            session.finish(up.clientX, up.clientY);
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
    root.addEventListener("touchstart", event => {
        if (!isMobile() || event.touches.length !== 1 || !canEditCalendar(protyle)) {
            return;
        }
        const target = event.target as HTMLElement;
        if (target.closest("[data-calendar-resize]")) {
            return;
        }
        const item = target.closest<HTMLElement>("[data-calendar-item]");
        const entry = item && events.get(item.dataset.calendarItem);
        if (!entry || entry.invalid || entry.date.value.type !== "date") {
            return;
        }
        const touch = event.touches[0];
        const identifier = touch.identifier;
        const startX = touch.clientX;
        const startY = touch.clientY;
        const session = createSession(entry, undefined, startX, startY);
        const controller = new AbortController();
        let dragging = false;
        const clean = () => {
            clearTimeout(timer);
            controller.abort();
            session.clean();
        };
        const timer = window.setTimeout(() => {
            if (!root.isConnected) {
                clean();
                return;
            }
            dragging = true;
            session.begin();
        }, Constants.TIMEOUT_LONGPRESS);
        root.addEventListener("touchmove", move => {
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
            session.move(point.clientX, point.clientY);
        }, {signal: controller.signal, passive: false});
        root.addEventListener("touchend", end => {
            const point = Array.from(end.changedTouches).find(current => current.identifier === identifier);
            if (!point) {
                return;
            }
            if (dragging) {
                end.preventDefault();
                end.stopPropagation();
                session.finish(point.clientX, point.clientY);
            }
            clean();
        }, {signal: controller.signal});
        root.addEventListener("touchcancel", clean, {signal: controller.signal});
        root.addEventListener("contextmenu", menuEvent => {
            if (dragging && item.contains(menuEvent.target as Node)) {
                menuEvent.preventDefault();
                menuEvent.stopImmediatePropagation();
            }
        }, {signal: controller.signal, capture: true});
        window.addEventListener("blur", clean, {signal: controller.signal});
    }, {passive: true});
};

export const renderCalendar = async (blockElement: HTMLElement, protyle: IProtyle, data: IAV, cb?: (data: IAV) => void) => {
    const view = data.view as IAVTable;
    const state = getCalendarState(blockElement, data.viewID);
    const rowLimit = view.calendar.rowLimit || 3;
    if (state.rowLimit !== rowLimit) {
        state.expandedWeeks.clear();
        state.rowLimit = rowLimit;
    }
    const dateColumn = view.columns.find(field => field.id === view.calendar.dateKeyID && isCalendarDateColumn(field));
    state.weekStart = view.calendar.weekStart;
    state.dateType = dateColumn?.type;
    if (view.calendarTargetDate !== undefined) {
        const current = getCalendarRequestRange(blockElement, data.viewID);
        if (view.calendarTargetDate < current.start || view.calendarTargetDate >= current.end) {
            state.anchor = calendarDay(view.calendarTargetDate);
        }
    }
    const range = getCalendarRequestRange(blockElement, data.viewID);
    if (view.calendarRange?.start !== range.start || view.calendarRange?.end !== range.end || view.calendarRange?.timeZone !== range.timeZone) {
        blockElement.removeAttribute("data-render");
        await avRender(blockElement, protyle, cb);
        return;
    }
    const editable = canEditCalendar(protyle);
    const search = blockElement.querySelector<HTMLElement>('[data-type="av-search"]');
    const query = search?.textContent || "";
    const isSearching = search === document.activeElement;
    const hasUndated = !!dateColumn && state.undatedCount?.dateKeyID === dateColumn.id && state.undatedCount.query === query.trim() &&
        state.undatedCount.total > 0;
    const events: ICalendarEvent[] = [];
    view.rows.forEach((row, rowIndex) => {
        const date = row.cells.find(cell => cell.value?.keyID === dateColumn?.id);
        const interval = getCalendarInterval(date?.value);
        if (interval) {
            events.push({...interval, row, date, rowIndex});
        }
    });
    const eventsByID = new Map(events.map(event => [event.row.id, event]));
    const locale = window.siyuan.config.lang;
    const anchor = new Date(state.anchor);
    const label = state.mode === "month" ? anchor.toLocaleDateString(locale, {year: "numeric", month: "long"}) :
        `${new Date(range.start).toLocaleDateString(locale)} - ${new Date(addCalendarDays(range.end, -1)).toLocaleDateString(locale)}`;
    const days = Array.from({length: 7}, (_, day) => new Date(addCalendarDays(range.start, day)).toLocaleDateString(locale, {weekday: "short"}));
    const weekStartDay = new Date(range.start).getDay();
    let body = "";
    if (!dateColumn) {
        body = `<div class="av__calendar-empty"><svg><use xlink:href="#iconCalendar"></use></svg><p>${window.siyuan.languages.calendarSelectDateField}</p>
            ${editable ? `<div class="av__calendar-setup">${getCalendarSettingsHTML(view)}</div><div class="av__calendar-create-fields">${(["date", "created", "updated"] as const).map(type => `<button class="b3-button b3-button--outline" data-calendar-create-field="${type}">${window.siyuan.languages.newCol} ${getColNameByType(type)}</button>`).join("")}</div>` : ""}</div>`;
    } else {
        for (let start = range.start; start < range.end; start = addCalendarDays(start, 7)) {
            const isoWeek = getISOWeekForCalendarRow(start);
            const weekLabel = `${window.siyuan.languages.calendarISOWeek} ${isoWeek.year}-W${String(isoWeek.week).padStart(2, "0")}`;
            const segments = packCalendarWeek(events, start);
            if (data.target?.status === "visible" && segments.some(segment => segment.event.row.id === data.target.itemID)) {
                state.expandedWeeks.add(start);
            }
            const expanded = state.mode === "week" || rowLimit === -1 || state.expandedWeeks.has(start);
            const visible = expanded ? segments : segments.filter(segment => segment.lane < rowLimit);
            const maxLane = Math.max(0, ...visible.map(segment => segment.lane + 1));
            const dayHeaders = Array.from({length: 7}, (_, day) => {
                const timestamp = addCalendarDays(start, day);
                const date = new Date(timestamp);
                return `<div class="av__calendar-day${day === 0 ? " av__calendar-day--first" : ""}${date.getMonth() === anchor.getMonth() || state.mode === "week" ? "" : " av__calendar-day--outside"}${calendarDay(Date.now()) === timestamp ? " av__calendar-day--today" : ""}" data-calendar-day="${timestamp}">
                    ${day === 0 ? `<span class="av__calendar-week-number" title="${escapeAttr(weekLabel)}">W${String(isoWeek.week).padStart(2, "0")}</span>` : ""}
                    <span title="${escapeAttr(date.toLocaleDateString(locale))}">${date.getDate() === 1 ? date.toLocaleDateString(locale, {month: "short", day: "numeric"}) : date.getDate()}</span>
                    ${editable && dateColumn.type === "date" && date.getFullYear() >= 1 && date.getFullYear() <= 9999 ? `<button type="button" class="block__icon" data-calendar-add="${timestamp}" aria-label="${window.siyuan.languages.newRow}"><svg><use xlink:href="#iconAdd"></use></svg></button>` : ""}
                </div>`;
            }).join("");
            const overflow = Array.from({length: 7}, (_, day) => {
                const hidden = segments.filter(segment => segment.lane >= rowLimit && segment.column <= day && segment.column + segment.span > day).length;
                return hidden && !expanded ? `<button class="b3-button b3-button--cancel b3-button--small av__calendar-more" data-calendar-expand="${start}" style="grid-column:${day + 1}">${escapeHtml(window.siyuan.languages.calendarMore.replace("${x}", hidden.toString()))}</button>` : "";
            }).join("");
            body += `<div class="av__calendar-week" data-calendar-week="${start}"><div class="av__calendar-days">${dayHeaders}</div>
                <div class="av__calendar-events" style="grid-template-rows:repeat(${Math.max(1, maxLane)},auto)">${visible.map(segment => getEventHTML(segment, view, editable)).join("")}</div>
                ${overflow ? `<div class="av__calendar-overflow">${overflow}</div>` : ""}</div>`;
        }
    }
    blockElement.removeAttribute(Constants.ATTRIBUTE_V_SCROLL);
    replaceAVContainer(blockElement, `<div class="av__container fn__block">
        ${genTabHeaderHTML(data, !!query || isSearching, editable, blockElement, editable && !!dateColumn)}
        <div class="av__calendar" contenteditable="false">
            <div class="av__calendar-toolbar">
                <span class="av__calendar-label">${escapeHtml(label)}</span>
                <div class="av__calendar-controls">
                ${editable && dateColumn?.type === "date" ? `<button type="button" class="block__icon block__icon--show ariaLabel${hasUndated ? "" : " fn__none"}" data-calendar-undated-toggle data-position="8south" aria-label="${escapeAttr(window.siyuan.languages.calendarUndated)}" aria-expanded="false"><svg><use xlink:href="#iconInbox"></use></svg></button>` : ""}
                ${iconButton("previous", "iconLeft", window.siyuan.languages.previous)}
                <button type="button" class="b3-button b3-button--cancel av__calendar-today ariaLabel" data-calendar-action="today" data-position="8south" aria-label="${escapeAttr(window.siyuan.languages.calendarToday)}">${window.siyuan.languages.calendarToday}</button>
                ${iconButton("next", "iconRight", window.siyuan.languages.next)}
                ${iconButton("jump", "iconCalendar", window.siyuan.languages.calendarJump)}
                <select class="b3-select" data-calendar-mode aria-label="${window.siyuan.languages.calendarView}"><option value="month"${state.mode === "month" ? " selected" : ""}>${window.siyuan.languages.month}</option><option value="week"${state.mode === "week" ? " selected" : ""}>${window.siyuan.languages.week}</option></select>
                </div>
            </div>
            ${editable && dateColumn?.type === "date" ? getCalendarUndatedHTML(state) : ""}
            ${dateColumn && dateColumn.type !== "date" ? `<div class="av__calendar-source ft__on-surface">${window.siyuan.languages.calendarReadOnlyDate}</div>` : ""}
            <div class="av__calendar-scroll" data-prevent-swipe="true">
                ${dateColumn ? `<div class="av__calendar-weekdays">${days.map(day => `<div>${day}</div>`).join("")}</div>` : ""}
                <div class="av__body av__calendar-grid${dateColumn ? "" : " av__calendar-grid--empty"}" data-group-id="" style="--av-calendar-saturday:${(6 - weekStartDay + 7) % 7};--av-calendar-sunday:${(7 - weekStartDay) % 7};">${body}</div>
            </div>
        </div>
        <div class="av__cursor" contenteditable="true">${Constants.ZWSP}</div>
    </div>`);
    blockElement.dataset.render = "true";
    setAVData(blockElement, data);
    const root = blockElement.querySelector<HTMLElement>(".av__calendar");
    const refresh = () => {
        blockElement.removeAttribute("data-render");
        void avRender(blockElement, protyle);
    };
    const create = (date: number) => {
        state.anchor = date;
        createAttributeViewItem({protyle, blockElement, templateID: data.defaultTemplateID,
            position: {calendarDate: date}});
    };
    bindCalendarDrag(root, protyle, blockElement, eventsByID, view);
    if (editable && dateColumn?.type === "date") {
        bindCalendarUndated({root, blockElement, data, state, query,
            onOpen: row => openCalendarItem(protyle, blockElement, row),
            onSchedule: (row, cell, day, onUpdated) => updateCalendarDate(protyle, blockElement,
                {row, date: cell},
                {content: day, isNotEmpty: true, isNotTime: true, hasEndDate: false, isNotEmpty2: false}, onUpdated)});
    }
    root.addEventListener("click", event => {
        event.stopPropagation();
        const target = event.target as HTMLElement;
        const item = target.closest<HTMLElement>("[data-calendar-item]");
        if (item) {
            void openCalendarItem(protyle, blockElement, eventsByID.get(item.dataset.calendarItem).row);
            return;
        }
        const action = target.closest<HTMLElement>("[data-calendar-action]")?.dataset.calendarAction;
        if (action) {
            if (action === "jump") {
                openCalendarJump(state.anchor, state.weekStart, date => {
                    state.anchor = date;
                    state.expandedWeeks.clear();
                    refresh();
                });
                return;
            }
            if (action === "today") {
                state.anchor = calendarDay(Date.now());
            } else if (state.mode === "week") {
                state.anchor = addCalendarDays(state.anchor, action === "previous" ? -7 : 7);
            } else {
                const date = new Date(state.anchor);
                date.setDate(1);
                date.setMonth(date.getMonth() + (action === "previous" ? -1 : 1));
                state.anchor = date.getTime();
            }
            state.anchor = Math.max(new Date("0001-01-01T00:00:00").getTime(),
                Math.min(new Date("9999-12-31T00:00:00").getTime(), state.anchor));
            state.expandedWeeks.clear();
            refresh();
        }
        const add = target.closest<HTMLElement>("[data-calendar-add]");
        if (add && editable) {
            create(Number(add.dataset.calendarAdd));
        }
        const expand = target.closest<HTMLElement>("[data-calendar-expand]");
        if (expand) {
            state.expandedWeeks.add(Number(expand.dataset.calendarExpand));
            void renderCalendar(blockElement, protyle, data);
        }
        const field = target.closest<HTMLElement>("[data-calendar-create-field]");
        if (field && editable) {
            addCalendarDateField(protyle, blockElement, data, field.dataset.calendarCreateField as "date" | "created" | "updated");
        }
    });
    root.addEventListener("keydown", event => {
        event.stopPropagation();
        const item = (event.target as HTMLElement).closest<HTMLElement>("[data-calendar-item]");
        if (item && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            void openCalendarItem(protyle, blockElement, eventsByID.get(item.dataset.calendarItem).row);
        }
    });
    root.addEventListener("contextmenu", event => {
        event.preventDefault();
        event.stopPropagation();
        const item = (event.target as HTMLElement).closest<HTMLElement>("[data-calendar-item]");
        if (!item) {
            return;
        }
        const entry = eventsByID.get(item.dataset.calendarItem);
        avContextmenu(protyle, item, {x: event.clientX, y: event.clientY}, {customize: menu => {
            menu.addSeparator();
            menu.addItem({icon: "iconOpen", label: window.siyuan.languages.openBy,
                click: () => { void openCalendarItem(protyle, blockElement, entry.row); }});
            if (editable && dateColumn?.type === "date") {
                const week = item.closest<HTMLElement>("[data-calendar-week]");
                const rect = week.getBoundingClientRect();
                const day = addCalendarDays(Number(week.dataset.calendarWeek),
                    Math.max(0, Math.min(6, Math.floor((event.clientX - rect.left) / (rect.width / 7)))));
                menu.addItem({icon: "iconAdd", label: window.siyuan.languages.calendarNewOnDate,
                    click: () => create(day)});
                menu.addItem({icon: "iconTrashcan", label: window.siyuan.languages.calendarClearDate,
                    click: () => updateCalendarDate(protyle, blockElement, entry,
                        {...entry.date.value.date, isNotEmpty: false, isNotEmpty2: false})});
            }
        }});
    });
    root.querySelector<HTMLSelectElement>("[data-calendar-mode]").addEventListener("change", event => {
        const modes = setCalendarMode(blockElement, data.viewID, (event.target as HTMLSelectElement).value as "month" | "week");
        if (modes) {
            setStorageVal(Constants.LOCAL_AV_CALENDAR_MODES, modes);
        }
        state.expandedWeeks.clear();
        refresh();
    });
    if (!dateColumn && editable) {
        bindCalendarSettings({protyle, blockElement, data, menuElement: root});
    }
    bindAvSearch({blockElement, query, isSearching, onChange: () => updateSearch(blockElement, protyle)});
    renderAVRichTextElements(blockElement);
    finishAVLocate(blockElement, protyle, data);
    cb?.(data);
};
