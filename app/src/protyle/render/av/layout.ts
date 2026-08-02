import {transaction} from "../../wysiwyg/transaction";
import {Constants} from "../../../constants";
import {escapeAttr, escapeHtml} from "../../../util/escape";
import {fetchSyncPost} from "../../../util/fetch";
import {showMessage} from "../../../dialog/message";
import {setPosition} from "../../../util/setPosition";
import {getCardAspectRatioLabel, getCardAspectRatioValue, getCardWidth} from "./gallery/style";
import {getFieldsByData} from "./view";
import {unicode2Emoji} from "../../../emoji";
import {getColIconByType} from "./col";
import {escapeHtml} from "../../../util/escape";
import {CARD_LAYOUT_COMPACT, CARD_LAYOUT_LIST} from "./gallery/cardLayout";

const getCardLayoutHTML = (view: IAVGallery | IAVKanban) => {
    let fullRowHTML = "";
    if (view.cardLayout === CARD_LAYOUT_COMPACT) {
        view.fields.forEach((field) => {
            if (field.hidden) {
                return;
            }
            const disabled = field.type === "block" || view.displayFieldName;
            const checked = disabled || field.fullRow;
            fullRowHTML += `<label class="b3-menu__item">
    ${field.icon ? unicode2Emoji(field.icon, "b3-menu__icon", true) : `<svg class="b3-menu__icon"><use xlink:href="#${getColIconByType(field.type)}"></use></svg>`}
    <span class="b3-menu__label">${escapeHtml(field.name) || "&nbsp;"}</span>
    <input data-type="toggle-card-full-row" data-id="${field.id}" type="checkbox" class="b3-switch b3-switch--menu" ${checked ? "checked" : ""}${disabled ? " disabled" : ""}>
</label>`;
        });
        fullRowHTML = `<button class="b3-menu__separator av__card-layout-separator"></button>
<div class="av__card-layout-label">${window.siyuan.languages.fullRow}</div>
${fullRowHTML}`;
    }
    return `<label class="b3-menu__item">
    <span class="fn__flex-center">${window.siyuan.languages.cardLayout}</span>
    <span class="fn__space fn__flex-1"></span>
    <select data-type="set-card-layout" class="b3-select b3-select--noborder av__card-layout-select">
        <option value="${CARD_LAYOUT_LIST}"${view.cardLayout === CARD_LAYOUT_LIST ? " selected" : ""}>${window.siyuan.languages.list1}</option>
        <option value="${CARD_LAYOUT_COMPACT}"${view.cardLayout === CARD_LAYOUT_COMPACT ? " selected" : ""}>${window.siyuan.languages.compact}</option>
    </select>
</label>
${fullRowHTML}`;
};

export const getLayoutHTML = (data: IAV) => {
    let html = "";
    const view = data.view as IAVKanban;
    if (["gallery", "kanban"].includes(data.viewType)) {
        let coverFromTitle = "";
        if (view.coverFrom === 0) {
            coverFromTitle = window.siyuan.languages.calcOperatorNone;
        } else if (view.coverFrom === 1) {
            coverFromTitle = window.siyuan.languages.contentImage;
        } else if (view.coverFrom === 3) {
            coverFromTitle = window.siyuan.languages.contentBlock;
        } else {
            view.fields.find(item => {
                if (item.type === "mAsset" && item.id === view.coverFromAssetKeyID) {
                    coverFromTitle = item.name;
                    return true;
                }
            });
        }
        html = `<button class="b3-menu__item" data-type="set-gallery-cover">
    <span class="fn__flex-center">${window.siyuan.languages.cardPreview1}</span>
    <span class="fn__flex-1"></span>
    <span class="b3-menu__accelerator">${coverFromTitle}</span>
    <svg class="b3-menu__icon b3-menu__icon--small"><use xlink:href="#iconRight"></use></svg>
</button>
<button class="b3-menu__item" data-type="set-gallery-ratio"${view.coverFrom === 0 ? " disabled" : ""}>
    <span class="fn__flex-center">${window.siyuan.languages.cardAspectRatio}</span>
    <span class="fn__flex-1"></span>
    <span class="b3-menu__accelerator">${getCardAspectRatioLabel(getCardAspectRatioValue(view))}</span>
    <svg class="b3-menu__icon b3-menu__icon--small"><use xlink:href="#iconRight"></use></svg>
</button>
<button class="b3-menu__item" data-type="set-gallery-size">
    <span class="fn__flex-center">${window.siyuan.languages.cardSize}</span>
    <span class="fn__flex-1"></span>
    <span class="b3-menu__accelerator">${getCardWidth(view)}px</span>
    <svg class="b3-menu__icon b3-menu__icon--small"><use xlink:href="#iconRight"></use></svg>
</button>
<label class="b3-menu__item">
    <span class="fn__flex-center">${window.siyuan.languages.fitImage}</span>
    <span class="fn__space fn__flex-1"></span>
    <input data-type="toggle-gallery-fit" type="checkbox" class="b3-switch b3-switch--menu" ${view.fitImage ? "checked" : ""}>
</label>
<label class="b3-menu__item">
    <span class="fn__flex-center">${window.siyuan.languages.displayFieldName}</span>
    <span class="fn__space fn__flex-1"></span>
    <input data-type="toggle-gallery-name" type="checkbox" class="b3-switch b3-switch--menu" ${view.displayFieldName ? "checked" : ""}>
</label>
<label class="b3-menu__item">
    <span class="fn__flex-center">${window.siyuan.languages.displayEmptyFields}</span>
    <span class="fn__space fn__flex-1"></span>
    <input data-type="toggle-gallery-empty" type="checkbox" class="b3-switch b3-switch--menu" ${view.displayEmptyFields ? "checked" : ""}>
</label>`;
    }
    html = `<div class="b3-menu__items">
    <button class="b3-menu__item" data-type="nobg">
        <span class="block__icon" style="padding: 8px;margin-left: -4px;" data-type="go-config">
            <svg><use xlink:href="#iconLeft"></use></svg>
        </span>
        <span class="b3-menu__label ft__center">${window.siyuan.languages.layout}</span>
    </button>
    <button class="b3-menu__separator"></button>
    <button class="b3-menu__item" data-type="nobg">
        <div class="av__layout">
            <div data-type="set-layout" data-view-type="table" class="av__layout-item${data.viewType === "table" ? " av__layout-item--select" : ""}">
                <svg><use xlink:href="#iconTable"></use></svg>
                <div class="fn__hr"></div>
                <div>${window.siyuan.languages.table}</div>
            </div>
            <div data-type="set-layout" data-view-type="kanban" class="av__layout-item${data.viewType === "kanban" ? " av__layout-item--select" : ""}">
                <svg><use xlink:href="#iconBoard"></use></svg>
                <div class="fn__hr"></div>
                <div>${window.siyuan.languages.kanban}</div>
            </div>
            <div data-type="set-layout" data-view-type="gallery" class="av__layout-item${data.viewType === "gallery" ? " av__layout-item--select" : ""}">
                <svg><use xlink:href="#iconGallery"></use></svg>
                <div class="fn__hr"></div>
                <div>${window.siyuan.languages.gallery}</div>
            </div>
            <div data-type="set-layout" data-view-type="calendar" class="av__layout-item${data.viewType === "calendar" ? " av__layout-item--select" : ""}">
                <svg><use xlink:href="#iconCalendar"></use></svg>
                <div class="fn__hr"></div>
                <div>${window.siyuan.languages.calendar || "Calendar"}</div>
            </div>
        </div>
    </button>
    <label class="b3-menu__item">
        <span class="fn__flex-center">${window.siyuan.languages.showTitle}</span>
        <span class="fn__space fn__flex-1"></span>
        <input data-type="toggle-view-title" type="checkbox" class="b3-switch b3-switch--menu" ${view.hideAttrViewName ? "" : "checked"}>
    </label>
    ${html}
    <label class="b3-menu__item">
        <span class="fn__flex-center">${window.siyuan.languages.showAllEntriesIcons}</span>
        <span class="fn__space fn__flex-1"></span>
        <input data-type="toggle-entries-icons" type="checkbox" class="b3-switch b3-switch--menu" ${view.showIcon ? "checked" : ""}>
    </label>
    <label class="b3-menu__item">
        <span class="fn__flex-center">${window.siyuan.languages.wrapAllFields}</span>
        <span class="fn__space fn__flex-1"></span>
        <input data-type="toggle-entries-wrap" type="checkbox" class="b3-switch b3-switch--menu" ${view.wrapField ? "checked" : ""}>
    </label>`;
    if (data.viewType === "kanban" && ["select", "mSelect"].includes(data.view.groups?.[0]?.groupValue?.type)) {
        html += `<label class="b3-menu__item">
    <span class="fn__flex-center">${window.siyuan.languages.useBackground}</span>
    <span class="fn__space fn__flex-1"></span>
    <input data-type="toggle-kanban-bg" type="checkbox" class="b3-switch b3-switch--menu" ${view.fillColBackgroundColor ? "checked" : ""}>
</label>`;
    }
    if (data.viewType === "calendar") {
        const calendarView = data.view as IAVCalendar;
        const textFields = getFieldsByData(data).filter(field => field.type === "text");
        const buildOptions = (selected: string, fields: IAVColumn[]) => {
            let options = `<option value="">${escapeHtml(window.siyuan.languages.none || "None")}</option>`;
            if (selected && !fields.some(field => field.id === selected)) {
                options += `<option value="${escapeAttr(selected)}" selected disabled>${escapeHtml(window.siyuan.languages.calendarStaleMapping || "Missing or invalid field")}</option>`;
            }
            fields.forEach(field => {
                options += `<option value="${escapeAttr(field.id)}"${field.id === selected ? " selected" : ""}>${escapeHtml(field.name)}</option>`;
            });
            return options;
        };
        const buildDateOptions = () => {
            const matched = getFieldsByData(data).filter(field => field.type === "date");
            return buildOptions(calendarView.dateFieldID || "", matched);
        };
        const effectiveMapping = getCalendarFieldMapping(calendarView);
        html += `<div class="b3-menu__item" data-type="nobg">
    <div class="fn__block">
        <label class="ft__on-surface">${window.siyuan.languages.dateField || "Date Field"}</label>
        <select class="b3-select fn__block" data-type="calendar-date-field">
            ${buildDateOptions()}
        </select>
        <div class="fn__hr"></div>
        <label class="ft__on-surface">${window.siyuan.languages.calendarWeekStart || "Week starts on"}</label>
        <select class="b3-select fn__block" data-type="calendar-week-start">
            <option value="0"${(calendarView.weekStart || 0) === 0 ? " selected" : ""}>${escapeHtml(getWeekdayLabel(0))}</option>
            <option value="1"${calendarView.weekStart === 1 ? " selected" : ""}>${escapeHtml(getWeekdayLabel(1))}</option>
        </select>
        <div class="fn__hr"></div>
        <div class="av__calendar-config-row">
            <label class="ft__on-surface" for="av-calendar-new-item-target">${escapeHtml(window.siyuan.languages.newRow)}</label>
            <select class="b3-select fn__block av__calendar-new-item-target" id="av-calendar-new-item-target" data-type="calendar-new-item-target">
                <option value="${CALENDAR_NEW_ITEM_TARGET_DOCUMENT}"${getCalendarNewItemTarget(calendarView) === CALENDAR_NEW_ITEM_TARGET_DOCUMENT ? " selected" : ""}>${escapeHtml(window.siyuan.languages.doc)}</option>
                <option value="${CALENDAR_NEW_ITEM_TARGET_ROW}"${getCalendarNewItemTarget(calendarView) === CALENDAR_NEW_ITEM_TARGET_DOCUMENT ? "" : " selected"}>${escapeHtml(window.siyuan.languages.row)}</option>
            </select>
        </div>
        <div class="fn__hr"></div>
        <label class="ft__on-surface">${escapeHtml(window.siyuan.languages.fields || "Fields")}</label>
        <div class="av__calendar-visible-fields">
            ${textFields.filter(field => ![effectiveMapping.recurrenceFieldID, effectiveMapping.exceptionFieldID].includes(field.id) && !isCalendarRecurrenceStorageField(field)).map(field => `<label class="b3-list-item b3-list-item--narrow"><input type="checkbox" data-type="calendar-visible-field" data-field-id="${escapeAttr(field.id)}"${field.hidden ? "" : " checked"}><span class="b3-list-item__text">${escapeHtml(field.name)}</span></label>`).join("")}
        </div>
        <div class="fn__flex av__calendar-add-field">
            <input class="b3-text-field fn__flex-1" data-type="calendar-new-field-name" placeholder="${escapeAttr(window.siyuan.languages.addField || window.siyuan.languages.fields || "Add field")}">
            <button class="b3-button b3-button--outline" type="button" data-type="calendar-add-visible-field">+</button>
        </div>
        <div class="fn__hr"></div>
        <button class="b3-button b3-button--outline fn__block" type="button" data-type="calendar-import-ics-button" style="position: relative">
            <input class="b3-form__upload" type="file" accept=".ics,text/calendar" data-type="calendar-import-ics" aria-label="${escapeAttr(`${window.siyuan.languages.import || "Import"} ICS`)}">
            <svg><use xlink:href="#iconDownload"></use></svg>${escapeHtml(window.siyuan.languages.import || "Import")} ICS
        </button>
        <div class="ft__on-surface ft__smaller" data-type="calendar-import-ics-status" aria-live="polite"></div>
    </div>
</div>`;
    }
    if (data.viewType === "calendar") {
        // 日历渲染始终请求整个数据库（pageSize -1），分页项对它无效，不展示。
        return html + "</div>";
    }
    return html + `<button class="b3-menu__item" data-type="set-page-size" data-size="${view.pageSize}">
        <span class="fn__flex-center">${window.siyuan.languages.entryNum}</span>
        <span class="fn__flex-1"></span>
        <span class="b3-menu__accelerator">${view.pageSize === Constants.SIZE_DATABASE_MAZ_SIZE ? window.siyuan.languages.all : view.pageSize}</span>
        <svg class="b3-menu__icon b3-menu__icon--small"><use xlink:href="#iconRight"></use></svg>
    </button>
    ${["gallery", "kanban"].includes(data.viewType) ? getCardLayoutHTML(view) : ""}
</div>`;
};

export const bindLayoutEvent = (options: {
    protyle: IProtyle,
    data: IAV,
    menuElement: HTMLElement
    blockElement: Element
}) => {
    const avID = options.blockElement.getAttribute("data-av-id");
    const blockID = options.blockElement.getAttribute("data-node-id");
    const viewID = options.data.viewID || options.blockElement.getAttribute(Constants.CUSTOM_SY_AV_VIEW);
    const rerender = () => {
        options.menuElement.innerHTML = getLayoutHTML(options.data);
        const tabRect = options.blockElement.querySelector(".av__views").getBoundingClientRect();
        setPosition(options.menuElement, tabRect.right - options.menuElement.clientWidth,
            tabRect.bottom, tabRect.height, 0, true);
        bindLayoutEvent(options);
    };
    const toggleTitleElement = options.menuElement.querySelector('.b3-switch[data-type="toggle-view-title"]') as HTMLInputElement;
    toggleTitleElement.addEventListener("change", () => {
        const checked = toggleTitleElement.checked;
        transaction(options.protyle, [{
            action: "hideAttrViewName",
            avID,
            blockID,
            data: !checked,
            viewID
        }], [{
            action: "hideAttrViewName",
            avID,
            blockID,
            data: checked,
            viewID
        }]);
        options.data.view.hideAttrViewName = !checked;
    });
    const toggleIconElement = options.menuElement.querySelector('.b3-switch[data-type="toggle-entries-icons"]') as HTMLInputElement;
    toggleIconElement.addEventListener("change", () => {
        const checked = toggleIconElement.checked;
        transaction(options.protyle, [{
            action: "setAttrViewShowIcon",
            avID,
            blockID,
            data: checked,
            viewID
        }], [{
            action: "setAttrViewShowIcon",
            avID,
            blockID,
            data: !checked,
            viewID
        }]);
        options.data.view.showIcon = checked;
    });
    const toggleWrapElement = options.menuElement.querySelector('.b3-switch[data-type="toggle-entries-wrap"]') as HTMLInputElement;
    toggleWrapElement.addEventListener("change", () => {
        const checked = toggleWrapElement.checked;
        transaction(options.protyle, [{
            action: "setAttrViewWrapField",
            avID,
            blockID,
            data: checked,
            viewID
        }], [{
            action: "setAttrViewWrapField",
            avID,
            blockID,
            data: !checked,
            viewID
        }]);
        getFieldsByData(options.data).forEach(item => {
            item.wrap = checked;
        });
        options.data.view.wrapField = checked;
    });
    if (options.data.viewType === "table") {
        return options.data;
    }
    const cardLayoutElement = options.menuElement.querySelector('select[data-type="set-card-layout"]') as HTMLSelectElement;
    cardLayoutElement.addEventListener("change", () => {
        const view = options.data.view as IAVGallery | IAVKanban;
        const oldLayout = view.cardLayout;
        const cardLayout = parseInt(cardLayoutElement.value);
        transaction(options.protyle, [{
            action: "setAttrViewCardLayout",
            avID,
            blockID,
            data: cardLayout,
            viewID
        }], [{
            action: "setAttrViewCardLayout",
            avID,
            blockID,
            data: oldLayout,
            viewID
        }]);
        view.cardLayout = cardLayout;
        rerender();
    });
    options.menuElement.querySelectorAll('input[data-type="toggle-card-full-row"]').forEach((item: HTMLInputElement) => {
        item.addEventListener("change", () => {
            const field = (options.data.view as IAVGallery | IAVKanban).fields.find((fieldItem) => {
                return fieldItem.id === item.dataset.id;
            });
            if (!field) {
                return;
            }
            const oldFullRow = !!field.fullRow;
            transaction(options.protyle, [{
                action: "setAttrViewColFullRow",
                id: field.id,
                avID,
                blockID,
                data: item.checked,
                viewID
            }], [{
                action: "setAttrViewColFullRow",
                id: field.id,
                avID,
                blockID,
                data: oldFullRow,
                viewID
            }]);
            field.fullRow = item.checked;
        });
    });
    const toggleFitElement = options.menuElement.querySelector('.b3-switch[data-type="toggle-gallery-fit"]') as HTMLInputElement;
    toggleFitElement?.addEventListener("change", () => {
        const checked = toggleFitElement.checked;
        transaction(options.protyle, [{
            action: "setAttrViewFitImage",
            avID,
            blockID,
            data: checked,
            viewID
        }], [{
            action: "setAttrViewFitImage",
            avID,
            blockID,
            data: !checked,
            viewID
        }]);
        (options.data.view as IAVGallery).fitImage = checked;
    });
    const toggleNameElement = options.menuElement.querySelector('.b3-switch[data-type="toggle-gallery-name"]') as HTMLInputElement;
    toggleNameElement?.addEventListener("change", () => {
        const checked = toggleNameElement.checked;
        transaction(options.protyle, [{
            action: "setAttrViewDisplayFieldName",
            avID,
            blockID,
            data: checked,
            viewID
        }], [{
            action: "setAttrViewDisplayFieldName",
            avID,
            blockID,
            data: !checked,
            viewID
        }]);
        (options.data.view as IAVGallery | IAVKanban).displayFieldName = checked;
        rerender();
    });
    const toggleEmptyElement = options.menuElement.querySelector('.b3-switch[data-type="toggle-gallery-empty"]') as HTMLInputElement;
    toggleEmptyElement.addEventListener("change", () => {
        const checked = toggleEmptyElement.checked;
        transaction(options.protyle, [{
            action: "setAttrViewDisplayEmptyFields",
            avID,
            blockID,
            data: checked,
            viewID
        }], [{
            action: "setAttrViewDisplayEmptyFields",
            avID,
            blockID,
            data: !checked,
            viewID
        }]);
        (options.data.view as IAVGallery | IAVKanban).displayEmptyFields = checked;
    });
    if (options.data.viewType === "calendar") {
        bindCalendarLayoutEvent(options, avID, blockID, viewID);
        return options.data;
    }
    if (options.data.viewType === "gallery") {
        return options.data;
    }
    const toggleBgElement = options.menuElement.querySelector('.b3-switch[data-type="toggle-kanban-bg"]') as HTMLInputElement;
    toggleBgElement?.addEventListener("change", () => {
        const checked = toggleBgElement.checked;
        transaction(options.protyle, [{
            action: "setAttrViewFillColBackgroundColor",
            avID,
            blockID,
            data: checked,
            viewID
        }], [{
            action: "setAttrViewFillColBackgroundColor",
            avID,
            blockID,
            data: !checked,
            viewID
        }]);
        (options.data.view as IAVKanban).fillColBackgroundColor = checked;
    });
};

const importCalendarICS = async (options: {
    protyle: IProtyle,
    data: IAV,
    menuElement: HTMLElement
    blockElement: Element
}, avID: string, blockID: string, viewID: string, input: HTMLInputElement) => {
    const file = input.files?.[0];
    if (!file) {
        return;
    }
    const button = input.closest('[data-type="calendar-import-ics-button"]') as HTMLButtonElement;
    const status = options.menuElement.querySelector('[data-type="calendar-import-ics-status"]') as HTMLElement;
    input.disabled = true;
    if (button) {
        button.disabled = true;
    }
    try {
        const events = parseICSCalendar(decodeICSBytes(await file.arrayBuffer()));
        if (events.length === 0) {
            const message = `${window.siyuan.languages.import || "Import"}: ${window.siyuan.languages.empty || "Empty"}`;
            status.textContent = message;
            showMessage(message, 6000, "error");
            return;
        }
        const calendarView = options.data.view as IAVCalendar;
        let mapping = getCalendarFieldMapping(calendarView);
        if (!mapping.dateFieldID) {
            const message = window.siyuan.languages.calendarNeedDateField || window.siyuan.languages.dateField || "Calendar requires a date field";
            status.textContent = message;
            showMessage(message, 6000, "error");
            return;
        }
        const needsRecurrenceStorage = events.some(event => event.draft.recurrenceRaw || event.draft.recurrenceExceptionRaw);
        mapping = await ensureCalendarRecurrenceStorage({
            protyle: options.protyle,
            calendarData: calendarView,
            mapping,
            avID,
            blockID,
            viewID,
            storageRequired: needsRecurrenceStorage,
        });
        if (needsRecurrenceStorage && (!mapping.recurrenceFieldID || !mapping.exceptionFieldID)) {
            const message = window.siyuan.languages.calendarCreateFailed || "Create failed.";
            status.textContent = message;
            showMessage(message, 6000, "error");
            return;
        }
        const createsDocuments = getCalendarNewItemTarget(calendarView) === CALENDAR_NEW_ITEM_TARGET_DOCUMENT;
        let imported = 0;
        for (const event of events) {
            const createOptions: ICalendarCreateOptions = {
                protyle: options.protyle,
                avID,
                blockID,
                viewID,
                dateFieldID: mapping.dateFieldID,
                fields: calendarView.fields,
                mapping,
                draft: {
                    ...event.draft,
                    title: event.draft.title || window.siyuan.languages.untitled,
                },
                previousUpdated: options.blockElement.getAttribute("updated") || "",
            };
            const created = createsDocuments ?
                Boolean(await createCalendarEventAsDocument({...createOptions, templateID: options.data.defaultTemplateID || ""})) :
                await createCalendarEvent(createOptions);
            if (created) {
                imported++;
            }
            status.textContent = `${window.siyuan.languages.import || "Import"}: ${imported}/${events.length}`;
        }
        options.blockElement.removeAttribute("data-render");
        const message = `${window.siyuan.languages.imported || "Import completed"}: ${imported}/${events.length}`;
        status.textContent = message;
        showMessage(message, imported === events.length ? 3000 : 6000, imported === events.length ? undefined : "error");
    } catch (error) {
        console.error("Importing ICS failed", error);
        const message = window.siyuan.languages.calendarCreateFailed || "Create failed.";
        status.textContent = message;
        showMessage(message, 6000, "error");
    } finally {
        input.value = "";
        input.disabled = false;
        if (button) {
            button.disabled = false;
        }
    }
};

const bindCalendarLayoutEvent = (options: {
    protyle: IProtyle,
    data: IAV,
    menuElement: HTMLElement
    blockElement: Element
}, avID: string, blockID: string, viewID: string) => {
    const calendarView = options.data.view as IAVCalendar;
    const dateFieldElement = options.menuElement.querySelector('select[data-type="calendar-date-field"]') as HTMLSelectElement;
    dateFieldElement?.addEventListener("change", () => {
        const previous = calendarView.dateFieldID || "";
        const current = dateFieldElement.value;
        transaction(options.protyle, [{
            action: "setAttrViewCalendarDateField",
            avID,
            blockID,
            keyID: current,
            data: current,
            viewID
        }], [{
            action: "setAttrViewCalendarDateField",
            avID,
            blockID,
            keyID: previous,
            data: previous,
            viewID
        }]);
        calendarView.dateFieldID = current;
    });
    const weekStartElement = options.menuElement.querySelector('select[data-type="calendar-week-start"]') as HTMLSelectElement;
    weekStartElement?.addEventListener("change", () => {
        const previous = calendarView.weekStart || 0;
        const current = parseInt(weekStartElement.value, 10);
        transaction(options.protyle, [{
            action: "setAttrViewCalendarWeekStart",
            avID,
            blockID,
            data: current,
            viewID
        }], [{
            action: "setAttrViewCalendarWeekStart",
            avID,
            blockID,
            data: previous,
            viewID
        }]);
        calendarView.weekStart = current;
    });
    // "New entries": Page creates a real SiYuan document per entry and binds the
    // row to it; Row only keeps the historic detached row. Mirrors the week-start
    // setter, including viewID, because the target is per view.
    const newItemTargetElement = options.menuElement.querySelector('select[data-type="calendar-new-item-target"]') as HTMLSelectElement;
    newItemTargetElement?.addEventListener("change", () => {
        // The undo value is the RAW persisted one: "" (a pre-upgrade view) is a
        // valid target for the kernel and must not be normalised to "row" here,
        // or undo would rewrite av.json with a value the view never had.
        const previous = getCalendarNewItemTarget(calendarView);
        const current = newItemTargetElement.value === CALENDAR_NEW_ITEM_TARGET_DOCUMENT ?
            CALENDAR_NEW_ITEM_TARGET_DOCUMENT : CALENDAR_NEW_ITEM_TARGET_ROW;
        if (current === previous) {
            return;
        }
        // Cast: TOperation in app/src/types/index.d.ts does not list
        // "setAttrViewCalendarNewItemTarget" yet (that file belongs to another
        // agent in this change). The kernel already routes it -
        // kernel/model/transaction.go:417 -> doSetAttrViewCalendarNewItemTarget.
        // Drop the casts once the union gains the member.
        transaction(options.protyle, [{
            action: "setAttrViewCalendarNewItemTarget",
            avID,
            blockID,
            data: current,
            viewID
        }], [{
            action: "setAttrViewCalendarNewItemTarget",
            avID,
            blockID,
            data: previous,
            viewID
        }]);
        calendarView.newItemTarget = current;
        // The panel holds its own copy of the view, and
        // "setAttrViewCalendarNewItemTarget" is not in the refresh list of
        // app/src/protyle/wysiwyg/transaction.ts (not our file), so the rendered
        // calendar would keep creating with the old target until something else
        // re-rendered it. This override is what calendar/render.ts reads until
        // the kernel confirms the new value.
        options.blockElement.setAttribute("data-calendar-new-item-target", current);
    });
    const bindVisibleField = (checkbox: HTMLInputElement) => {
        checkbox.addEventListener("change", () => {
            const fieldID = checkbox.dataset.fieldId;
            const field = calendarView.fields.find(candidate => candidate.id === fieldID);
            if (!fieldID || !field) return;
            transaction(options.protyle, [{
                action: "setAttrViewColHidden", id: fieldID, avID, blockID, viewID, data: !checkbox.checked,
            }], [{
                action: "setAttrViewColHidden", id: fieldID, avID, blockID, viewID, data: checkbox.checked,
            }]);
            field.hidden = !checkbox.checked;
        });
    };
    options.menuElement.querySelectorAll('[data-type="calendar-visible-field"]').forEach(item => bindVisibleField(item as HTMLInputElement));
    const addFieldButton = options.menuElement.querySelector('[data-type="calendar-add-visible-field"]') as HTMLButtonElement;
    const newFieldInput = options.menuElement.querySelector('[data-type="calendar-new-field-name"]') as HTMLInputElement;
    const addVisibleField = () => {
        const name = newFieldInput?.value.trim();
        if (!name) return;
        const id = Lute.NewNodeID();
        const previousID = getFieldsByData(options.data).at(-1)?.id || "";
        transaction(options.protyle, [{action: "addAttrViewCol", avID, name, type: "text", id, previousID}], [{action: "removeAttrViewCol", avID, id}]);
        calendarView.fields.push({id, name, type: "text", hidden: false, icon: "", wrap: calendarView.wrapField, desc: "", calc: undefined, numberFormat: "", template: "", pin: false, width: "", align: ""});
        newFieldInput.value = "";
        const list = options.menuElement.querySelector(".av__calendar-visible-fields");
        if (list) {
            const label = document.createElement("label");
            label.className = "b3-list-item b3-list-item--narrow";
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.dataset.type = "calendar-visible-field";
            checkbox.dataset.fieldId = id;
            checkbox.checked = true;
            const text = document.createElement("span");
            text.className = "b3-list-item__text";
            text.textContent = name;
            label.append(checkbox, text);
            list.append(label);
            bindVisibleField(checkbox);
        }
    };
    addFieldButton?.addEventListener("click", addVisibleField);
    newFieldInput?.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            addVisibleField();
        }
    });
    const importICSInput = options.menuElement.querySelector('[data-type="calendar-import-ics"]') as HTMLInputElement;
    importICSInput?.addEventListener("change", () => {
        void importCalendarICS(options, avID, blockID, viewID, importICSInput);
    });
};

export const updateLayout = async (options: {
    data: IAV
    nodeElement: Element,
    protyle: IProtyle,
    target: HTMLElement
}) => {
    if (options.target.classList.contains("av__layout-item--select") || options.target.dataset.load === "true") {
        return;
    }
    options.target.dataset.load = "true";
    options.target.parentElement.querySelector(".av__layout-item--select").classList.remove("av__layout-item--select");
    options.target.classList.add("av__layout-item--select");
    const response = await fetchSyncPost("/api/av/changeAttrViewLayout", {
        blockID: options.nodeElement.getAttribute("data-node-id"),
        avID: options.nodeElement.getAttribute("data-av-id"),
        layoutType: options.target.getAttribute("data-view-type")
    });
    const menuElement = document.querySelector(".av__panel").lastElementChild as HTMLElement;
    menuElement.innerHTML = getLayoutHTML(response.data);
    // 切换布局类型后菜单高度变化（如表格→看板），需重新定位避免底部溢出视窗
    const tabRect = options.nodeElement.querySelector(".av__views").getBoundingClientRect();
    setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height, 0, true);
    bindLayoutEvent({
        protyle: options.protyle,
        data: response.data,
        menuElement,
        blockElement: options.nodeElement
    });
    options.target.removeAttribute("data-load");
    return response.data;
};
