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
import {openLink} from "../../../editor/openLink";
import {openInputDialog} from "../../../dialog/inputDialog";

export const toggleCollectionType = (types: string[], type: string) => {
    if (types.includes(type)) { return types.filter(item => item !== type); }
    const main = type.split(":")[0];
    return [...types.filter(item => type.includes(":") ? item !== main : !item.startsWith(main + ":")), type];
};

export const collectionSourceIncomplete = (source: AVAutomationBlockSourceInput) => !source ||
    !(source.notebookIDs?.length || source.documentIDs?.length) ||
    (source.attributes || []).some(attr => !attr || !/^custom-[\w-]+$/.test(attr.name));

export const mountBlockCollectionSource = (host: HTMLElement, source: AVAutomationBlockSourceInput,
                                           protyle: IProtyle, save: () => void, onResize: () => void) => {
    const lang = window.siyuan.languages;
    const types: Record<string, string> = {
        d: lang.documentBlock, p: lang.paragraph, h: lang.headings, l: lang.list1, i: lang.listItem,
        c: lang.code, m: lang.math, t: lang.tableBlock, b: lang.quote, s: lang.superBlock,
        html: lang.htmlBlock, query_embed: lang.blockEmbed, av: lang.databaseBlock, iframe: lang.iframeBlock,
        widget: lang.widgetBlock, tb: lang.line, video: lang.videoBlock, audio: lang.audioBlock, custom: lang.customBlock,
        callout: lang.callout, tabs: lang.tabs, tab: lang.tabItem, mindmap: lang.mindmap, mindmap_item: lang.mindmapItem,
    };
    for (let level = 1; level <= 6; level++) { types[`h:h${level}`] = lang[`heading${level}`]; }
    Object.assign(types, {"l:u": lang.list, "l:o": lang["ordered-list"], "l:t": lang.check,
        "i:u": lang.unorderedListItemBlock, "i:o": lang.orderedListItemBlock, "i:t": lang.taskListItemBlock});
    ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"].forEach(type => types[`callout:${type}`] = `${lang.callout} - ${type}`);
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
        const attributes = source.attributes || [];
        host.innerHTML = `<div class="av__automation-action">
<div class="ft__on-surface ft__smaller av__automation-tip">${lang.automationCollectionTip}</div>
<button type="button" class="b3-button b3-button--outline av__automation-source-action" data-scope>${lang.automationCollectionScope}</button>
${notebooks.length || documents.length ? `<div class="av__automation-source-list">${notebooks.map((id, i) => `<div class="av__automation-row av__automation-source-row"><svg class="block__logoicon ft__on-surface"><use xlink:href="#iconNotebook"></use></svg><span class="fn__flex-1 ft__breakword av__automation-notebook-name">${escapeHtml(window.siyuan.notebooks.find(box => box.id === id)?.name || id)}</span>${removeButton("notebook", i)}</div>`).join("")}${documents.map((id, i) => `<div class="av__automation-row av__automation-source-row"><span class="b3-list-item__icon fn__pointer popover__block" data-id="${escapeAttr(id)}"><svg><use xlink:href="#iconFile"></use></svg></span><a href="siyuan://blocks/${escapeAttr(id)}" class="fn__flex-1 ft__breakword av__automation-document-name">${escapeHtml(names.get(id) || id)}</a>${removeButton("document", i)}</div>`).join("")}</div>` : ""}
<label class="av__automation-control"><span class="av__automation-control-label">${lang.automationCollectionTags}</span><input class="b3-text-field av__automation-source-tags" data-tags value="${escapeAttr((source.tags || []).join(", "))}"></label>
<button type="button" class="b3-button b3-button--cancel av__automation-source-action" data-types><svg><use xlink:href="#iconDown"></use></svg><span class="av__automation-source-types">${lang.automationCollectionTypes}: ${escapeHtml((source.types || []).map(type => types[type] || type).join(", ") || lang.all)}</span></button>
${attributes.map((attr, i) => `<div class="av__automation-control" data-attribute="${i}"><div class="av__automation-row"><input class="b3-text-field fn__flex-1 av__automation-attribute-name" data-attr-name aria-label="${escapeAttr(lang.attr)}" placeholder="custom-name" value="${escapeAttr(attr.name)}">${removeButton("attribute", i)}</div><div class="av__automation-row"><select class="b3-select av__automation-attribute-operator" data-attr-operator aria-label="${escapeAttr(lang.filter)}">${Object.entries({equals: lang.filterOperatorIs, contains: lang.filterOperatorContains, exists: lang.automationAttrExists, notExists: lang.automationAttrNotExists}).map(([operator, label]) => `<option value="${operator}"${attr.operator === operator ? " selected" : ""}>${label}</option>`).join("")}</select>${["equals", "contains"].includes(attr.operator) ? `<input class="b3-text-field fn__flex-1 av__automation-attribute-value" data-attr-value aria-label="${escapeAttr(lang.text)}" value="${escapeAttr(attr.value || "")}">` : ""}</div></div>`).join("")}
<button type="button" class="b3-button b3-button--cancel av__automation-source-action" data-add-attribute><svg><use xlink:href="#iconAdd"></use></svg><span>${lang.addFilterCondition} - ${lang.attr}</span></button>
</div>`;
        onResize();
    };
    host.addEventListener("click", event => {
        const link = (event.target as Element).closest<HTMLAnchorElement>("a[href]");
        if (link) {
            event.preventDefault();
            openLink(protyle.app, link.getAttribute("href"), event, event.ctrlKey || event.metaKey);
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
        if (target.hasAttribute("data-types")) {
            let menu: Menu;
            toggleMenu({target, build: () => {
                menu = new Menu();
                Object.entries(types).forEach(([type, label]) => menu.addItem({label, checked: source.types?.includes(type), click: () => {
                    source.types = toggleCollectionType(source.types || [], type);
                    save();
                    void render();
                }}));
                menu.addItem({label: `${lang.callout} - ${lang.custom}`, click: () => { openInputDialog({
                    title: lang.callout, label: lang.type, value: "", maxLength: 256, onConfirm: (value, dialog) => {
                        const type = value.trim();
                        if (!type || type.length > 256 || /[\r\n\t]/.test(type)) { return; }
                        source.types = toggleCollectionType(source.types || [], `callout:${type}`);
                        save();
                        void render();
                        dialog.destroy();
                    },
                }); }});
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
    host.addEventListener("keydown", event => {
        const target = (event.target as Element).closest<SVGElement>("[data-remove]");
        if (target && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            event.stopPropagation();
            target.dispatchEvent(new MouseEvent("click", {bubbles: true}));
        }
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
