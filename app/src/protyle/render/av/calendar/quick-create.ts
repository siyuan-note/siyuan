import {showMessage} from "../../../../dialog/message";
import {escapeAttr, escapeHtml} from "../../../../util/escape";
import {ICalendarEventDraft} from "./model";

export interface IQuickCreateOptions {
    target: HTMLElement;
    draft: ICalendarEventDraft;
    top?: number;
    onSave: (draft: ICalendarEventDraft) => Promise<void> | void;
    onMoreOptions: (draft: ICalendarEventDraft) => void;
    onCancel: () => void;
}

const getDateTimeSummary = (draft: ICalendarEventDraft) => {
    if (draft.isAllDay) {
        return draft.endDate && draft.endDate !== draft.date ? `${draft.date} - ${draft.endDate}` : draft.date;
    }
    return `${draft.date} ${draft.startTime} - ${draft.endTime}`;
};

// This popover only collects the draft; WHAT gets created is the caller's
// decision (render.ts branches on the view's new-entry target: a real SiYuan
// document bound to the row, or a detached row). The calendar never keeps a
// separate event store either way.
//
// onSave is awaited, so the popover stays disabled until it settles: that is
// what makes a rejected row-only save show its reason inline instead of closing
// on a write that never landed. The page-creating path deliberately resolves
// immediately and reconciles an optimistic chip afterwards, because creating a
// document takes createDocLock and flushes the transaction queue three times -
// far too long to hold a popover open in front of the user.
export const openQuickCreate = (options: IQuickCreateOptions) => {
    document.querySelectorAll(".av__calendar-quick-create").forEach((item) => item.remove());
    const {target, draft} = options;
    const panel = document.createElement("div");
    panel.className = "av__calendar-quick-create";
    if (typeof options.top === "number") {
        panel.style.setProperty("--calendar-quick-create-top", `${options.top}px`);
    }
    panel.innerHTML = `<div class="av__calendar-quick-create-summary" data-type="calendar-quick-create-summary">${escapeHtml(getDateTimeSummary(draft))}</div>
<input class="b3-text-field av__calendar-quick-create-title" data-type="calendar-quick-create-title" placeholder="${escapeAttr(window.siyuan.languages.title || "Title")}" value="${escapeAttr(draft.title || "")}">
<label class="av__calendar-quick-create-check"><input type="checkbox" data-type="calendar-quick-create-all-day"${draft.isAllDay ? " checked" : ""}> ${escapeHtml(window.siyuan.languages.calendarAllDay || "All day")}</label>
<div class="ft__on-surface ft__smaller" data-type="calendar-quick-create-error" aria-live="polite"></div>
<div class="av__calendar-quick-create-actions">
    <button class="b3-button b3-button--cancel" data-type="calendar-quick-create-cancel">${window.siyuan.languages.cancel}</button>
    <button class="b3-button b3-button--outline" data-type="calendar-quick-create-more">${window.siyuan.languages.more || "More"}</button>
    <button class="b3-button b3-button--text" data-type="calendar-quick-create-save">${window.siyuan.languages.save}</button>
</div>`;
    target.appendChild(panel);
    const summaryElement = panel.querySelector('[data-type="calendar-quick-create-summary"]') as HTMLElement;
    const titleInput = panel.querySelector('[data-type="calendar-quick-create-title"]') as HTMLInputElement;
    const allDayInput = panel.querySelector('[data-type="calendar-quick-create-all-day"]') as HTMLInputElement;
    const errorElement = panel.querySelector('[data-type="calendar-quick-create-error"]') as HTMLElement;
    const saveButton = panel.querySelector('[data-type="calendar-quick-create-save"]') as HTMLButtonElement;
    const cancelButton = panel.querySelector('[data-type="calendar-quick-create-cancel"]') as HTMLButtonElement;
    const moreButton = panel.querySelector('[data-type="calendar-quick-create-more"]') as HTMLButtonElement;
    let pending = false;
    const setPending = (value: boolean) => {
        pending = value;
        saveButton.disabled = value;
        cancelButton.disabled = value;
        moreButton.disabled = value;
        panel.classList.toggle("is--saving", value);
        if (value) {
            panel.setAttribute("aria-busy", "true");
            saveButton.setAttribute("aria-busy", "true");
        } else {
            panel.removeAttribute("aria-busy");
            saveButton.removeAttribute("aria-busy");
        }
    };
    const close = () => {
        if (pending) {
            return;
        }
        panel.remove();
        options.onCancel();
    };
    const getDraft = () => ({...draft, title: titleInput.value.trim(), isAllDay: allDayInput.checked});
    const save = async () => {
        if (pending || saveButton.disabled) {
            return;
        }
        const nextDraft = getDraft();
        if (!nextDraft.title) {
            errorElement.textContent = `${window.siyuan.languages.title || "Title"} ${window.siyuan.languages.invalid || "Invalid"}`;
            titleInput.focus();
            return;
        }
        setPending(true);
        try {
            await options.onSave(nextDraft);
            panel.remove();
        } catch (error) {
            setPending(false);
            errorElement.textContent = error instanceof Error ? error.message : (window.siyuan.languages._kernel?.[29] || "Save failed");
            showMessage(errorElement.textContent);
        }
    };
    panel.querySelector('[data-type="calendar-quick-create-cancel"]')?.addEventListener("click", close);
    moreButton.addEventListener("click", () => {
        if (pending || moreButton.disabled) {
            return;
        }
        panel.remove();
        options.onMoreOptions(getDraft());
    });
    allDayInput.addEventListener("change", () => {
        summaryElement.textContent = getDateTimeSummary(getDraft());
    });
    saveButton.addEventListener("click", () => save());
    titleInput.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.key === "Enter") {
            event.preventDefault();
            save();
        } else if (event.key === "Escape") {
            event.preventDefault();
            close();
        }
    });
    titleInput.focus();
    titleInput.select();
    // Global click/focus handlers (and bare X servers) can asynchronously drop
    // focus back to <body> right after the popover opens; reclaim it briefly so
    // typing always lands in the title input, without fighting a deliberate
    // focus move to another control.
    const focusGuardDeadline = Date.now() + 250;
    const reclaimFocus = () => {
        if (!panel.isConnected || Date.now() > focusGuardDeadline) {
            return;
        }
        if (document.activeElement === document.body || document.activeElement === null) {
            titleInput.focus();
            if (titleInput.value === (draft.title || "")) {
                titleInput.select();
            }
        }
        window.requestAnimationFrame(reclaimFocus);
    };
    window.requestAnimationFrame(reclaimFocus);
    return panel;
};
