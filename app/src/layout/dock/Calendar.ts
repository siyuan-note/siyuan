import * as dayjs from "dayjs";
import {App} from "../../index";
import {Model} from "../Model";
import {Tab} from "../Tab";
import {Constants} from "../../constants";
import {fetchSyncPost} from "../../util/fetch";
import {setStorageVal} from "../../protyle/util/compatibility";
import {getCalendarFieldMapping} from "../../protyle/render/av/calendar/mapped-fields";
import {normalizeCalendarEvents} from "../../protyle/render/av/calendar/normalize";
import {getEventDocumentID, ICalendarNormalizedEvent} from "../../protyle/render/av/calendar/model";
import {getCalendarMiniMonthEventDays, renderCalendarMiniMonth} from "../../protyle/render/av/calendar/mini-month";
import {openFileById} from "../../editor/util";
import {showMessage} from "../../dialog/message";
import {renderCalendarDockPeriod} from "./calendar-period";

interface ICalendarViewRef {
    avID: string;
    blockID: string;
    viewID: string;
    viewName: string;
    databaseName: string;
    hPath: string;
}

interface ICalendarSource {
    ref: ICalendarViewRef;
    data?: IAV;
    error?: string;
}

type TCalendarDockView = "day" | "month" | "agenda";

interface ICalendarDockStorage {
    sources: string[];
    view: TCalendarDockView;
    anchor: string;
}

interface ICalendarDockEvent {
    key: string;
    event: ICalendarNormalizedEvent;
    source: ICalendarSource;
}

const STORAGE_KEY = Constants.LOCAL_CALENDAR_DOCK;
const VALID_VIEWS = new Set<TCalendarDockView>(["day", "month", "agenda"]);
const rangeForMonth = (anchor: dayjs.Dayjs) => ({
    start: anchor.startOf("month").startOf("week"),
    end: anchor.endOf("month").endOf("week"),
});

const escape = (value: string) => value.replace(/[&<>"']/g, item => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"}[item]));
const lang = (key: string, fallback: string) => window.siyuan.languages[key] || fallback;
const getSafeCalendarColor = (value?: string) => {
    const color = value?.trim() || "";
    return /^(?:#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([0-9\s.,%/-]+\)|var\(--[a-z0-9_-]+\))$/i.test(color) ? color : "var(--b3-theme-primary)";
};
const formatDate = (date: dayjs.Dayjs, options: Intl.DateTimeFormatOptions) => {
    try {
        return new Intl.DateTimeFormat(window.siyuan.config.lang, options).format(date.toDate());
    } catch {
        return new Intl.DateTimeFormat(undefined, options).format(date.toDate());
    }
};

export class Calendar extends Model {
    private element: HTMLElement;
    private selected: string[] = [];
    private available: ICalendarViewRef[] = [];
    private sources: ICalendarSource[] = [];
    private events = new Map<string, ICalendarDockEvent>();
    private anchor = dayjs();
    private view: TCalendarDockView = "agenda";
    private agendaScrollDate = "";
    private loading = false;

    constructor(app: App, tab: Tab) {
        super({app});
        this.element = tab.panelElement;
        this.element.classList.add("fn__flex-column", "file-tree", "sy__calendar", "dockPanel");
        this.restoreState();
        this.renderShell();
        this.bindShell();
        void this.refresh();
    }

    private restoreState() {
        try {
            const stored = window.siyuan.storage?.[STORAGE_KEY] as ICalendarDockStorage | string[] | undefined;
            if (Array.isArray(stored)) {
                this.selected = stored.filter(item => typeof item === "string");
            } else if (stored && typeof stored === "object") {
                this.selected = Array.isArray(stored.sources) ? stored.sources.filter(item => typeof item === "string") : [];
                this.view = VALID_VIEWS.has(stored.view) ? stored.view : "agenda";
                const anchor = dayjs(stored.anchor);
                this.anchor = anchor.isValid() ? anchor : dayjs();
            }
        } catch {
            this.selected = [];
            this.view = "agenda";
            this.anchor = dayjs();
        }
        if (this.view === "agenda") {
            this.anchor = dayjs();
            this.agendaScrollDate = this.anchor.format("YYYY-MM-DD");
        }
    }

    private saveState() {
        setStorageVal(STORAGE_KEY, {
            sources: this.selected,
            view: this.view,
            anchor: this.anchor.format("YYYY-MM-DD"),
        } satisfies ICalendarDockStorage);
    }

    private renderShell() {
        this.element.innerHTML = `<div class="block__icons">
    <div class="block__logo fn__flex-1">${escape(window.siyuan.languages.calendar || "Calendar")}</div>
    <span data-type="today" class="block__icon ariaLabel" aria-label="${escape(lang("calendarJumpToToday", "Go to today"))}"><svg><use xlink:href="#iconCalendar"></use></svg></span>
    <span data-type="refresh" class="block__icon ariaLabel" aria-label="${escape(window.siyuan.languages.refresh)}"><svg><use xlink:href="#iconRefresh"></use></svg></span>
    <span data-type="prev" class="block__icon ariaLabel" aria-label="${escape(lang("calendarPreviousRange", "Previous period"))}"><svg><use xlink:href="#iconLeft"></use></svg></span>
    <span data-type="next" class="block__icon ariaLabel" aria-label="${escape(lang("calendarNextRange", "Next period"))}"><svg><use xlink:href="#iconRight"></use></svg></span>
    <span data-type="min" class="block__icon ariaLabel" aria-label="${escape(window.siyuan.languages.min)}"><svg><use xlink:href="#iconMin"></use></svg></span>
</div>
<div class="av__calendar-dock-content fn__flex-1"></div>`;
    }

    private bindShell() {
        this.element.addEventListener("click", event => {
            const target = (event.target as HTMLElement).closest("[data-type]") as HTMLElement;
            if (!target || !this.element.contains(target)) return;
            switch (target.dataset.type) {
                case "refresh":
                    void this.refresh();
                    break;
                case "today":
                    this.anchor = dayjs();
                    if (this.view === "agenda") this.agendaScrollDate = this.anchor.format("YYYY-MM-DD");
                    this.saveState();
                    void this.render();
                    break;
                case "prev":
                    this.moveAnchor(-1);
                    break;
                case "next":
                    this.moveAnchor(1);
                    break;
                case "min":
                    window.siyuan.layout.leftDock?.toggleModel("calendar", false, true);
                    break;
                case "toggle-databases":
                    this.element.querySelector('[data-type="database-options"]')?.classList.toggle("fn__none");
                    break;
                case "select-source": {
                    const id = (target as HTMLInputElement).value || target.dataset.id;
                    if (!id) return;
                    this.selected = (target as HTMLInputElement).checked ? [...new Set([...this.selected, id])] : this.selected.filter(item => item !== id);
                    this.saveState();
                    void this.refresh();
                    break;
                }
                case "calendar-dock-view": {
                    const view = target.dataset.view as TCalendarDockView;
                    if (!VALID_VIEWS.has(view) || view === this.view) return;
                    this.view = view;
                    if (view === "agenda") {
                        this.anchor = dayjs();
                        this.agendaScrollDate = this.anchor.format("YYYY-MM-DD");
                    } else {
                        this.agendaScrollDate = "";
                    }
                    this.saveState();
                    void this.render();
                    break;
                }
                case "calendar-mini-prev":
                    this.anchor = this.anchor.subtract(1, "month");
                    this.saveState();
                    void this.render();
                    break;
                case "calendar-mini-next":
                    this.anchor = this.anchor.add(1, "month");
                    this.saveState();
                    void this.render();
                    break;
                case "calendar-mini-day":
                case "calendar-dock-date": {
                    const date = dayjs(target.dataset.date);
                    if (!date.isValid()) return;
                    this.anchor = date;
                    this.saveState();
                    void this.render();
                    break;
                }
                case "calendar-open-event":
                    this.openEvent(target.dataset.eventKey || "");
                    break;
            }
        });
    }

    private moveAnchor(direction: -1 | 1) {
        this.anchor = this.view === "day" ? this.anchor.add(direction, "day") : this.anchor.add(direction, "month");
        this.agendaScrollDate = "";
        this.saveState();
        void this.render();
    }

    private async discover(): Promise<ICalendarViewRef[]> {
        const response = await fetchSyncPost("/api/av/searchAttributeView", {keyword: "", avID: "", blockID: "", excludes: []});
        const results = response?.data?.results || [];
        const refs = new Map<string, ICalendarViewRef>();
        results.forEach((item: any) => {
            const calendarView = (item.children || []).find((child: any) => child.viewLayout === "calendar" && child.viewID);
            if (!calendarView || refs.has(calendarView.avID)) return;
            const hPath = calendarView.hPath || item.hPath || "";
            const databaseName = item.avName || calendarView.avName || hPath.split("/").filter(Boolean).at(-1) || calendarView.avID;
            refs.set(calendarView.avID, {avID: calendarView.avID, blockID: calendarView.blockID, viewID: calendarView.viewID, viewName: calendarView.viewName || "Calendar", databaseName, hPath});
        });
        return [...refs.values()];
    }

    private async loadSource(ref: ICalendarViewRef): Promise<ICalendarSource> {
        const response = await fetchSyncPost("/api/av/renderAttributeView", {id: ref.avID, blockID: ref.blockID, viewID: ref.viewID, pageSize: -1, createIfNotExist: false});
        if (response?.code !== 0 || !response?.data) return {ref, error: response?.msg || "Unable to load calendar"};
        return {ref, data: response.data};
    }

    private async refresh() {
        if (this.loading) return;
        this.loading = true;
        try {
            this.available = await this.discover();
            const known = new Set(this.available.map(item => item.avID));
            this.selected = this.selected.filter(item => known.has(item));
            this.sources = await Promise.all(this.available.filter(item => this.selected.indexOf(item.avID) > -1).map(item => this.loadSource(item)));
            this.saveState();
            await this.render();
        } finally {
            this.loading = false;
        }
    }

    private collectEvents(): ICalendarDockEvent[] {
        const range = rangeForMonth(this.anchor);
        const events: ICalendarDockEvent[] = [];
        this.sources.forEach(source => {
            if (!source.data || source.data.viewType !== "calendar") return;
            const calendar = source.data.view as IAVCalendar;
            normalizeCalendarEvents(calendar, getCalendarFieldMapping(calendar), range).events.forEach(event => {
                const key = `${source.ref.avID}:${event.occurrenceID || event.id}`;
                events.push({key, event, source});
            });
        });
        events.sort((a, b) => a.event.start.valueOf() - b.event.start.valueOf());
        this.events = new Map(events.map(item => [item.key, item]));
        return events;
    }

    private renderViewSwitch() {
        const views: Array<{id: TCalendarDockView, label: string}> = [
            {id: "day", label: lang("calendarDay", "Day")},
            {id: "month", label: lang("calendarMonth", "Month")},
            {id: "agenda", label: lang("calendarSchedule", "Schedule")},
        ];
        return `<div class="av__calendar-dock-views" role="tablist" aria-label="${escape(lang("calendarShortcutsViews", "Views"))}">
            ${views.map(item => `<button type="button" class="b3-button${this.view === item.id ? " b3-button--primary" : " b3-button--outline"}" data-type="calendar-dock-view" data-view="${item.id}" role="tab" aria-selected="${this.view === item.id}">${escape(item.label)}</button>`).join("")}
        </div>`;
    }

    private renderSourcePicker() {
        const options = this.available.map(ref => `<label class="b3-list-item b3-list-item--narrow"><input type="checkbox" data-type="select-source" value="${escape(ref.avID)}"${this.selected.indexOf(ref.avID) > -1 ? " checked" : ""}><span class="b3-list-item__text" title="${escape(ref.hPath)}"><strong>${escape(ref.databaseName)}</strong><small>${escape(ref.hPath)}</small></span></label>`).join("");
        const selectedNames = this.available.filter(ref => this.selected.indexOf(ref.avID) > -1).map(ref => ref.databaseName);
        return `<div class="av__calendar-dock-database-picker"><button class="b3-button b3-button--outline fn__block" data-type="toggle-databases" title="${escape(selectedNames.join(", "))}">${escape(selectedNames.length ? selectedNames.join(", ") : (window.siyuan.languages.database || "Database"))}<svg><use xlink:href="#iconDown"></use></svg></button><div class="av__calendar-dock-sources fn__none" data-type="database-options">${options || `<div class="ft__on-surface">${escape(lang("calendarNoSources", "No calendar databases found"))}</div>`}</div></div>`;
    }

    private renderEvent(item: ICalendarDockEvent) {
        const event = item.event;
        const time = event.isAllDay ? lang("calendarAllDay", "All day") : `${event.start.format("HH:mm")}${event.end ? `–${event.end.format("HH:mm")}` : ""}`;
        return `<button type="button" class="b3-list-item b3-list-item--narrow av__calendar-dock-event" data-type="calendar-open-event" data-event-key="${escape(item.key)}" title="${escape(lang("calendarOpenSource", "Open source"))}">
            <span class="av__calendar-dock-event-dot" style="color:${escape(getSafeCalendarColor(event.color))}">●</span>
            <span class="b3-list-item__text"><strong>${escape(time)}</strong> <span class="av__calendar-dock-event-title">${escape(event.title)}</span><small>${escape(item.source.ref.databaseName)}</small></span>
        </button>`;
    }

    private eventOccursOn(item: ICalendarDockEvent, date: dayjs.Dayjs) {
        return item.event.start.isSame(date, "day") ||
            !!item.event.end && !date.isBefore(item.event.start, "day") && !date.isAfter(item.event.end, "day");
    }

    private renderEmpty() {
        return `<div class="ft__on-surface av__calendar-dock-empty">${escape(lang("calendarNoEvents", "No events"))}</div>`;
    }

    private renderDay(events: ICalendarDockEvent[]) {
        const dayEvents = events.filter(item => this.eventOccursOn(item, this.anchor));
        return `<section class="av__calendar-dock-day" aria-label="${escape(formatDate(this.anchor, {weekday: "long", year: "numeric", month: "long", day: "numeric"}))}">
            <button type="button" class="av__calendar-dock-date" data-type="calendar-dock-date" data-date="${this.anchor.format("YYYY-MM-DD")}">
                <span>${escape(formatDate(this.anchor, {weekday: "long"}))}</span>
                <strong>${this.anchor.date()}</strong>
                <small>${escape(formatDate(this.anchor, {month: "long", year: "numeric"}))}</small>
            </button>
            <div class="av__calendar-dock-events">${dayEvents.length ? dayEvents.map(item => this.renderEvent(item)).join("") : this.renderEmpty()}</div>
        </section>`;
    }

    private renderMonth(events: ICalendarDockEvent[]) {
        const miniMonth = renderCalendarMiniMonth({anchor: this.anchor, cursor: this.anchor, locale: window.siyuan.config.lang});
        const dayEvents = events.filter(item => this.eventOccursOn(item, this.anchor));
        return `<section class="av__calendar-dock-month-view">
            <div class="av__calendar-dock-mini">${miniMonth}</div>
            <div class="av__calendar-dock-selected-day"><strong>${escape(formatDate(this.anchor, {weekday: "long", month: "long", day: "numeric"}))}</strong></div>
            <div class="av__calendar-dock-events">${dayEvents.length ? dayEvents.map(item => this.renderEvent(item)).join("") : this.renderEmpty()}</div>
        </section>`;
    }

    private renderAgenda(events: ICalendarDockEvent[]) {
        const monthStart = this.anchor.startOf("month");
        const monthEnd = this.anchor.endOf("month");
        const grouped = new Map<string, ICalendarDockEvent[]>();
        events.forEach(item => {
            const eventEnd = item.event.end || item.event.start;
            if (eventEnd.isBefore(monthStart, "day") || item.event.start.isAfter(monthEnd, "day")) return;
            const key = (item.event.start.isBefore(monthStart, "day") ? monthStart : item.event.start).format("YYYY-MM-DD");
            grouped.set(key, [...(grouped.get(key) || []), item]);
        });
        const scrollDate = this.agendaScrollDate && this.anchor.isSame(dayjs(this.agendaScrollDate), "month") ? this.agendaScrollDate : "";
        const dates = [...grouped.keys()];
        const hasTodayGroup = !!scrollDate && grouped.has(scrollDate);
        const todayMarker = scrollDate && !hasTodayGroup ? `<div class="av__calendar-dock-agenda-day av__calendar-dock-agenda-today" data-calendar-agenda-scroll-target="true">
                <button type="button" class="av__calendar-dock-agenda-date" data-type="calendar-dock-date" data-date="${scrollDate}">${escape(window.siyuan.languages.today || "Today")} · ${escape(formatDate(dayjs(scrollDate), {weekday: "short", month: "short", day: "numeric"}))}</button>
            </div>` : "";
        if (!grouped.size) return `<section class="av__calendar-dock-agenda">${todayMarker}${this.renderEmpty()}</section>`;
        const todayMarkerIndex = todayMarker ? dates.findIndex(date => date > scrollDate) : -1;
        const scrollTarget = hasTodayGroup ? scrollDate : "";
        return `<section class="av__calendar-dock-agenda">
            ${[...grouped.entries()].map(([date, items], index) => `${index === todayMarkerIndex ? todayMarker : ""}<div class="av__calendar-dock-agenda-day"${date === scrollTarget ? ' data-calendar-agenda-scroll-target="true"' : ""}>
                <button type="button" class="av__calendar-dock-agenda-date" data-type="calendar-dock-date" data-date="${date}">${escape(formatDate(dayjs(date), {weekday: "short", month: "short", day: "numeric"}))}</button>
                <div class="av__calendar-dock-events">${items.map(item => this.renderEvent(item)).join("")}</div>
            </div>`).join("")}${todayMarker && todayMarkerIndex === -1 ? todayMarker : ""}
        </section>`;
    }

    private markMiniMonthEventDays(events: ICalendarDockEvent[]) {
        const eventDays = getCalendarMiniMonthEventDays(events.map(item => ({start: item.event.start, end: item.event.end})));
        eventDays.forEach(date => this.element.querySelector(`.av__calendar-mini-day[data-date="${date}"]`)?.classList.add("av__calendar-mini-day--has-events"));
    }

    private async render() {
        const content = this.element.querySelector(".av__calendar-dock-content") as HTMLElement;
        if (!content) return;
        const events = this.collectEvents();
        const title = formatDate(this.anchor, this.view === "day" ? {weekday: "long", month: "long", day: "numeric"} : {month: "long", year: "numeric"});
        const body = this.view === "day" ? this.renderDay(events) : this.view === "month" ? this.renderMonth(events) : this.renderAgenda(events);
        // Markup is static; every user-derived value is escaped and inline colours
        // pass through getSafeCalendarColor before insertion.
        content.innerHTML = `${this.renderViewSwitch()}${this.renderSourcePicker()}${renderCalendarDockPeriod(this.view, title)}${body}`;
        if (this.view === "month") this.markMiniMonthEventDays(events);
        if (this.view === "agenda" && this.agendaScrollDate) {
            this.agendaScrollDate = "";
            requestAnimationFrame(() => {
                const target = content.querySelector("[data-calendar-agenda-scroll-target]") as HTMLElement;
                if (target) content.scrollTop = Math.max(0, target.offsetTop - content.offsetTop);
            });
        }
    }

    private openEvent(key: string) {
        const item = this.events.get(key);
        if (!item) {
            showMessage(lang("calendarNoMatchingEvent", "No matching event"));
            return;
        }
        const documentID = getEventDocumentID(item.event);
        if (!documentID) {
            showMessage(lang("calendarSourceMissing", "Calendar item has no source block"));
            return;
        }
        openFileById({app: this.app, id: documentID, action: [Constants.CB_GET_FOCUS]});
    }
}

export const CALENDAR_DOCK_TYPE = "calendar";
