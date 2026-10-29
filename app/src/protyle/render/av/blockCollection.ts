import type {AVAutomationBlockSourceInput} from "../../../types/api";
import {fetchSyncPost} from "../../../util/fetch";
import {escapeAttr, escapeHtml} from "../../../util/escape";
import {movePathTo} from "../../../util/pathName";
import {mountCollectionConditions} from "./collectionConditions";
import {BlockPanel} from "../../../block/Panel";
import {Menu} from "../../../plugin/Menu";
import {toggleMenu} from "../../../menus/menuToggle";
import {mountCollectionReference} from "./collectionReference";
import {showMessage} from "../../../dialog/message";

export const collectionSourceIncomplete = (source: AVAutomationBlockSourceInput) => !source ||
    !(source.notebookIDs?.length || source.documentIDs?.length) ||
    (!!source.referenceID && !/^\d{14}-[a-z0-9]{7}$/.test(source.referenceID)) ||
    (source.documentDepth != null && (!Number.isSafeInteger(source.documentDepth) || source.documentDepth < 0)) ||
    (source.attributes || []).some(attr => !attr || !attr.name || attr.name.length > 256 ||
        (attr.nameOperator === "regex" ? false :
            !(attr.nameOperator === "contains" ? /^[a-z0-9-]+$/ : /^custom-[\w-]+$/).test(attr.name)));

export const mountBlockCollectionSource = (host: HTMLElement, source: AVAutomationBlockSourceInput,
                                           protyle: IProtyle, save: () => void, onResize: () => void) => {
    const lang = window.siyuan.languages;
    const conditions = document.createElement("div");
    mountCollectionConditions(conditions, source, save, onResize);
    const reference = document.createElement("div");
    const updateTarget = () => conditions.querySelector("[data-tag-target-control]")?.classList.toggle("fn__none", !!source.referenceID);
    mountCollectionReference(reference, source, protyle, () => { updateTarget(); save(); }, onResize);
    updateTarget();
    const names = new Map<string, string>();
    let revision = 0;
    const depthMode = () => source.documentDepth == null ? "unlimited" : source.documentDepth === 0 ? "current" : "limited";
    const depthLabels = {unlimited: lang.automationCollectionDepthUnlimited, current: lang.automationCollectionDepthCurrent,
        limited: lang.automationCollectionDepthLimited};
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
${documents.length ? `<div class="av__automation-control"><label class="av__automation-row"><span class="fn__flex-1">${lang.automationCollectionIncludeSelf}</span><input type="checkbox" class="b3-switch" data-include-selected-documents${source.includeSelectedDocuments !== false ? " checked" : ""}></label><div class="ft__on-surface ft__smaller av__automation-tip">${lang.automationCollectionIncludeSelfTip}</div></div>
<div class="av__automation-control"><div class="av__automation-row"><span class="av__automation-control-label fn__flex-1">${lang.automationCollectionDepth}</span><button type="button" class="b3-button b3-button--cancel b3-button--wrap av__automation-source-action" data-depth-mode aria-label="${escapeAttr(lang.automationCollectionDepth)}"><span>${depthLabels[depthMode()]}</span><svg><use xlink:href="#iconDown"></use></svg></button></div>${depthMode() === "limited" ? `<input type="number" class="b3-text-field fn__block" min="1" step="1" required data-document-depth value="${source.documentDepth}" aria-label="${escapeAttr(lang.automationCollectionDepth)}">` : ""}<div class="ft__on-surface ft__smaller av__automation-tip">${lang.automationCollectionDepthTip}</div></div>` : ""}
</div>`;
        host.firstElementChild.append(reference, conditions);
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
        if (target.hasAttribute("data-depth-mode")) {
            let menu: Menu;
            toggleMenu({target, build: () => {
                menu = new Menu();
                Object.entries(depthLabels).forEach(([mode, label]) => menu.addItem({iconHTML: "", label,
                    checked: mode === depthMode(), click: () => {
                        if (mode === depthMode()) { return; }
                        if (mode === "unlimited") { delete source.documentDepth; }
                        else { source.documentDepth = mode === "current" ? 0 : 1; }
                        host.querySelector("[data-document-depth]")?.remove();
                        save();
                        void render();
                    }}));
            }, show: () => {
                const rect = target.getBoundingClientRect();
                menu.open({x: rect.left, y: rect.bottom, h: rect.height, target});
            }});
            return;
        }
        if (target.hasAttribute("data-scope")) {
            movePathTo({title: lang.automationCollectionScope, flashcard: false, sourceNotebookIds: [protyle.notebookId], multiple: true,
                validate: (paths, boxes) => {
                    const notebooks = new Set(source.notebookIDs || []);
                    const documents = new Set(source.documentIDs || []);
                    const previousSize = notebooks.size + documents.size;
                    paths.forEach((path, i) => {
                        if (path === "/") { notebooks.add(boxes[i]); }
                        else { documents.add(path.split("/").pop().replace(/\.sy$/, "")); }
                    });
                    if (notebooks.size + documents.size <= 32 || notebooks.size + documents.size === previousSize) { return true; }
                    showMessage(lang.automationCollectionScopeLimit);
                    return false;
                },
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
    host.addEventListener("change", event => {
        const input = event.target as HTMLInputElement;
        if (input.matches("[data-include-selected-documents]")) {
            if (input.checked) { delete source.includeSelectedDocuments; }
            else { source.includeSelectedDocuments = false; }
            save();
            return;
        }
        if (!input.matches("[data-document-depth]")) { return; }
        const value = Number(input.value);
        input.setCustomValidity(input.value.trim() && Number.isSafeInteger(value) && value >= 1 ? "" : lang.invalid);
        if (!input.reportValidity()) { return; }
        if (source.documentDepth !== value) {
            source.documentDepth = value;
            save();
        }
    });
    host.addEventListener("keydown", event => {
        if (event.key === "Enter" && (event.target as HTMLElement).matches("[data-document-depth]")) {
            event.preventDefault();
            (event.target as HTMLElement).dispatchEvent(new Event("change", {bubbles: true}));
            return;
        }
        const target = (event.target as Element).closest<SVGElement>("[data-remove]");
        if (target && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            event.stopPropagation();
            target.dispatchEvent(new MouseEvent("click", {bubbles: true}));
        }
    });
    void render();
};
