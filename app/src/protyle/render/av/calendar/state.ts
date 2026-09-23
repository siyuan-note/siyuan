import {Constants} from "../../../../constants";
import {calendarDay, getCalendarRange} from "./date";

export interface ICalendarState {
    anchor: number;
    mode: "month" | "week";
    weekStart: number;
    dateType?: TAVCol;
    rowLimit?: number;
    expandedWeeks: Set<number>;
    undatedOpen: boolean;
    undatedSearch: string;
}

const states = new WeakMap<Element, Map<string, ICalendarState>>();

const getModeKey = (blockElement: Element, viewID: string) => {
    const avID = blockElement.getAttribute("data-av-id");
    return avID && viewID ? `${avID}:${viewID}` : "";
};

const getSavedMode = (blockElement: Element, viewID: string): ICalendarState["mode"] => {
    const key = getModeKey(blockElement, viewID);
    return key && window.siyuan.storage?.[Constants.LOCAL_AV_CALENDAR_MODES]?.[key] === "week" ? "week" : "month";
};

export const getCalendarState = (blockElement: Element, viewID = blockElement.getAttribute(Constants.CUSTOM_SY_AV_VIEW) || "") => {
    let views = states.get(blockElement);
    if (!views) {
        views = new Map();
        states.set(blockElement, views);
    }
    let state = views.get(viewID);
    if (!state) {
        state = {anchor: calendarDay(Date.now()), mode: getSavedMode(blockElement, viewID), weekStart: 1,
            expandedWeeks: new Set(), undatedOpen: false, undatedSearch: ""};
        views.set(viewID, state);
    }
    return state;
};

export const setCalendarMode = (blockElement: Element, viewID: string, mode: ICalendarState["mode"]) => {
    getCalendarState(blockElement, viewID).mode = mode;
    const key = getModeKey(blockElement, viewID);
    if (!key || !window.siyuan.storage) {
        return;
    }
    const stored = window.siyuan.storage[Constants.LOCAL_AV_CALENDAR_MODES];
    const modes = stored && typeof stored === "object" && !Array.isArray(stored) ? {...stored} : {};
    if (mode === "week") {
        modes[key] = mode;
    } else {
        delete modes[key];
    }
    window.siyuan.storage[Constants.LOCAL_AV_CALENDAR_MODES] = modes;
    return modes;
};

export const getCalendarRequestRange = (blockElement: Element, viewID?: string) => {
    const state = getCalendarState(blockElement, viewID);
    return getCalendarRange(state.anchor, state.mode, state.weekStart);
};

export const getCalendarCreationDate = (blockElement: Element) => {
    const state = getCalendarState(blockElement);
    if (blockElement.getAttribute("data-av-type") === "calendar" && state.dateType === "date") {
        return state.anchor;
    }
};
