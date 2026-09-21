import {Constants} from "../../../../constants";
import {openInputDialog} from "../../../../dialog/inputDialog";
import * as dayjs from "dayjs";
import {escapeAttr, escapeHtml} from "../../../../util/escape";
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
import {addCalendarDays, calendarDay, calendarDayDistance, getCalendarInterval, ICalendarEvent, ICalendarSegment,
    moveCalendarDate, packCalendarWeek, resizeCalendarDate} from "./date";
import {addCalendarDateField, bindCalendarSettings, getCalendarSettingsHTML, isCalendarDateColumn} from "./settings";
import {getCalendarRequestRange, getCalendarState} from "./state";

const iconButton = (action: string, icon: string, label: string) => `<button type="button" class="block__icon block__icon--show" data-calendar-action="${action}" aria-label="${escapeAttr(label)}"><svg><use xlink:href="#${icon}"></use></svg></button>`;

const canEditCalendar = (protyle: IProtyle) => !protyle.disabled && !window.siyuan.isPublish &&
    !protyle.options.history?.created && !protyle.options.history?.snapshot;

const openCalendarItem = (protyle: IProtyle, blockElement: HTMLElement, event: ICalendarEvent) => {
    const primary = event.row.cells.find(cell => cell.valueType === "block" || cell.value?.type === "block");
    if (!primary?.value) {
        return;
    }
    return openDatabaseRowByData(protyle, {
        avID: blockElement.dataset.avId, databaseBlockID: blockElement.dataset.nodeId, notebookID: protyle.notebookId,
        itemID: event.row.id, valueID: primary.id || primary.value.id,
        title: primary.value.block?.content || window.siyuan.languages.untitled,
        boundBlockID: primary.value.block?.id, isDetached: !!primary.value.isDetached,
    });
};

const updateCalendarDate = (protyle: IProtyle, blockElement: HTMLElement, event: ICalendarEvent, date: IAVCellDateValue) => {
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
    }]);
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
        return `<div class="av__calendar-field" data-field-id="${field.id}" data-col-id="${field.id}" data-dtype="${field.type}" data-align="${field.align || ""}" data-wrap="${field.wrap}" title="${escapeAttr(field.name)}">${renderCell(cell.value, event.rowIndex || 0, view.showIcon, "calendar", field.options, field.dateFormat, field.renderTemplate, false)}</div>`;
    }).join("");
    return `<div class="av__calendar-item${starts ? " av__calendar-item--start" : ""}${ends ? " av__calendar-item--end" : ""}" role="button" tabindex="0" data-calendar-item="${event.row.id}" data-id="${event.row.id}" title="${escapeAttr(title)}" style="grid-column:${segment.column + 1}/span ${segment.span};grid-row:${segment.lane + 1};${option ? `--b3-av-calendar-background:${getAVBackgroundColor(option)}` : ""}">
        ${drag && starts ? `<span class="av__calendar-resize av__calendar-resize--start" data-calendar-resize="start" title="${window.siyuan.languages.calendarResizeStart}"></span>` : ""}
        ${drag ? `<span class="av__calendar-move" data-calendar-move title="${window.siyuan.languages.move}"><svg><use xlink:href="#iconDrag"></use></svg></span>` : ""}
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
        const getDay = (x: number, y: number) => {
            const viewport = root.querySelector(".av__calendar-scroll").getBoundingClientRect();
            if (x < viewport.left || x > viewport.right || y < viewport.top || y > viewport.bottom) {
                return;
            }
            for (const week of root.querySelectorAll<HTMLElement>("[data-calendar-week]")) {
                const rect = week.getBoundingClientRect();
                if (y >= rect.top && y <= rect.bottom && x >= rect.left && x <= rect.right) {
                    return addCalendarDays(Number(week.dataset.calendarWeek), Math.min(6, Math.floor((x - rect.left) / (rect.width / 7))));
                }
            }
        };
        const origin = getDay(event.clientX, event.clientY);
        let destination = origin;
        let dragging = false;
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
                card.style.top = `${week.querySelector(".av__calendar-days").getBoundingClientRect().height}px`;
                week.append(layer);
            });
        };
        const clean = () => {
            controller.abort();
            clearPreview();
            root.classList.remove("av__calendar--dragging", "av__calendar--invalid");
            sourceItems.forEach(element => element.classList.remove("av__calendar-item--dragging"));
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
            sourceItems.forEach(element => element.classList.add("av__calendar-item--dragging"));
            destination = getDay(move.clientX, move.clientY);
            preview();
        }, {signal: controller.signal, passive: false});
        document.addEventListener("pointerup", up => {
            if (up.pointerId !== event.pointerId) {
                return;
            }
            destination = getDay(up.clientX, up.clientY);
            if (dragging && root.isConnected) {
                const date = candidate();
                if (date && JSON.stringify(date) !== JSON.stringify(entry.date.value.date)) {
                    updateCalendarDate(protyle, blockElement, entry, date);
                }
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
                return `<div class="av__calendar-day${date.getMonth() === anchor.getMonth() || state.mode === "week" ? "" : " av__calendar-day--outside"}${calendarDay(Date.now()) === timestamp ? " av__calendar-day--today" : ""}" data-calendar-day="${timestamp}">
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
                ${iconButton("previous", "iconLeft", window.siyuan.languages.previous)}
                <button type="button" class="b3-button b3-button--cancel av__calendar-today" data-calendar-action="today">${window.siyuan.languages.calendarToday}</button>
                ${iconButton("next", "iconRight", window.siyuan.languages.next)}
                ${iconButton("jump", "iconCalendar", window.siyuan.languages.calendarJumpDate)}
                <select class="b3-select" data-calendar-mode aria-label="${window.siyuan.languages.calendarView}"><option value="month"${state.mode === "month" ? " selected" : ""}>${window.siyuan.languages.month}</option><option value="week"${state.mode === "week" ? " selected" : ""}>${window.siyuan.languages.week}</option></select>
                </div>
            </div>
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
    root.addEventListener("click", event => {
        event.stopPropagation();
        const target = event.target as HTMLElement;
        const item = target.closest<HTMLElement>("[data-calendar-item]");
        if (item) {
            void openCalendarItem(protyle, blockElement, eventsByID.get(item.dataset.calendarItem));
            return;
        }
        const action = target.closest<HTMLElement>("[data-calendar-action]")?.dataset.calendarAction;
        if (action) {
            if (action === "jump") {
                openInputDialog({
                    title: window.siyuan.languages.calendarJumpDate,
                    type: "date",
                    value: dayjs(state.anchor).format("YYYY-MM-DD"),
                    min: "0001-01-01",
                    max: "9999-12-31",
                    onConfirm: (value, dialog) => {
                        const input = dialog.element.querySelector<HTMLInputElement>("[data-dialog-input]");
                        if (!value || !input.reportValidity()) {
                            return;
                        }
                        state.anchor = new Date(`${value}T00:00:00`).getTime();
                        state.expandedWeeks.clear();
                        dialog.destroy();
                        refresh();
                    },
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
            void openCalendarItem(protyle, blockElement, eventsByID.get(item.dataset.calendarItem));
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
            menu.addItem({icon: "iconOpen", label: window.siyuan.languages.open,
                click: () => { void openCalendarItem(protyle, blockElement, entry); }});
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
        state.mode = (event.target as HTMLSelectElement).value as "month" | "week";
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
