import type {AVAutomationBlockSourceInput, AVBlockCollectionMatch} from "../../../types/api";
import {Dialog} from "../../../dialog";
import {fetchSyncPost} from "../../../util/fetch";
import {escapeAttr, escapeHtml} from "../../../util/escape";
import {isMobile} from "../../../util/functions";
import {movePathTo} from "../../../util/pathName";
import {transaction} from "../../wysiwyg/transaction";
import {waitForPendingTransactions} from "../../util/transactionQueue";
import {mountCollectionConditions} from "./collectionConditions";
import {BlockPanel} from "../../../block/Panel";

export const collectionSourceIncomplete = (source: AVAutomationBlockSourceInput) => !source ||
    !(source.notebookIDs?.length || source.documentIDs?.length) ||
    (source.attributes || []).some(attr => !attr || !/^custom-[\w-]+$/.test(attr.name));

export const mountBlockCollectionSource = (host: HTMLElement, source: AVAutomationBlockSourceInput,
                                           protyle: IProtyle, save: () => void, onResize: () => void) => {
    const lang = window.siyuan.languages;
    const conditions = document.createElement("div");
    mountCollectionConditions(conditions, source, save, onResize);
    const names = new Map<string, string>();
    let revision = 0;
    const removeButton = (kind: string, index: number) => `<svg class="b3-menu__action b3-menu__action--show b3-menu__action--warning fn__pointer ariaLabel" data-remove="${kind}" data-index="${index}" role="button" tabindex="0" data-position="north" aria-label="${escapeAttr(lang.delete)}"><use xlink:href="#iconClose"></use></svg>`;
    const render = async () => {
        const version = ++revision;
        await Promise.all((source.documentIDs || []).map(async id => {
            if (!names.has(id)) {
                const result = await fetchSyncPost("/api/filetree/getHPathByID", {id});
                if (result.code === 0) { names.set(id, result.data); }
            }
        }));
        if (!host.isConnected || revision !== version) { return; }
        const notebooks = source.notebookIDs || [];
        const documents = source.documentIDs || [];
        host.innerHTML = `<div class="av__automation-action">
<div class="ft__on-surface ft__smaller av__automation-tip" data-collection-removal-tip>${lang.automationCollectionTip}</div>
<div class="av__automation-control" data-scope-control><span class="av__automation-control-label">${lang.automationCollectionScope}</span>
${notebooks.length || documents.length ? `<div class="av__automation-source-list">${notebooks.map((id, i) => `<div class="av__automation-row av__automation-source-row"><svg class="block__logoicon ft__on-surface"><use xlink:href="#iconNotebook"></use></svg><span class="fn__flex-1 ft__breakword av__automation-notebook-name">${escapeHtml(window.siyuan.notebooks.find(box => box.id === id)?.name || id)}</span>${removeButton("notebook", i)}</div>`).join("")}${documents.map((id, i) => `<div class="av__automation-row av__automation-source-row"><span class="b3-list-item__icon fn__pointer popover__block" data-id="${escapeAttr(id)}"><svg><use xlink:href="#iconFile"></use></svg></span><button type="button" class="b3-button b3-button--cancel b3-button--wrap fn__flex-1 av__automation-source-action av__automation-document-name" data-preview-document="${escapeAttr(id)}">${escapeHtml(names.get(id) || id)}</button>${removeButton("document", i)}</div>`).join("")}</div>` : ""}
<button type="button" class="b3-button b3-button--cancel b3-button--wrap av__automation-source-action" data-scope><svg><use xlink:href="#iconAdd"></use></svg><span>${escapeHtml(`${lang.addAttr} - ${lang.automationCollectionScope}`)}</span></button></div>
</div>`;
        host.firstElementChild.append(conditions);
        onResize();
    };
    host.addEventListener("click", event => {
        const preview = (event.target as Element).closest<HTMLElement>("[data-preview-document]");
        if (preview) {
            event.preventDefault();
            event.stopPropagation();
            window.siyuan.blockPanels.push(new BlockPanel({app: protyle.app, targetElement: preview,
                isBacklink: false, refDefs: [{refID: preview.dataset.previewDocument}]}));
            return;
        }
        const target = (event.target as Element).closest<HTMLElement>("button, [data-remove]");
        if (!target) { return; }
        if (target.hasAttribute("data-scope")) {
            movePathTo({title: lang.automationCollectionScope, flashcard: false, sourceNotebookIds: [protyle.notebookId],
                cb: (paths, boxes) => {
                    paths.forEach((path, i) => {
                        if (path === "/") {
                            source.notebookIDs = Array.from(new Set([...(source.notebookIDs || []), boxes[i]]));
                        } else {
                            const id = path.split("/").pop().replace(/\.sy$/, "");
                            source.documentIDs = Array.from(new Set([...(source.documentIDs || []), id]));
                        }
                    });
                    save();
                    void render();
                }});
            return;
        }
        if (target.dataset.remove) {
            const i = Number(target.dataset.index);
            if (target.dataset.remove === "notebook") { source.notebookIDs.splice(i, 1); }
            if (target.dataset.remove === "document") { source.documentIDs.splice(i, 1); }
        } else { return; }
        save();
        void render();
    });
    host.addEventListener("keydown", event => {
        const target = (event.target as Element).closest<SVGElement>("[data-remove]");
        if (target && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            event.stopPropagation();
            target.dispatchEvent(new MouseEvent("click", {bubbles: true}));
        }
    });
    void render();
};

export const openBlockCollectionPreview = async (protyle: IProtyle, avID: string, blockID: string, ruleID: string) => {
    const lang = window.siyuan.languages;
    await waitForPendingTransactions(protyle);
    const dialog = new Dialog({title: lang.automationCollectionPreview, width: isMobile() ? "92vw" : "680px",
        content: `<div class="b3-dialog__content av__collection-preview"><div class="av__automation-preview-results" data-results></div></div><div class="b3-dialog__action"><button type="button" class="b3-button b3-button--cancel" data-prev>${lang.previous}</button><span class="fn__space"></span><button type="button" class="b3-button b3-button--cancel" data-next>${lang.next}</button><span class="fn__flex-1"></span><button type="button" class="b3-button b3-button--text" data-collect>${lang.automationCollectPage}</button></div>`});
    let page = 1;
    let matches: AVBlockCollectionMatch[] = [];
    let busy = false;
    const previous = dialog.element.querySelector<HTMLButtonElement>("[data-prev]");
    const next = dialog.element.querySelector<HTMLButtonElement>("[data-next]");
    const collect = dialog.element.querySelector<HTMLButtonElement>("[data-collect]");
    const load = async () => {
        busy = true;
        previous.disabled = next.disabled = collect.disabled = true;
        const result = await fetchSyncPost("/api/av/previewAttributeViewCollection", {avID, ruleID, page});
        if (!dialog.element.isConnected) { return; }
        busy = false;
        const host = dialog.element.querySelector<HTMLElement>("[data-results]");
        if (result.code !== 0) { host.textContent = result.msg; return; }
        matches = result.data.blocks;
        host.innerHTML = matches.map(item => `<div class="av__automation-field"><a href="siyuan://blocks/${escapeAttr(item.id)}" class="ft__breakword av__automation-preview-content">${escapeHtml(item.content || item.id)}</a><div class="ft__on-surface ft__smaller ft__breakword av__automation-preview-description">${escapeHtml(item.hPath)}${item.collected ? ` - ${lang.automationCollectionCollected}` : ""}</div></div>`).join("") || `<div class="ft__on-surface av__automation-preview-empty">${lang.emptyContent}</div>`;
        previous.disabled = page === 1;
        next.disabled = !result.data.hasMore;
        collect.disabled = !matches.some(item => !item.collected);
    };
    previous.addEventListener("click", () => { if (!busy) { page--; void load(); } });
    next.addEventListener("click", () => { if (!busy) { page++; void load(); } });
    collect.addEventListener("click", async () => {
        if (busy) { return; }
        busy = true;
        previous.disabled = next.disabled = collect.disabled = true;
        const operation = {action: "collectAttrViewBlocks" as const, avID, blockID, data: {ruleID, blockIDs: matches.filter(item => !item.collected).map(item => item.id)}};
        transaction(protyle, [operation], [operation]);
        await waitForPendingTransactions(protyle);
        await load();
    });
    await load();
};
