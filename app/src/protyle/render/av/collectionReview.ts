import type {AVBlockCollectionMatch, AVCollectionReview, AVCollectionReviewItem} from "../../../types/api";
import {Dialog} from "../../../dialog";
import {confirmDialog} from "../../../dialog/confirmDialog";
import {fetchSyncPost} from "../../../util/fetch";
import {escapeAttr, escapeHtml} from "../../../util/escape";
import {isMobile} from "../../../util/functions";
import {openLink} from "../../../editor/openLink";
import {transaction} from "../../wysiwyg/transaction";
import {waitForPendingTransactions} from "../../util/transactionQueue";

type ReviewStatus = AVCollectionReviewItem["status"];

export const openCollectionManager = async (protyle: IProtyle, avID: string, blockID: string) => {
    const lang = window.siyuan.languages;
    await waitForPendingTransactions(protyle);
    const statuses: Record<ReviewStatus, string> = {
        matched: lang.automationCollectionMatched,
        unmatched: lang.automationCollectionUnmatched,
        unknown: lang.automationCollectionUnknown,
    };
    const reasons: Record<NonNullable<AVCollectionReviewItem["reason"]>, string> = {
        invalidItem: lang.automationCollectionReasonInvalidItem,
        detached: lang.automationCollectionReasonDetached,
        noRules: lang.automationCollectionReasonNoRules,
        invalidRule: lang.automationCollectionReasonInvalidRule,
        unavailable: lang.automationCollectionReasonUnavailable,
        unreadable: lang.automationCollectionReasonUnreadable,
    };
    const tab = (attribute: string, value: string, label: string) => `<div class="item item--full" ${attribute}="${value}" role="tab" tabindex="0" aria-selected="false"><span class="fn__flex-1"></span><span class="item__text">${escapeHtml(label)}</span><span class="fn__flex-1"></span></div>`;
    const dialog = new Dialog({title: lang.automationCollectionManage, width: isMobile() ? "92vw" : "760px",
        content: `<div class="layout-tab-bar fn__flex av__collection-tabs" role="tablist" aria-label="${escapeAttr(lang.automationCollectionManage)}">${tab("data-collection-view", "rules", lang.automationCollectionRules)}${tab("data-collection-view", "entries", lang.automationCollectionEntries)}</div>
<div class="b3-dialog__content av__collection-preview av__collection-manager">
<label class="av__automation-control fn__none" data-rule-control><span>${lang.automationRule}</span><select class="b3-select fn__block" data-collection-rule></select></label>
<div class="ft__on-surface ft__smaller av__automation-tip" data-review-tip>${lang.automationCollectionReviewTip}</div>
<div class="layout-tab-bar fn__flex av__collection-tabs" role="tablist" aria-label="${escapeAttr(lang.automationCollectionEntries)}" data-status-tabs>${Object.entries(statuses).map(([value, label]) => tab("data-collection-status", value, label)).join("")}</div>
<div class="av__automation-preview-results" data-results role="status" aria-live="polite"></div>
</div><div class="b3-dialog__action av__automation-row"><div class="av__automation-row"><button type="button" class="b3-button b3-button--cancel" data-prev>${lang.previous}</button><span data-page></span><button type="button" class="b3-button b3-button--cancel" data-next>${lang.next}</button></div><span class="fn__flex-1"></span><button type="button" class="b3-button b3-button--text b3-button--wrap fn__none" data-collect>${lang.automationCollectPage}</button><button type="button" class="b3-button b3-button--remove b3-button--wrap" data-cleanup>${lang.automationCollectionCleanup}</button></div>`});
    const root = dialog.element;
    const host = root.querySelector<HTMLElement>("[data-results]");
    const previous = root.querySelector<HTMLButtonElement>("[data-prev]");
    const next = root.querySelector<HTMLButtonElement>("[data-next]");
    const cleanup = root.querySelector<HTMLButtonElement>("[data-cleanup]");
    const collect = root.querySelector<HTMLButtonElement>("[data-collect]");
    const ruleSelect = root.querySelector<HTMLSelectElement>("[data-collection-rule]");
    const pages: Record<ReviewStatus, number> = {matched: 1, unmatched: 1, unknown: 1};
    const rulePages = new Map<string, number>();
    let view = "entries";
    let status: ReviewStatus = "unmatched";
    let initial = true;
    let busy = true;
    let review: AVCollectionReview;
    let matches: AVBlockCollectionMatch[] = [];
    let hasMore = false;
    const page = () => view === "entries" ? pages[status] : rulePages.get(ruleSelect.value) || 1;
    const setPage = (value: number) => {
        if (view === "entries") { pages[status] = value; } else { rulePages.set(ruleSelect.value, value); }
    };
    const candidates = () => review?.items.filter(item => item.status === "unmatched") || [];
    const updateActions = () => {
        previous.disabled = busy || page() === 1;
        next.disabled = busy || !hasMore;
        cleanup.disabled = busy || !candidates().length;
        collect.disabled = busy || !matches.some(item => !item.collected);
        cleanup.textContent = `${lang.automationCollectionCleanup} (${candidates().length})`;
        cleanup.classList.toggle("fn__none", view !== "entries" || status !== "unmatched");
        collect.classList.toggle("fn__none", view !== "rules");
        ruleSelect.disabled = busy || !ruleSelect.options.length;
        root.querySelector("[data-page]").textContent = String(page());
        root.querySelector("[data-rule-control]").classList.toggle("fn__none", view !== "rules");
        root.querySelector("[data-status-tabs]").classList.toggle("fn__none", view !== "entries");
        root.querySelector("[data-review-tip]").classList.toggle("fn__none", view !== "entries");
        root.querySelectorAll<HTMLElement>("[data-collection-view], [data-collection-status], [data-remove-item]").forEach(button => {
            if (button.tagName === "BUTTON") { (button as HTMLButtonElement).disabled = busy; }
            button.setAttribute("aria-disabled", String(busy));
            const selected = button.dataset.collectionView ? button.dataset.collectionView === view : button.dataset.collectionStatus === status;
            button.classList.toggle("item--focus", selected);
            if (button.hasAttribute("role")) { button.setAttribute("aria-selected", String(selected)); }
        });
    };
    const renderReview = () => {
        root.querySelectorAll<HTMLElement>("[data-collection-status]").forEach(button => {
            const key = button.dataset.collectionStatus as ReviewStatus;
            button.querySelector(".item__text").textContent = `${statuses[key]} (${review[key]})`;
        });
        host.innerHTML = review.items.map(item => `<div class="av__automation-field av__collection-item"><div class="fn__flex-1"><div class="ft__breakword av__automation-preview-content">${item.blockID && !item.isDetached ? `<a href="siyuan://blocks/${escapeAttr(item.blockID)}">${escapeHtml(item.content || item.blockID)}</a>` : escapeHtml(item.content || item.itemID)}</div><div class="ft__on-surface ft__smaller ft__breakword">${escapeHtml(item.reason ? reasons[item.reason] : item.hPath)}</div></div>${item.status !== "matched" && item.itemID ? `<button type="button" class="b3-button b3-button--cancel b3-button--wrap" data-remove-item="${escapeAttr(item.itemID)}">${lang.automationCollectionRemove}</button>` : ""}</div>`).join("") || `<div class="ft__on-surface">${lang.emptyContent}</div>`;
    };
    const load = async (): Promise<void> => {
        busy = true;
        review = undefined;
        matches = [];
        hasMore = false;
        host.textContent = lang.loading;
        updateActions();
        if (view === "rules") {
            if (!ruleSelect.value) {
                host.textContent = lang.automationCollectionReasonNoRules;
            } else {
                const result = await fetchSyncPost("/api/av/previewAttributeViewCollection", {avID, ruleID: ruleSelect.value, page: page()});
                if (!root.isConnected) { return; }
                if (result.code !== 0) { host.textContent = result.msg; } else {
                    matches = result.data.blocks;
                    hasMore = result.data.hasMore;
                    host.innerHTML = matches.map(item => `<div class="av__automation-field"><a href="siyuan://blocks/${escapeAttr(item.id)}" class="ft__breakword av__automation-preview-content">${escapeHtml(item.content || item.id)}</a><div class="ft__on-surface ft__smaller ft__breakword">${escapeHtml(item.hPath)} - ${item.collected ? lang.automationCollectionCollected : lang.automationCollectionNotCollected}</div></div>`).join("") || `<div class="ft__on-surface">${lang.emptyContent}</div>`;
                }
            }
        } else {
            const result = await fetchSyncPost("/api/av/reviewAttributeViewCollection", {avID, page: page(), status});
            if (!root.isConnected) { return; }
            if (result.code !== 0) { host.textContent = result.msg; } else {
                review = result.data;
                if (initial) {
                    initial = false;
                    const first: ReviewStatus = review.unmatched ? "unmatched" : review.unknown ? "unknown" : "matched";
                    if (first !== status) { status = first; return load(); }
                }
                const lastPage = Math.max(1, Math.ceil(review[status] / 100));
                if (page() > lastPage) { setPage(lastPage); return load(); }
                hasMore = review.hasMore;
                renderReview();
            }
        }
        busy = false;
        updateActions();
    };
    const perform = async (operations: IOperation[], undo: IOperation[]) => {
        transaction(protyle, operations, undo);
        await waitForPendingTransactions(protyle);
        if (root.isConnected) { await load(); }
    };
    const confirmRemoval = (title: string, text: string, operations: IOperation[], undo: IOperation[]) => {
        busy = true;
        updateActions();
        confirmDialog(title, text, async () => {
            if (root.isConnected) { await perform(operations, undo); }
        }, () => { busy = false; updateActions(); }, true, undefined, lang.confirm);
    };
    root.addEventListener("click", event => {
        const button = (event.target as Element).closest<HTMLElement>("[data-collection-view], [data-collection-status], [data-remove-item]");
        if (!button || busy) { return; }
        if (button.dataset.collectionView) {
            view = button.dataset.collectionView;
            void load();
        } else if (button.dataset.collectionStatus) {
            status = button.dataset.collectionStatus as ReviewStatus;
            void load();
        } else {
            const item = review?.items.find(row => row.itemID === button.dataset.removeItem);
            if (!item || item.status === "matched") { return; }
            const operation: IOperation = {action: "removeAttrViewBlock", avID, blockID, srcIDs: [item.itemID]};
            const undo: IOperation = {action: "insertAttrViewBlock", avID, blockID,
                srcs: [{itemID: item.itemID, id: item.blockID || item.itemID, isDetached: item.isDetached, content: item.content}]};
            confirmRemoval(lang.automationCollectionRemove, lang.automationCollectionRemoveConfirm, [operation], [undo]);
        }
    });
    root.addEventListener("keydown", event => {
        const target = (event.target as Element).closest<HTMLElement>('[role="tab"]');
        if (!target || busy) { return; }
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            target.click();
        } else if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            const tabs = Array.from(target.parentElement.querySelectorAll<HTMLElement>('[role="tab"]'));
            const index = tabs.indexOf(target);
            const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 :
                (index + (event.key === "ArrowLeft" ? -1 : 1) + tabs.length) % tabs.length;
            tabs[nextIndex].focus();
            tabs[nextIndex].click();
        }
    });
    previous.addEventListener("click", () => { if (!busy && page() > 1) { setPage(page() - 1); void load(); } });
    next.addEventListener("click", () => { if (!busy && hasMore) { setPage(page() + 1); void load(); } });
    ruleSelect.addEventListener("change", () => { if (!busy) { void load(); } });
    cleanup.addEventListener("click", () => {
        if (busy || !candidates().length) { return; }
        const items = candidates().map(item => ({itemID: item.itemID, blockID: item.blockID}));
        const operation: IOperation = {action: "cleanupAttrViewBlocks", avID, blockID, data: {ruleVersion: review.ruleVersion, items}};
        confirmRemoval(`${lang.automationCollectionCleanup} (${items.length})`, lang.automationCollectionCleanupConfirm, [operation], [operation]);
    });
    collect.addEventListener("click", async () => {
        if (busy || !matches.some(item => !item.collected)) { return; }
        busy = true;
        updateActions();
        const operation: IOperation = {action: "collectAttrViewBlocks", avID, blockID,
            data: {ruleID: ruleSelect.value, blockIDs: matches.filter(item => !item.collected).map(item => item.id)}};
        await perform([operation], [operation]);
    });
    host.addEventListener("click", event => {
        const link = (event.target as Element).closest<HTMLAnchorElement>("a[href]");
        if (link) { event.preventDefault(); openLink(protyle.app, link.getAttribute("href"), event as MouseEvent); }
    });
    updateActions();
    const response = await fetchSyncPost("/api/av/getAttributeView", {id: avID});
    if (!root.isConnected) { return; }
    const rules = response.code === 0 ? (response.data.av.automations?.rules || []).filter(rule => rule.enabled && rule.trigger === "block") : [];
    ruleSelect.innerHTML = rules.map(rule => `<option value="${escapeAttr(rule.id)}">${escapeHtml(rule.name)}</option>`).join("");
    await load();
};
