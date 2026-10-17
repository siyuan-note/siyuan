import type {AVCollectionReview} from "../../../types/api";
import {Dialog} from "../../../dialog";
import {confirmDialog} from "../../../dialog/confirmDialog";
import {fetchSyncPost} from "../../../util/fetch";
import {escapeAttr, escapeHtml} from "../../../util/escape";
import {isMobile} from "../../../util/functions";
import {openLink} from "../../../editor/openLink";
import {transaction} from "../../wysiwyg/transaction";
import {waitForPendingTransactions} from "../../util/transactionQueue";

export const openCollectionReview = async (protyle: IProtyle, avID: string, blockID: string) => {
    const lang = window.siyuan.languages;
    await waitForPendingTransactions(protyle);
    const dialog = new Dialog({title: lang.automationCollectionReview, width: isMobile() ? "92vw" : "680px",
        content: `<div class="b3-dialog__content av__collection-preview"><div class="av__automation-control"><div class="ft__on-surface ft__smaller av__automation-tip">${lang.automationCollectionReviewTip}</div><div class="ft__on-surface ft__smaller ft__breakword" role="status" aria-live="polite" data-counts></div><div data-results></div></div></div><div class="b3-dialog__action av__automation-row"><div class="av__automation-row"><button type="button" class="b3-button b3-button--cancel" data-prev>${lang.previous}</button><button type="button" class="b3-button b3-button--cancel" data-next>${lang.next}</button></div><span class="fn__flex-1"></span><button type="button" class="b3-button b3-button--remove b3-button--wrap" data-cleanup>${lang.automationCollectionCleanup}</button></div>`});
    const previous = dialog.element.querySelector<HTMLButtonElement>("[data-prev]");
    const next = dialog.element.querySelector<HTMLButtonElement>("[data-next]");
    const cleanup = dialog.element.querySelector<HTMLButtonElement>("[data-cleanup]");
    const statuses = {matched: lang.automationCollectionMatched, unmatched: lang.automationCollectionUnmatched, unknown: lang.automationCollectionUnknown};
    let page = 1;
    let busy = false;
    let review: AVCollectionReview;
    const candidates = () => review?.items.filter(item => item.status === "unmatched") || [];
    const updateActions = () => {
        previous.disabled = busy || page === 1;
        next.disabled = busy || !review?.hasMore;
        cleanup.disabled = busy || candidates().length === 0;
        cleanup.textContent = `${lang.automationCollectionCleanup} (${candidates().length})`;
    };
    const load = async () => {
        busy = true;
        review = undefined;
        updateActions();
        const result = await fetchSyncPost("/api/av/reviewAttributeViewCollection", {avID, page});
        if (!dialog.element.isConnected) { return; }
        const results = dialog.element.querySelector<HTMLElement>("[data-results]");
        const counts = dialog.element.querySelector<HTMLElement>("[data-counts]");
        busy = false;
        if (result.code !== 0) {
            results.textContent = result.msg;
            counts.textContent = "";
            updateActions();
            return;
        }
        review = result.data;
        counts.textContent = `${statuses.matched} (${review.matched}) - ${statuses.unmatched} (${review.unmatched}) - ${statuses.unknown} (${review.unknown})`;
        results.innerHTML = review.items.map(item => `<div class="av__automation-field">${item.blockID ? `<a href="siyuan://blocks/${escapeAttr(item.blockID)}" class="ft__breakword av__automation-preview-content">${escapeHtml(item.content || item.blockID)}</a>` : `<div class="ft__breakword">${escapeHtml(item.content || item.itemID)}</div>`}<div class="ft__on-surface ft__smaller ft__breakword">${escapeHtml(statuses[item.status])}${item.hPath ? ` - ${escapeHtml(item.hPath)}` : ""}</div></div>`).join("") || `<div class="ft__on-surface">${lang.emptyContent}</div>`;
        updateActions();
    };
    previous.addEventListener("click", async () => { if (!busy && page > 1) { page--; await load(); } });
    next.addEventListener("click", async () => { if (!busy && review?.hasMore) { page++; await load(); } });
    cleanup.addEventListener("click", () => {
        if (busy || !candidates().length) { return; }
        const items = candidates().map(item => ({itemID: item.itemID, blockID: item.blockID}));
        const ruleVersion = review.ruleVersion;
        busy = true;
        updateActions();
        confirmDialog(`${lang.automationCollectionCleanup} (${items.length})`, lang.automationCollectionCleanupConfirm, async () => {
            if (!dialog.element.isConnected) { return; }
            const operation = {action: "cleanupAttrViewBlocks" as const, avID, blockID, data: {ruleVersion, items}};
            transaction(protyle, [operation], [operation]);
            await waitForPendingTransactions(protyle);
            if (!dialog.element.isConnected) { return; }
            page = 1;
            await load();
        }, () => { busy = false; updateActions(); }, true, undefined, lang.confirm);
    });
    dialog.element.querySelector("[data-results]").addEventListener("click", event => {
        const link = (event.target as Element).closest<HTMLAnchorElement>("a[href]");
        if (link) { event.preventDefault(); openLink(protyle.app, link.getAttribute("href"), event as MouseEvent); }
    });
    await load();
};
