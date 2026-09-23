import {addCalendarDays} from "./date";

export const getCalendarDropDay = (root: HTMLElement, x: number, y: number) => {
    const viewport = root.querySelector<HTMLElement>(".av__calendar-scroll").getBoundingClientRect();
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
