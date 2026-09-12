import {renderSourceHistoryConfiguration} from "./flashcardV2SourceHistoryRender";
import {Dialog} from "../dialog";
import {confirmDialog} from "../dialog/confirmDialog";
import {fetchPost} from "../util/fetch";
import {escapeHtml, escapeAttr} from "../util/escape";
import {genUUID} from "../util/genID";
import {isMobile} from "../util/functions";
import {openDocHistory} from "../history/doc";
import {openHistory} from "../history/history";

interface ISourceRevision {
    revisionID: string;
    updatedAt: number;
    deleted: boolean;
    payload: {
        sourceType: string;
        pluginNamespace?: string;
        generationConfig: Record<string, unknown>;
        disabledTemplateIDs?: string[];
    };
}

interface ISourceVersion {
    revision: ISourceRevision;
    modes: string[];
    references: Array<{id: string, entityType: string, entityID: string, role: string, sort: number}>;
    documents: Record<string, {rootID: string, notebookID: string, title: string}>;
}

const requestData = <T>(url: string, data: unknown) => new Promise<T | undefined>((resolve) => {
    fetchPost(url, data, (response) => resolve(response.data as T)).finally(() => resolve(undefined));
});

export const openFlashcardV2DocumentHistory = async (blockID: string) => {
    if (!blockID) {
        openHistory(window.siyuan.ws.app);
        return;
    }
    const info = await requestData<{box: string, rootID: string, rootTitle: string}>("/api/block/getBlockInfo", {id: blockID});
    if (info) {
        openDocHistory({app: window.siyuan.ws.app, id: info.rootID, notebookId: info.box, pathString: info.rootTitle});
    } else {
        openHistory(window.siyuan.ws.app);
    }
};

export const openFlashcardV2SourceHistory = async (sourceID: string, changed: () => void) => {
    const entity = await requestData<{found: boolean, revision: ISourceRevision}>("/api/flashcard/getEntity", {
        entityType: "cardSource", entityID: sourceID,
    });
    if (!entity?.found) {
        return;
    }
    const current = await requestData<ISourceVersion>("/api/flashcard/getSourceHistory", {
        sourceID, revisionID: entity.revision.revisionID,
    });
    if (!current) {
        return;
    }
    const lang = window.siyuan.languages;
    let closed = false;
    const dialog = new Dialog({
        title: lang.flashcardSourceHistory,
        width: isMobile() ? "92vw" : "900px",
        height: "80vh",
        destroyCallback: () => { closed = true; },
        content: `<div class="b3-dialog__content fn__flex-column card__v2-source-history">
<div class="ft__on-surface">${escapeHtml(lang.flashcardSourceHistoryTip)}</div>
<div class="card__v2-management-pagination"><button data-action="previous" class="b3-button b3-button--outline" disabled>${lang.previous}</button><select data-action="version" class="b3-select fn__flex-1"></select><button data-action="next" class="b3-button b3-button--outline" disabled>${lang.next}</button></div>
<div data-preview class="card__v2-source-history-preview fn__flex-1"></div>
</div><div class="b3-dialog__action"><button data-action="documents" class="b3-button b3-button--outline">${lang.fileHistory}</button><div class="fn__space"></div><button data-action="restore" class="b3-button b3-button--text" disabled>${lang.restore}</button></div>`,
    });
    const select = dialog.element.querySelector<HTMLSelectElement>('[data-action="version"]');
    const previous = dialog.element.querySelector<HTMLButtonElement>('[data-action="previous"]');
    const next = dialog.element.querySelector<HTMLButtonElement>('[data-action="next"]');
    const restore = dialog.element.querySelector<HTMLButtonElement>('[data-action="restore"]');
    let selected: ISourceVersion | undefined;
    const restoreRequests = new Map<string, {
        operationID: string, sourceID: string, revisionID: string, expectedRevisionID: string, updatedAt: number
    }>();
    let offset = 0;
    let sequence = 0;
    const preview = async () => {
        const request = ++sequence;
        selected = undefined;
        restore.disabled = true;
        dialog.element.querySelector("[data-preview]").replaceChildren();
        if (!select.value) {
            return;
        }
        const version = await requestData<ISourceVersion>("/api/flashcard/getSourceHistory", {sourceID, revisionID: select.value});
        if (!version || closed || request !== sequence) {
            return;
        }
        selected = version;
        const ids = new Map<string, string>();
        const references = new Map<string, string>();
        [...current.references, ...version.references].forEach((ref) => {
            if (!references.has(ref.entityID)) {
                references.set(ref.entityID, `${lang.contentBlock} ${references.size + 1}`);
            }
            if (ref.role.startsWith("occlusion:")) {
                ids.set(ref.role.slice("occlusion:".length), references.get(ref.entityID));
            }
        });
        const collect = (value: unknown) => {
            if (Array.isArray(value)) {
                value.forEach(collect);
            } else if (value && typeof value === "object") {
                Object.entries(value).forEach(([key, child]) => {
                    if (key === "id" && typeof child === "string" && !ids.has(child)) {
                        ids.set(child, `#${ids.size + 1}`);
                    } else {
                        collect(child);
                    }
                });
            }
        };
        collect(current.revision.payload.generationConfig);
        collect(version.revision.payload.generationConfig);
        const modes: Record<string, string> = {
            forward: lang.flashcardDirectionForward, reverse: lang.flashcardDirectionReverse,
            cloze: lang.flashcardClozeCards, orderedSingle: lang.flashcardOrderedSingle,
            orderedCards: lang.flashcardOrderedCards, "image-occlusion": lang.flashcardImageOcclusion,
            choice: lang.flashcardChoiceQuestion, "multi-line": lang.flashcardMultiLineAll,
            "typed-answer": lang.flashcardTypedAnswer, block: lang.flashcardBlockCard,
        };
        const pane = (item: ISourceVersion, title: string) => `<section><h3>${escapeHtml(title)}</h3>
<div>${escapeHtml((item.modes || []).map((mode) => modes[mode] || lang.flashcardCardSource).join(", ") || lang.flashcardDirectionClosed)}</div>
<div>${item.references.map((ref, index) => `<button class="b3-button b3-button--outline fn__block" data-block="${escapeAttr(ref.entityID)}"${ref.entityType === "block" ? "" : " disabled"}>${index + 1}. ${escapeHtml(references.get(ref.entityID))} - ${escapeHtml(item.documents[ref.entityID]?.title || lang.flashcardOrphanedCards)} - ${lang.fileHistory}</button>`).join("")}</div>
${renderSourceHistoryConfiguration(item.revision.payload.generationConfig, ids, lang, item === current ? version.revision.payload.generationConfig : current.revision.payload.generationConfig)}</section>`;
        dialog.element.querySelector("[data-preview]").innerHTML = pane(current, lang.currentVer) +
            pane(version, new Date(version.revision.updatedAt).toLocaleString());
        restore.disabled = version.revision.revisionID === current.revision.revisionID || !!version.revision.payload.pluginNamespace;
    };
    const load = async (nextOffset: number) => {
        ++sequence;
        selected = undefined;
        previous.disabled = true;
        next.disabled = true;
        select.disabled = true;
        restore.disabled = true;
        const data = await requestData<{versions: ISourceRevision[]}>("/api/flashcard/getSourceHistory", {sourceID, limit: 51, offset: nextOffset});
        if (!data || closed) {
            previous.disabled = offset === 0;
            next.disabled = select.options.length < 50;
            select.disabled = false;
            return;
        }
        offset = nextOffset;
        select.innerHTML = data.versions.slice(0, 50).map((version) => `<option value="${escapeAttr(version.revisionID)}"${version.deleted ? " disabled" : ""}>${escapeHtml(new Date(version.updatedAt).toLocaleString())}${version.revisionID === current.revision.revisionID ? ` - ${lang.currentVer}` : ""}</option>`).join("");
        previous.disabled = offset === 0;
        next.disabled = data.versions.length <= 50;
        select.disabled = false;
        await preview();
    };
    select.addEventListener("change", preview);
    previous.addEventListener("click", () => load(Math.max(0, offset - 50)));
    next.addEventListener("click", () => load(offset + 50));
    dialog.element.addEventListener("click", (event) => {
        const target = (event.target as HTMLElement).closest<HTMLElement>("[data-block], [data-action]");
        if (!target) {
            return;
        }
        if (target.dataset.block) {
            const doc = selected?.documents[target.dataset.block] || current.documents[target.dataset.block];
            if (doc) {
                openDocHistory({app: window.siyuan.ws.app, id: doc.rootID, notebookId: doc.notebookID, pathString: doc.title});
            } else {
                openHistory(window.siyuan.ws.app);
            }
        } else if (target.dataset.action === "documents") {
            openHistory(window.siyuan.ws.app);
        } else if (target.dataset.action === "restore" && selected && !restore.disabled) {
            const revisionID = selected.revision.revisionID;
            confirmDialog(lang.restore, lang.flashcardSourceRestoreConfirm, async () => {
                if (closed) {
                    return;
                }
                restore.disabled = true;
                if (!restoreRequests.has(revisionID)) {
                    restoreRequests.set(revisionID, {
                        operationID: genUUID(), sourceID, revisionID,
                        expectedRevisionID: current.revision.revisionID, updatedAt: Date.now(),
                    });
                }
                const result = await requestData<ISourceRevision>("/api/flashcard/restoreSourceHistory", restoreRequests.get(revisionID));
                if (result) {
                    dialog.destroy();
                    changed();
                } else if (!closed) {
                    restore.disabled = false;
                }
            });
        }
    });
    await load(0);
};
