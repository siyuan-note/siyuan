import {Constants} from "../../../../constants";
import {calendarDay, getCalendarRange} from "./date";

interface ICalendarState {
    anchor: number;
    mode: "month" | "week";
    weekStart: number;
    dateType?: TAVCol;
    rowLimit?: number;
    expandedWeeks: Set<number>;
}

const states = new WeakMap<Element, Map<string, ICalendarState>>();

export const getCalendarState = (blockElement: Element, viewID = blockElement.getAttribute(Constants.CUSTOM_SY_AV_VIEW) || "") => {
    let views = states.get(blockElement);
    if (!views) {
        views = new Map();
        states.set(blockElement, views);
    }
    let state = views.get(viewID);
    if (!state) {
        state = {anchor: calendarDay(Date.now()), mode: "month", weekStart: 1, expandedWeeks: new Set()};
        views.set(viewID, state);
    }
    return state;
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
