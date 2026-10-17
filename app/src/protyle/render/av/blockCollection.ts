import type {AVAutomationBlockSourceInput, AVBlockCollectionMatch} from "../../../types/api";
import {Dialog} from "../../../dialog";
import {Menu} from "../../../plugin/Menu";
import {toggleMenu} from "../../../menus/menuToggle";
import {fetchSyncPost} from "../../../util/fetch";
import {escapeAttr, escapeHtml} from "../../../util/escape";
import {isMobile} from "../../../util/functions";
import {movePathTo} from "../../../util/pathName";
import {transaction} from "../../wysiwyg/transaction";
import {waitForPendingTransactions} from "../../util/transactionQueue";

export const collectionSourceIncomplete = (source: AVAutomationBlockSourceInput) => !source ||
    !(source.notebookIDs?.length || source.documentIDs?.length) ||
    (source.attributes || []).some(attr => !attr || !/^custom-[\w-]+$/.test(attr.name));

export const mountBlockCollectionSource = (host: HTMLElement, source: AVAutomationBlockSourceInput,
                                           protyle: IProtyle, save: () => void, onResize: () => void) => {
    const lang = window.siyuan.languages;
    const types: Record<string, string> = {
        d: lang.documentBlock, p: lang.paragraph, h: lang.headings, l: lang.list, i: lang.listItem,
        c: lang.code, m: lang.math, t: lang.tableBlock, b: lang.quote, s: lang.superBlock,
        html: lang.htmlBlock, query_embed: lang.blockEmbed, av: lang.database, iframe: lang.iframeBlock,
        widget: lang.widget, tb: lang.line, video: lang.video, audio: lang.audio, custom: lang.customBlock,
        callout: lang.callout, tabs: lang.tabs, tab: lang.tabItem, mindmap: lang.mindmap, mindmap_item: lang.mindmapItem,
    };
    const names = new Map<string, string>();
    let revision = 0;
    const removeButton = (kind: string, index: number) => `<button type="button" class="block__icon" data-remove="${kind}" data-index="${index}" aria-label="${escapeAttr(lang.delete)}"><svg><use xlink:href="#iconClose"></use></svg></button>`;
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
        const attributes = source.attributes || [];
        host.innerHTML = `<div class="av__automation-action">
<div class="ft__on-surface ft__smaller">${lang.automationCollectionTip}</div>
<button type="button" class="b3-button b3-button--outline av__automation-source-action" data-scope>${lang.automationCollectionScope}</button>
${notebooks.length || documents.length ? `<div>${notebooks.map((id, i) => `<div class="av__automation-row"><span class="fn__flex-1 ft__breakword">${escapeHtml(window.siyuan.notebooks.find(box => box.id === id)?.name || id)}</span>${removeButton("notebook", i)}</div>`).join("")}${documents.map((id, i) => `<div class="av__automation-row"><span class="fn__flex-1 ft__breakword">${escapeHtml(names.get(id) || id)}</span>${removeButton("document", i)}</div>`).join("")}</div>` : ""}
<label class="av__automation-control"><span>${lang.automationCollectionTags}</span><input class="b3-text-field" data-tags value="${escapeAttr((source.tags || []).join(", "))}"></label>
<button type="button" class="b3-button b3-button--cancel av__automation-source-action" data-types><svg><use xlink:href="#iconDown"></use></svg><span>${lang.automationCollectionTypes}: ${escapeHtml((source.types || []).map(type => types[type] || type).join(", ") || lang.all)}</span></button>
${attributes.map((attr, i) => `<div class="av__automation-control" data-attribute="${i}"><div class="av__automation-row"><input class="b3-text-field fn__flex-1" data-attr-name aria-label="${escapeAttr(lang.attr)}" placeholder="custom-name" value="${escapeAttr(attr.name)}">${removeButton("attribute", i)}</div><div class="av__automation-row"><select class="b3-select" data-attr-operator aria-label="${escapeAttr(lang.filter)}">${Object.entries({equals: lang.filterOperatorIs, contains: lang.filterOperatorContains, exists: lang.automationAttrExists, notExists: lang.automationAttrNotExists}).map(([operator, label]) => `<option value="${operator}"${attr.operator === operator ? " selected" : ""}>${label}</option>`).join("")}</select>${["equals", "contains"].includes(attr.operator) ? `<input class="b3-text-field fn__flex-1" data-attr-value aria-label="${escapeAttr(lang.text)}" value="${escapeAttr(attr.value || "")}">` : ""}</div></div>`).join("")}
<button type="button" class="b3-button b3-button--cancel av__automation-source-action" data-add-attribute><svg><use xlink:href="#iconAdd"></use></svg><span>${lang.addFilterCondition} - ${lang.attr}</span></button>
</div>`;
        onResize();
    };
    host.addEventListener("click", event => {
        const target = (event.target as Element).closest<HTMLElement>("button");
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
        if (target.hasAttribute("data-types")) {
            let menu: Menu;
            toggleMenu({target, build: () => {
                menu = new Menu();
                Object.entries(types).forEach(([type, label]) => menu.addItem({label, checked: source.types?.includes(type), click: () => {
                    source.types = source.types?.includes(type) ? source.types.filter(item => item !== type) : [...(source.types || []), type];
                    save();
                    void render();
                }}));
            }, show: () => {
                const rect = target.getBoundingClientRect();
                menu.open({x: rect.left, y: rect.bottom, h: rect.height, target});
            }});
            return;
        }
        if (target.hasAttribute("data-add-attribute")) {
            source.attributes = [...(source.attributes || []), {name: "custom-", operator: "exists"}];
        } else if (target.dataset.remove) {
            const i = Number(target.dataset.index);
            if (target.dataset.remove === "notebook") { source.notebookIDs.splice(i, 1); }
            if (target.dataset.remove === "document") { source.documentIDs.splice(i, 1); }
            if (target.dataset.remove === "attribute") { source.attributes.splice(i, 1); }
        } else { return; }
        save();
        void render();
    });
    host.addEventListener("change", event => {
        const target = event.target as HTMLInputElement;
        if (target.hasAttribute("data-tags")) {
            source.tags = Array.from(new Set(target.value.split(/[,，]/).map(tag => tag.trim().replace(/^#|#$/g, "")).filter(Boolean)));
        } else {
            const row = target.closest<HTMLElement>("[data-attribute]");
            if (!row) { return; }
            const attr = source.attributes[Number(row.dataset.attribute)];
            if (target.hasAttribute("data-attr-name")) { attr.name = target.value.trim().toLowerCase(); }
            if (target.hasAttribute("data-attr-value")) { attr.value = target.value; }
            if (target.hasAttribute("data-attr-operator")) {
                attr.operator = target.value === "contains" ? "contains" : target.value === "exists" ? "exists" : target.value === "notExists" ? "notExists" : "equals";
                void render();
            }
        }
        save();
    });
    void render();
};

export const openBlockCollectionPreview = async (protyle: IProtyle, avID: string, blockID: string, ruleID: string) => {
    const lang = window.siyuan.languages;
    await waitForPendingTransactions(protyle);
    const dialog = new Dialog({title: lang.automationCollectionPreview, width: isMobile() ? "92vw" : "680px",
        content: `<div class="b3-dialog__content av__collection-preview"><div data-results></div></div><div class="b3-dialog__action"><button type="button" class="b3-button b3-button--cancel" data-prev>${lang.previous}</button><span class="fn__space"></span><button type="button" class="b3-button b3-button--cancel" data-next>${lang.next}</button><span class="fn__flex-1"></span><button type="button" class="b3-button b3-button--text" data-collect>${lang.automationCollectPage}</button></div>`});
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
        host.innerHTML = matches.map(item => `<div class="av__automation-field"><a href="siyuan://blocks/${escapeAttr(item.id)}" class="ft__breakword">${escapeHtml(item.content || item.id)}</a><div class="ft__on-surface ft__smaller ft__breakword">${escapeHtml(item.hPath)}${item.collected ? ` - ${lang.automationCollectionCollected}` : ""}</div></div>`).join("") || `<div class="ft__on-surface">${lang.emptyContent}</div>`;
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
