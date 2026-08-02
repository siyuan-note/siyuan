const escape = (value: string) => value.replace(/[&<>"']/g, item => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"} as Record<string, string>)[item]);

/**
 * Outer period label of the Calendar dock.
 *
 * Month view suppresses it: the mini month navigator already renders the
 * month title between its previous/next arrows, so keeping both would
 * duplicate the month title. Day and Schedule (agenda) keep their labels.
 */
export const renderCalendarDockPeriod = (view: "day" | "month" | "agenda", title: string): string =>
    view === "month" ? "" : `<div class="av__calendar-dock-period" aria-live="polite">${escape(title)}</div>`;
