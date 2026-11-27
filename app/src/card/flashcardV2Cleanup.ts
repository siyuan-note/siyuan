import {Dialog} from "../dialog";
import {confirmDialog} from "../dialog/confirmDialog";
import {fetchPost} from "../util/fetch";
import {escapeAttr, escapeHtml} from "../util/escape";
import {createFlashcardV2Operation, flashcardV2DisclosureIcon} from "./flashcardV2Form";

interface IInvalidSource {
    sourceID: string;
    revisionID: string;
    blockIDs: string[];
    cardCount: number;
    reason: "missing" | "closed" | "unknown";
}

export const openFlashcardV2Cleanup = (onChanged: () => void) => {
    const lang = window.siyuan.languages;
    let closed = false;
    let changed = false;
    let busy = false;
    let sources: IInvalidSource[] = [];
    const operationFor = createFlashcardV2Operation();
    const notifyChanged = () => {
        if (changed) {
            changed = false;
            onChanged();
        }
    };
    const dialog = new Dialog({
        title: lang.flashcardCleanup,
        width: "min(900px, 96vw)",
        height: "min(700px, 90vh)",
        beforeClose: () => {
            closed = true;
            return true;
        },
        destroyCallback: notifyChanged,
        content: `<div class="b3-dialog__content card__v2-panel">
<div class="ft__on-surface">${lang.flashcardCleanupScanTip}</div>
<div class="card__v2-panel-toolbar">
<label class="card__v2-checkbox"><input data-select-all type="checkbox" disabled><span>${lang.selectAll}</span></label>
<span class="fn__space"></span><span data-summary class="fn__flex-1"></span>
<button data-scan class="b3-button b3-button--outline">${lang.refresh}</button>
<span class="fn__space"></span><button data-delete class="b3-button b3-button--text" disabled>${lang.delete}</button>
</div><div data-result role="status"></div>
<ul data-sources class="b3-list b3-list--background fn__flex-1 card__v2-panel-list"></ul></div>`,
    });
    const all = dialog.element.querySelector<HTMLInputElement>("[data-select-all]");
    const remove = dialog.element.querySelector<HTMLButtonElement>("[data-delete]");
    const scanButton = dialog.element.querySelector<HTMLButtonElement>("[data-scan]");
    const list = dialog.element.querySelector<HTMLElement>("[data-sources]");
    const result = dialog.element.querySelector<HTMLElement>("[data-result]");
    const selected = () => [...list.querySelectorAll<HTMLInputElement>("input:checked")]
        .map((input) => sources.find((source) => source.sourceID === input.dataset.id));
    const refresh = () => {
        const selection = selected();
        const eligible = sources.filter((source) => source.reason === "missing").length;
        all.disabled = busy || eligible === 0;
        all.checked = eligible > 0 && selection.length === eligible;
        all.indeterminate = selection.length > 0 && selection.length < eligible;
        remove.disabled = busy || selection.length === 0;
        scanButton.disabled = busy;
        scanButton.textContent = busy ? lang.loading : lang.refresh;
        list.querySelectorAll<HTMLInputElement>("input").forEach((input) => { input.disabled = busy; });
        dialog.element.querySelector("[data-summary]").textContent = lang.flashcardCleanupSummary
            .replace("${sources}", selection.length.toString())
            .replace("${cards}", selection.reduce((sum, source) => sum + source.cardCount, 0).toString());
    };
    const scan = async () => {
        if (closed || busy) { return; }
        busy = true;
        let succeeded = false;
        result.textContent = "";
        refresh();
        try {
            await fetchPost("/api/flashcard/inspectInvalidSources", {}, (response) => {
                if (closed) { return; }
                sources = response.data.sources;
                list.innerHTML = sources.map((source) => {
                    const reason = source.reason === "missing" ? lang.flashcardCleanupMissing :
                        source.reason === "closed" ? lang.flashcardCleanupClosed : lang.flashcardCleanupUnknown;
                    const checkboxLabel = source.blockIDs[0] ? `${reason} - ${source.blockIDs[0]}` : reason;
                    return `<li class="b3-list-item card__v2-cleanup-row">
<span class="card__v2-cleanup-selection">${source.reason === "missing" ? `<input type="checkbox" data-id="${escapeAttr(source.sourceID)}" aria-label="${escapeAttr(checkboxLabel)}">` : ""}</span>
<details class="card__v2-disclosure card__v2-cleanup-details">
<summary aria-label="${escapeAttr(`${lang.flashcardCardSource} - ${reason}`)}">${flashcardV2DisclosureIcon}<span>${reason}</span></summary>
<div class="card__v2-cleanup-ids ft__breakword">${source.blockIDs.map(id => escapeHtml(id)).join("<br>")}</div>
</details>
<span class="b3-list-item__meta">${lang.riffCard} ${source.cardCount}</span></li>`;
                }).join("") || `<li class="b3-list-item">${lang.emptyContent}</li>`;
                succeeded = true;
            }, undefined, undefined, undefined, 30000);
        } catch (error) {
            console.warn(error);
        } finally {
            busy = false;
            if (!closed) {
                if (!succeeded) { result.textContent = lang.flashcardCleanupUnknown; }
                refresh();
            }
        }
    };
    all.addEventListener("change", () => {
        list.querySelectorAll<HTMLInputElement>("input").forEach((input) => { input.checked = all.checked; });
        refresh();
    });
    list.addEventListener("change", refresh);
    scanButton.addEventListener("click", () => { void scan(); });
    remove.addEventListener("click", () => {
        const selection = selected();
        confirmDialog({
            title: lang.deleteOpConfirm,
            text: `${lang.flashcardCleanupTip}<br>${escapeHtml(dialog.element.querySelector("[data-summary]").textContent)}`,
            confirm: async () => {
                if (closed || busy) { return; }
                busy = true;
                let succeeded = false;
                result.textContent = "";
                refresh();
                const identity = selection.map(({sourceID, revisionID, blockIDs, cardCount, reason}) =>
                    ({sourceID, revisionID, blockIDs, cardCount, reason}))
                    .sort((a, b) => a.sourceID.localeCompare(b.sourceID));
                try {
                    await fetchPost("/api/flashcard/deleteInvalidSources", {
                        operationID: operationFor(identity).operationID,
                        sources: selection,
                    }, (response) => {
                        succeeded = true;
                        const deleted = new Set<string>(response.data.deleted);
                        if (deleted.size > 0) {
                            changed = true;
                            if (closed) { notifyChanged(); }
                        }
                        if (closed) { return; }
                        sources = sources.filter((source) => !deleted.has(source.sourceID));
                        list.querySelectorAll<HTMLInputElement>("input").forEach((input) => {
                            if (deleted.has(input.dataset.id)) { input.closest("li").remove(); }
                            input.checked = false;
                        });
                        result.textContent = lang.flashcardCleanupResult.replace("${deleted}", deleted.size.toString())
                            .replace("${skipped}", response.data.skipped.length.toString());
                    }, undefined, undefined, undefined, 30000);
                } catch (error) {
                    console.warn(error);
                } finally {
                    busy = false;
                    if (!succeeded) {
                        // 超时不代表服务端未删除，关闭后重新读取实际状态。
                        changed = true;
                        if (closed) { notifyChanged(); }
                    }
                    if (!closed) {
                        if (!succeeded) { result.textContent = `${lang.flashcardCleanupUnknown} · ${lang.refresh}`; }
                        refresh();
                    }
                }
            },
        });
    });
    void scan();
};
