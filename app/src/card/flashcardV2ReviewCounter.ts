import {showMessage} from "../dialog/message";
import {AdaptiveDialog} from "../dialog/adaptiveDialog";
import {hideTooltip, showTooltip} from "../dialog/tooltip";
import {escapeAttr, escapeHtml} from "../util/escape";
import {fetchPost} from "../util/fetch";
import type {flashcardV2QueueBreakdown} from "./flashcardV2Queue";
import {priorityLabel, reviewStateLabel} from "./flashcardV2Study";

type QueueProgress = ReturnType<typeof flashcardV2QueueBreakdown>;

export const flashcardV2ReviewCounterHTML = (mobile: boolean) => `<button type="button" data-flashcard-counter class="b3-button b3-button--text card__v2-queue-counter" ${mobile ? 'aria-haspopup="dialog"' : 'aria-pressed="false"'} aria-label="${escapeAttr(window.siyuan.languages.flashcardSessionProgress)}">
<svg aria-hidden="true"><use xlink:href="#iconInfo"></use></svg><span data-flashcard-count></span></button>`;

const reviewDetailsHTML = (progress: QueueProgress, priority?: string) => {
    const lang = window.siyuan.languages;
    const rows = [
        [lang.flashcardSessionCompleted, progress.completed],
        [lang.flashcardSessionRemaining, progress.remaining],
        [lang.total, progress.total],
        ...(progress.skipped ? [[lang.flashcardSessionSkipped, progress.skipped]] : []),
    ];
    const states = (["new", "learning", "review", "relearning"] as const)
        .map(state => [reviewStateLabel(state), progress[state]]);
    const group = (items: (string | number)[][]) => `<dl class="card__v2-queue-stats">${items.map(([label, value]) =>
        `<dt>${escapeHtml(String(label))}</dt><dd>${escapeHtml(String(value))}</dd>`).join("")}</dl>`;
    return group(rows) + group(states) + (priority === undefined ? "" : group([[lang.flashcardPriority, priority]]));
};

export const bindFlashcardV2ReviewCounter = (root: HTMLElement, mobile: boolean, cardID: () => string | undefined) => {
    const button = root.querySelector<HTMLButtonElement>("[data-flashcard-counter]");
    const count = button.querySelector<HTMLElement>("[data-flashcard-count]");
    const listeners = new AbortController();
    const options = {signal: listeners.signal};
    let progress: QueueProgress;
    let priority: string;
    let priorityCardID: string;
    let details: AdaptiveDialog;
    let tooltip = false;
    let hidden = false;

    const tooltipOpen = () => document.getElementById("tooltip")?.classList.contains("tooltip--flashcard-counter");
    const renderDetails = (event?: MouseEvent) => {
        const selected = cardID();
        if (priorityCardID !== selected) {
            priorityCardID = selected;
            priority = undefined;
            if (selected) {
                void fetchPost("/api/flashcard/queryCards", {
                    query: {version: 1, root: {operator: "predicate", field: "cardID", comparator: "equal", value: selected}},
                    options: {includeInactive: true, includeSuspended: true, includeBuried: true, includePaused: true,
                        includeConflicts: true, limit: 1, now: Date.now()},
                }, response => {
                    if (!listeners.signal.aborted && cardID() === selected && priorityCardID === selected) {
                        const card = response.data.cards?.[0];
                        priority = card ? priorityLabel(card.effectivePriority) : undefined;
                        if (details || tooltip && tooltipOpen()) {
                            renderDetails();
                        }
                    }
                });
            }
        }
        const html = reviewDetailsHTML(progress, priority);
        if (details) {
            details.element.querySelector("[data-flashcard-queue-details]").innerHTML = html;
        } else if (tooltip) {
            showTooltip(html, button, "flashcard-counter", event);
        }
    };
    const dismissTooltip = () => {
        tooltip = false;
        if (tooltipOpen()) {
            hideTooltip();
        }
    };
    const update = (value: QueueProgress) => {
        progress = value;
        count.textContent = String(progress.remaining);
        count.classList.toggle("fn__none", hidden);
        const lang = window.siyuan.languages;
        button.setAttribute("aria-label", mobile ? lang.flashcardSessionProgress :
            (hidden ? lang.flashcardShowSessionCount : lang.flashcardHideSessionCount));
        button.setAttribute("aria-description", hidden ? "" : `${lang.flashcardSessionRemaining} ${progress.remaining}`);
        if (details || tooltip && tooltipOpen()) {
            renderDetails();
        }
    };
    button.addEventListener("click", () => {
        if (mobile) {
            if (details) {
                details.destroy();
                return;
            }
            const lang = window.siyuan.languages;
            details = new AdaptiveDialog({
                title: lang.flashcardSessionProgress,
                content: `<div class="b3-dialog__content card__v2-queue-details" data-flashcard-queue-details></div>
<div class="b3-dialog__action"><button type="button" class="b3-button b3-button--text">${escapeHtml(lang.close)}</button></div>`,
                destroyCallback: () => { details = undefined; },
            });
            details.element.querySelector(".b3-dialog__action button").addEventListener("click", () => details.destroy());
            renderDetails();
        } else {
            hidden = !hidden;
            button.setAttribute("aria-pressed", String(hidden));
            update(progress);
            showMessage(window.siyuan.languages[hidden ? "flashcardReviewCountHidden" : "flashcardReviewCountShown"], 1800);
        }
    }, options);
    if (!mobile) {
        button.addEventListener("mouseenter", (event) => {
            tooltip = true;
            renderDetails(event);
        }, options);
        button.addEventListener("focus", () => {
            tooltip = true;
            renderDetails();
        }, options);
        button.addEventListener("mouseleave", dismissTooltip, options);
        button.addEventListener("blur", dismissTooltip, options);
        button.addEventListener("keydown", (event) => {
            if (event.key === "Escape" && tooltipOpen()) {
                event.preventDefault();
                event.stopPropagation();
                dismissTooltip();
            }
        }, options);
    }
    return {update, destroy: () => {
        listeners.abort();
        dismissTooltip();
        details?.destroy();
    }};
};
