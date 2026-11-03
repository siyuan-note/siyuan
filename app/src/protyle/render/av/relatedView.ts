import {avRender, initUnfoldedGroupTables, setAVGroupFolded} from "./render";
import {avClick} from "./action";
import {beginAVRender} from "./locate";
import {canEditAVHost, createAVHostProtyle, deleteAVRelationHost, IAVRelationHost, registerAVHostRefresh, setAVRelationHost} from "./host";
import {getAVData, getAVSelectedItemIDs, setAVData} from "./virtualScroll";
import {getFieldsByData} from "./view";
import {getColIconByType} from "./col";
import {hasAVCapability} from "./capabilities";
import {openMenuPanel} from "./openMenuPanel";
import {closeAVCellEditor} from "./cellEditor";
import {openDatabaseRowByData} from "./openDatabaseRow";
import {Menu} from "../../../plugin/Menu";
import {toggleMenu} from "../../../menus/menuToggle";
import {globalClickHideMenu} from "../../../menus/menuClick";
import {fetchSyncPost} from "../../../util/fetch";
import {fetchWithDocumentSelection} from "../../../util/documentSelectionRequest";
import {escapeHtmlTextAndAttr} from "../../../util/escape";
import {transaction} from "../../wysiwyg/transaction";
import {MobileDialog} from "../../../dialog/mobileDialog";
import {mobileConfirmDialog} from "../../../dialog/mobileConfirmDialog";
import {showMessage} from "../../../dialog/message";
import {Constants} from "../../../constants";
import type {AVRelationItemPreview} from "../../../types/api";
import {getAVCurrentViewID} from "./viewVisibility";
/// #if MOBILE
import {openMobileFileById} from "../../../mobile/editor";
/// #else
import {openFileById} from "../../../editor/util";
import {Editor} from "../../../editor";
/// #endif

export interface IRelatedAVTable {
    avID: string;
    keyValues: {key: {id: string; name?: string; type: TAVCol; relation?: IAVColumnRelation}; values?: IAVCellValue[]}[];
}

interface IRelatedAVState {
    targetAVID: string;
    configuredViewID: string;
    viewID: string;
    filters: IAVFilter[];
    sort?: IAVSort;
    query: string;
    folded: boolean;
}

const panels = new WeakMap<HTMLElement, RelatedAVView[]>();
const pendingStates = new WeakMap<HTMLElement, Map<string, IRelatedAVState>>();
const registrations = new Map<string, Set<RelatedAVView>>();
let nextInstance = 0;
let removalObserver: MutationObserver;

export const getRelatedAVIdentity = (sourceAvID: string, sourceItemID: string, keyID: string) =>
    JSON.stringify([sourceAvID, sourceItemID, keyID]);

export const getRelatedAVDefinitions = (tables: IRelatedAVTable[]) => tables.flatMap(table => {
    const primary = table.keyValues.find(item => item.key.type === "block")?.values?.[0];
    if (!primary?.blockID) return [];
    return table.keyValues.filter(item => item.key.type === "relation" && item.key.relation?.detailView?.enabled &&
        item.key.relation.detailView.spec === 1).map(item => ({
            sourceAvID: table.avID, sourceItemID: primary.blockID, keyID: item.key.id,
            name: item.key.name || window.siyuan.languages.relation,
            targetAVID: item.key.relation.avID || "", viewID: item.key.relation.detailView.viewID || "",
        }));
});

type TRelatedAVDefinition = ReturnType<typeof getRelatedAVDefinitions>[number];

class RelatedAVView {
    readonly identity: string;
    readonly element: HTMLElement;
    readonly hostElement: HTMLElement;
    readonly host: IAVRelationHost;
    private editor: IProtyle;
    private folded = false;
    private dirty = true;
    private disposed = false;
    private timeout?: ReturnType<typeof setTimeout>;
    private dialog?: MobileDialog;
    private query = "";
    private unregisterRefresh: () => void;
    private wasConnected = false;
    private sharedNavigation = 0;
    private cancelSharedOpening?: () => void;

    constructor(readonly protyle: IProtyle, readonly sourceElement: HTMLElement, readonly definition: TRelatedAVDefinition,
                sourceBlockID: string, state?: IRelatedAVState) {
        this.identity = getRelatedAVIdentity(definition.sourceAvID, definition.sourceItemID, definition.keyID);
        this.element = document.createElement("section");
        this.element.className = "av-related-view";
        this.element.innerHTML = `<div class="av-related-view__heading fn__flex">
    <button type="button" class="protyle-db-attr__toggle fn__flex fn__flex-1" data-related-action="fold" aria-expanded="true" aria-label="${escapeHtmlTextAndAttr(definition.name)}">
        <span class="block__icon block__icon--show fn__flex-center"><svg><use xlink:href="#iconDown"></use></svg></span>
        <span class="block__logo fn__ellipsis fn__flex-1">${escapeHtmlTextAndAttr(definition.name)}</span>
    </button>
    <button type="button" class="block__icon block__icon--show ariaLabel" data-related-action="add" data-position="8west" aria-label="${window.siyuan.languages._attrView.relatedDatabaseViewAdd}"><svg><use xlink:href="#iconAdd"></use></svg></button>
</div>`;
        this.hostElement = document.createElement("div");
        this.hostElement.className = "av av-related-view__table";
        this.hostElement.dataset.avHost = `related-${++nextInstance}`;
        this.hostElement.dataset.avId = definition.targetAVID;
        this.hostElement.dataset.avType = "table";
        this.hostElement.dataset.type = "NodeAttributeView";
        this.hostElement.innerHTML = '<div class="av__container"></div>';
        this.element.append(this.hostElement);
        this.host = {
            relationContext: {sourceAvID: definition.sourceAvID, sourceItemID: definition.sourceItemID,
                relationKeyID: definition.keyID},
            sourceBlockID, viewID: definition.viewID, temporaryFilters: [], active: false, available: false,
            readonly: () => Boolean(protyle.disabled || window.siyuan.config.readonly || window.siyuan.isPublish ||
                protyle.options.history?.created || protyle.options.history?.snapshot),
            rendered: data => this.rendered(data), failed: message => this.failed(message),
        };
        if (state && state.targetAVID === definition.targetAVID && state.configuredViewID === definition.viewID) {
            this.host.viewID = state.viewID;
            this.host.temporaryFilters = state.filters;
            this.host.temporarySort = state.sort;
            this.folded = state.folded;
            this.query = state.query;
        }
        setAVRelationHost(this.hostElement, this.host);
        this.editor = createAVHostProtyle(protyle, this.hostElement);
        this.element.addEventListener("click", event => this.click(event));
        this.element.addEventListener("contextmenu", event => {
            event.preventDefault();
            event.stopPropagation();
            const row = (event.target as HTMLElement).closest<HTMLElement>(".av__row[data-id]");
            if (row) this.rowMenu(row, event.clientX, event.clientY);
        });
        ["dragstart", "dragover", "drop", "paste", "cut"].forEach(type => this.element.addEventListener(type, event => {
            event.preventDefault();
            event.stopPropagation();
        }));
        this.element.addEventListener("keydown", event => {
            event.stopPropagation();
            const target = event.target as HTMLElement;
            if (!target.closest('[data-type="av-search"], input, textarea, button, a') &&
                ["Delete", "Backspace", "Enter"].includes(event.key)) event.preventDefault();
        });
        this.element.addEventListener("pointerdown", event => event.stopPropagation());
        this.element.addEventListener("mousedown", event => event.stopPropagation());
        let views = registrations.get(protyle.id);
        if (!views) registrations.set(protyle.id, views = new Set());
        views.add(this);
        if (!removalObserver) {
            removalObserver = new MutationObserver(() => registrations.forEach(items => items.forEach(view => {
                if (view.wasConnected && !view.element.isConnected) view.dispose();
            })));
            removalObserver.observe(document.body, {childList: true, subtree: true});
        }
        this.unregisterRefresh = registerAVHostRefresh(protyle.id, avID => {
            if (definition.sourceAvID === avID || definition.targetAVID === avID) this.invalidate();
        });
    }

    state(): IRelatedAVState {
        return {targetAVID: this.definition.targetAVID, configuredViewID: this.definition.viewID,
            viewID: this.host.viewID, filters: structuredClone(this.host.temporaryFilters),
            sort: this.host.temporarySort && {...this.host.temporarySort},
            query: this.hostElement.querySelector('[data-type="av-search"]')?.textContent ?? this.query, folded: this.folded};
    }

    restore(state?: IRelatedAVState) {
        if (!state || state.targetAVID !== this.definition.targetAVID || state.configuredViewID !== this.definition.viewID) return;
        this.host.viewID = state.viewID;
        this.host.temporaryFilters = state.filters;
        this.host.temporarySort = state.sort;
        this.folded = state.folded;
        this.query = state.query;
    }

    sync(forceHidden = false) {
        if (this.disposed) return;
        this.wasConnected ||= this.element.isConnected;
        const visible = !forceHidden && this.element.isConnected && !this.element.closest(".fn__none, .protyle-db-attr--collapsed") && !this.folded;
        this.hostElement.classList.toggle("fn__none", this.folded);
        const fold = this.element.querySelector('[data-related-action="fold"]');
        fold.setAttribute("aria-expanded", String(!this.folded));
        fold.querySelector("use").setAttribute("xlink:href", this.folded ? "#iconRight" : "#iconDown");
        this.element.querySelector<HTMLButtonElement>('[data-related-action="add"]').disabled = this.host.readonly() || !this.host.available;
        if (!visible || this.host.readonly()) {
            closeAVCellEditor(this.element, false);
            this.dialog?.destroy();
        }
        if (this.host.active && !visible) {
            this.dirty = true;
            beginAVRender(this.hostElement);
        }
        this.host.active = visible;
        if (visible && this.dirty) void this.render();
    }

    invalidate() {
        this.dirty = true;
        beginAVRender(this.hostElement);
        clearTimeout(this.timeout);
        this.timeout = setTimeout(() => this.sync(), 100);
    }

    invalidateSecurity() {
        beginAVRender(this.hostElement);
        clearTimeout(this.timeout);
        this.dialog?.destroy();
        this.failed();
        this.host.active = false;
        this.dirty = true;
    }

    private async render() {
        if (!this.host.active || this.disposed) return;
        this.dirty = false;
        if (!this.definition.targetAVID || !this.definition.viewID) {
            this.failed();
            return;
        }
        this.hostElement.removeAttribute("data-render");
        if (this.query && !this.hostElement.querySelector('[data-type="av-search"]')) {
            const input = document.createElement("div");
            input.dataset.type = "av-search";
            input.textContent = this.query;
            this.hostElement.firstElementChild.append(input);
        }
        try {
            await avRender(this.hostElement, this.editor);
        } catch (error) {
            if (this.host.active && !this.disposed && error?.name !== "AbortError") this.failed();
        }
    }

    private failed(message?: string) {
        this.host.available = false;
        setAVData(this.hostElement, undefined);
        this.element.querySelector<HTMLButtonElement>('[data-related-action="add"]').disabled = true;
        closeAVCellEditor(this.element, false);
        this.hostElement.removeAttribute("data-render");
        this.hostElement.innerHTML = `<div class="av__container"><div class="b3-list--empty">${escapeHtmlTextAndAttr(message || window.siyuan.languages._attrView.relatedDatabaseViewUnavailable)}</div>
<button type="button" class="b3-button b3-button--cancel" data-related-action="retry">${window.siyuan.languages.refresh}</button>
${this.host.readonly() ? "" : `<button type="button" class="b3-button b3-button--cancel" data-related-action="configure">${window.siyuan.languages.config}</button>`}</div>`;
    }

    private rendered(data: IAV) {
        this.host.available = true;
        this.element.querySelector<HTMLButtonElement>('[data-related-action="add"]').disabled = this.host.readonly();
        this.host.viewID = data.viewID;
        this.query = this.hostElement.querySelector('[data-type="av-search"]')?.textContent ?? this.query;
        this.hostElement.querySelectorAll('[data-type="av-add"], [data-type="av-add-top"], [data-type="av-row-update"], [data-type="av-context-filter"], .av__new, [data-type="av-add-bottom"], [data-type="av-header-add"], [data-type="av-header-more"], .av__widthdrag, .av__freeze-drag, .av__drag-fill').forEach(element => element.remove());
        this.hostElement.querySelectorAll('[data-type="av-switcher"]:not(.av__mobile-view)').forEach(element => element.remove());
        this.hostElement.querySelectorAll<HTMLElement>('[draggable="true"]').forEach(element => element.draggable = false);
        this.hostElement.querySelectorAll<HTMLElement>(".av__title, .av__cursor").forEach(element => element.contentEditable = "false");
        this.hostElement.querySelectorAll<HTMLElement>(".layout-tab-bar .item").forEach(element => {
            element.classList.toggle("fn__none", element.dataset.avType !== "table");
        });
        this.hostElement.querySelector('[data-type="av-sort"]')?.setAttribute("aria-label", window.siyuan.languages.avTemporarySort);
        this.hostElement.querySelector('[data-type="av-filter"]')?.setAttribute("aria-label", window.siyuan.languages._attrView.relatedDatabaseViewTemporaryFilter);
        this.hostElement.querySelector('[data-type="av-selection-delete"]')?.setAttribute("aria-label", window.siyuan.languages._attrView.relatedDatabaseViewRemove);
        this.hostElement.querySelector('[data-type="av-selection-edit"]')?.remove();
        this.hostElement.querySelector('[data-type="av-selection-more"]')?.remove();
    }

    private click(event: MouseEvent) {
        event.stopPropagation();
        const target = event.target as HTMLElement;
        globalClickHideMenu(target);
        const action = target.closest<HTMLElement>("[data-related-action]")?.dataset.relatedAction;
        if (action === "fold") {
            this.folded = !this.folded;
            this.sync();
            return;
        }
        if (action === "add") {
            if (canEditAVHost(this.hostElement, this.protyle)) this.openCandidates();
            return;
        }
        if (action === "configure") {
            if (!this.host.readonly()) openMenuPanel({protyle: this.protyle, blockElement: this.sourceElement,
                type: "edit", colId: this.definition.keyID});
            return;
        }
        if (action === "retry") {
            this.dirty = true;
            this.sync();
            return;
        }
        if (!this.host.active) return;
        const type = target.closest<HTMLElement>("[data-type]")?.dataset.type;
        if (type === "av-row-update") {
            event.preventDefault();
            return;
        } else if (type === "av-switcher") {
            this.viewMenu(target.closest<HTMLElement>('[data-type="av-switcher"]'));
        } else if (type === "av-sort") {
            this.sortMenu(target);
        } else if (type === "av-filter") {
            const data = getAVData(this.hostElement);
            if (!data) return;
            const local = structuredClone(data);
            local.view.filters = structuredClone(this.host.temporaryFilters);
            openMenuPanel({protyle: this.editor, blockElement: this.hostElement, type: "filters", data: local,
                filterOperation: {save: filters => {
                    this.host.temporaryFilters = structuredClone(filters);
                    this.invalidate();
                }}});
        } else if (type === "av-more" || type === "set-page-size" || target.closest(".av__cell--header, .av__calc")) {
            this.openSharedView();
        } else if (type === "av-selection-delete") {
            this.unlink(getAVSelectedItemIDs(this.hostElement));
        } else if (type === "av-row-open") {
            void this.openRow(target.closest<HTMLElement>(".av__row[data-id]")?.dataset.id);
        } else if (type === "av-row-more") {
            const rect = target.getBoundingClientRect();
            this.rowMenu(target.closest<HTMLElement>(".av__row[data-id]"), rect.left, rect.bottom);
        } else if (type === "av-group-fold") {
            const button = target.closest<HTMLElement>('[data-type="av-group-fold"]');
            setAVGroupFolded(button, button.firstElementChild.classList.contains("av__group-arrow--open"));
            initUnfoldedGroupTables(this.hostElement, this.editor);
            this.rendered(getAVData(this.hostElement));
        } else if (target.closest(".layout-tab-bar .item")) {
            const tab = target.closest<HTMLElement>(".layout-tab-bar .item");
            if (tab.dataset.avType === "table" && tab.dataset.id !== this.host.viewID) {
                this.host.viewID = tab.dataset.id;
                this.invalidate();
            }
        } else if (type === "av-load-more" || type === "av-search-icon" || type === "av-search-close" ||
            target.closest(".av__firstcol, .av__cell:not(.av__cell--header)")) {
            avClick(this.editor, event as MouseEvent & {target: HTMLElement});
        }
    }

    private viewMenu(target: HTMLElement) {
        const data = getAVData(this.hostElement);
        if (!data) return;
        toggleMenu({target, build: () => {
            const menu = new Menu();
            data.views.filter(view => view.type === "table").forEach(view => menu.addItem({
                label: view.name, icon: "iconTable", checked: view.id === this.host.viewID,
                click: () => {
                    if (!this.host.active) return;
                    this.host.viewID = view.id;
                    this.invalidate();
                },
            }));
            const rect = target.getBoundingClientRect();
            menu.open({x: rect.left, y: rect.bottom, h: rect.height});
        }});
    }

    private sortMenu(target: HTMLElement) {
        const data = getAVData(this.hostElement);
        if (!data) return;
        toggleMenu({target, build: () => {
        const menu = new Menu();
        menu.addItem({type: "readonly", label: window.siyuan.languages.avTemporarySort});
        getFieldsByData(data).filter(field => hasAVCapability(field.type, "sortable")).forEach(field => menu.addItem({
            label: field.name, icon: getColIconByType(field.type), submenu: (["ASC", "DESC"] as const).map(order => ({
                label: window.siyuan.languages[order === "ASC" ? "asc" : "desc"],
                checked: this.host.temporarySort?.column === field.id && this.host.temporarySort.order === order,
                click: () => { this.host.temporarySort = {column: field.id, order}; this.invalidate(); },
            })),
        }));
        menu.addSeparator();
        menu.addItem({label: window.siyuan.languages.avRestoreDefaultSort, click: () => {
            this.host.temporarySort = undefined;
            this.invalidate();
        }});
        const rect = target.getBoundingClientRect();
        menu.open({x: rect.left, y: rect.bottom, h: rect.height});
        }});
    }

    private rowMenu(row: HTMLElement, x: number, y: number) {
        if (!row?.dataset.id) return;
        toggleMenu({target: row, toggle: false, build: () => {
        const menu = new Menu();
        menu.addItem({label: window.siyuan.languages.openBy, icon: "iconOpen", click: () => { void this.openRow(row.dataset.id); }});
        if (canEditAVHost(this.hostElement, this.protyle)) menu.addItem({
            label: window.siyuan.languages._attrView.relatedDatabaseViewRemove, icon: "iconLinkOff",
            click: () => this.unlink([row.dataset.id]),
        });
        menu.open({x, y});
        }});
    }

    private openSharedView() {
        if (!canEditAVHost(this.hostElement, this.protyle)) return;
        this.cancelSharedOpening?.();
        const navigation = ++this.sharedNavigation;
        const viewID = this.host.viewID;
        const sourceIsCurrent = () => navigation === this.sharedNavigation && this.host.viewID === viewID &&
            canEditAVHost(this.hostElement, this.protyle);
        mobileConfirmDialog(window.siyuan.languages.config, window.siyuan.languages._attrView.relatedDatabaseViewSharedTip,
            async () => {
                if (!sourceIsCurrent()) return;
                try {
                    const response = await fetchSyncPost("/api/av/getAttributeViewRelationCandidates", {
                        avID: this.definition.sourceAvID, keyID: this.definition.keyID,
                        blockID: this.host.sourceBlockID, relationContext: this.host.relationContext, page: 1, pageSize: 1,
                    });
                    if (!sourceIsCurrent()) return;
                    const target = response.code === 0 && response.data && "blockIDs" in response.data ? response.data : undefined;
                    const blockID = target?.blockIDs?.[0];
                    if (!blockID || !target.notebookID) {
                        showMessage(window.siyuan.languages._attrView.relatedDatabaseViewUnavailable);
                        return;
                    }
                    const configure = (editor: IProtyle) => {
                        const root = editor.wysiwyg?.element;
                        const rootID = editor.block?.rootID;
                        if (!root) return;
                        const current = () => navigation === this.sharedNavigation && root.isConnected &&
                            editor.wysiwyg.element === root && editor.block?.rootID === rootID &&
                            editor.notebookId === target.notebookID && !editor.element.closest(".fn__none") &&
                            !editor.disabled && !window.siyuan.config.readonly && !window.siyuan.isPublish &&
                            !editor.options.history?.created && !editor.options.history?.snapshot;
                        const isCurrentEditor = () => {
                            /// #if MOBILE
                            if (window.siyuan.mobile.editor?.protyle !== editor) return false;
                            /// #endif
                            return current();
                        };
                        const pending: {observer?: MutationObserver, timeout?: ReturnType<typeof setTimeout>} = {};
                        const stop = () => {
                            pending.observer?.disconnect(); clearTimeout(pending.timeout);
                            if (this.cancelSharedOpening === stop) this.cancelSharedOpening = undefined;
                        };
                        const ready = () => {
                            if (!isCurrentEditor()) { stop(); return true; }
                            const block = root.querySelector<HTMLElement>(`.av[data-node-id="${blockID}"]`);
                            if (!block) return false;
                            stop();
                            const valid = () => isCurrentEditor() && block.isConnected && root.contains(block) &&
                                block.dataset.avId === this.definition.targetAVID && block.dataset.nodeId === blockID;
                            if (!valid()) return true;
                            const open = () => {
                                if (!valid()) return;
                                block.removeAttribute("data-render");
                                void avRender(block, editor, data => {
                                    if (valid()) openMenuPanel({protyle: editor, blockElement: block, type: "config", data});
                                }).catch(() => {
                                    if (valid()) showMessage(window.siyuan.languages._attrView.relatedDatabaseViewUnavailable);
                                });
                            };
                            const previousViewID = getAVCurrentViewID(block);
                            if (previousViewID === viewID) open();
                            else transaction(editor, [{action: "setAttrViewBlockView", avID: this.definition.targetAVID,
                                blockID, id: viewID}], [{action: "setAttrViewBlockView", avID: this.definition.targetAVID,
                                blockID, id: previousViewID}], {callback: open});
                            return true;
                        };
                        if (ready()) return;
                        // 新页签回调可能先于正文加载，等待真实载体出现，并在目标离开时释放观察器。
                        this.cancelSharedOpening = stop;
                        pending.observer = new MutationObserver(ready);
                        pending.observer.observe(editor.element, {childList: true, subtree: true, attributes: true, attributeFilter: ["class"]});
                        if (editor.element.parentElement && editor.element.parentElement !== document.body) {
                            pending.observer.observe(editor.element.parentElement, {childList: true, attributes: true, attributeFilter: ["class"]});
                        }
                        pending.timeout = setTimeout(() => {
                            stop();
                            if (isCurrentEditor()) showMessage(window.siyuan.languages._attrView.relatedDatabaseViewUnavailable);
                        }, 10000);
                    };
                    /// #if MOBILE
                    await openMobileFileById(this.protyle.app, blockID, [Constants.CB_GET_HL, Constants.CB_GET_CONTEXT],
                        "start", target.notebookID, configure);
                    /// #else
                    await openFileById({app: this.protyle.app, id: blockID, notebookId: target.notebookID,
                        openNewTab: true, removeCurrentTab: false, keepAVPanel: true,
                        afterOpen: model => { if (model instanceof Editor) configure(model.editor.protyle); }});
                    /// #endif
                } catch (error) {
                    if (sourceIsCurrent()) {
                        showMessage(window.siyuan.languages._attrView.relatedDatabaseViewUnavailable);
                    }
                }
            }, undefined, false, undefined, window.siyuan.languages.openBy);
    }

    private async openRow(itemID: string) {
        if (!itemID || !this.host.active) return;
        try {
            const response = await fetchSyncPost("/api/av/getAttributeViewKeys", {id: itemID, avID: this.definition.targetAVID, itemID,
                blockID: this.host.sourceBlockID, relationContext: this.host.relationContext});
            if (this.disposed || !this.host.active || response.code !== 0) return;
            const table = response.data?.find(item => item.avID === this.definition.targetAVID);
            const value = table?.keyValues.find(item => item.key.type === "block")?.values?.[0];
            if (!value?.block) return;
            const databaseBlockID = table.blockIDs?.[0] || "";
            if ((!databaseBlockID && value.isDetached) || !table.notebookID) {
                showMessage(window.siyuan.languages._attrView.relatedDatabaseViewUnavailable);
                return;
            }
            const opened = await openDatabaseRowByData(this.protyle, {avID: this.definition.targetAVID,
                databaseBlockID, notebookID: table.notebookID, itemID, valueID: value.id,
                title: value.block.content, isDetached: value.isDetached, boundBlockID: value.block.id});
            if (!opened && !this.disposed && this.host.active) showMessage(window.siyuan.languages._attrView.relatedDatabaseViewUnavailable);
        } catch (error) {
            if (!this.disposed && this.host.active) showMessage(window.siyuan.languages._attrView.relatedDatabaseViewUnavailable);
        }
    }

    private unlink(itemIDs: string[]) {
        if (!canEditAVHost(this.hostElement, this.protyle) || !itemIDs.length) return;
        this.updateMembers([], itemIDs);
    }

    private updateMembers(addItemIDs: string[], removeItemIDs: string[]) {
        if (!canEditAVHost(this.hostElement, this.protyle)) return;
        const operation = (add: string[], remove: string[]): IOperation => ({action: "updateAttrViewRelationItems",
            avID: this.definition.sourceAvID, rowID: this.definition.sourceItemID, keyID: this.definition.keyID,
            blockID: this.host.sourceBlockID, data: {addItemIDs: add, removeItemIDs: remove}});
        transaction(this.protyle, [operation(addItemIDs, removeItemIDs)], [operation(removeItemIDs, addItemIDs)], {
            callback: () => this.invalidate(),
        });
    }

    private async inspectCreatedItem(itemID: string) {
        const viewID = this.host.viewID;
        const query = this.hostElement.querySelector('[data-type="av-search"]')?.textContent?.trim() || "";
        try {
            const response = await fetchSyncPost("/api/av/renderAttributeView", {
                id: this.definition.targetAVID, blockID: this.host.sourceBlockID,
                relationContext: this.host.relationContext, viewID, query,
                temporaryFilters: this.host.temporaryFilters, temporarySort: this.host.temporarySort,
                targetItemID: itemID, createIfNotExist: false, pageSize: 1,
            }, undefined, false);
            if (this.disposed || !this.host.active || this.host.viewID !== viewID ||
                (this.hostElement.querySelector('[data-type="av-search"]')?.textContent?.trim() || "") !== query) return;
            if (response.code === 0 && response.data && "target" in response.data &&
                ["filtered", "groupHidden"].includes(response.data.target?.status)) {
                showMessage(window.siyuan.languages.databaseItemFiltered);
            }
        } catch (error) {
            // 创建已完成，状态查询失败交给面板刷新处理，不能提示创建失败导致重复提交。
        }
    }

    private openCandidates() {
        this.dialog?.destroy();
        let controller: AbortController;
        let timer: ReturnType<typeof setTimeout>;
        let preview: AVRelationItemPreview;
        let page = 1;
        let keyword = "";
        const dialog = new MobileDialog({title: window.siyuan.languages._attrView.relatedDatabaseViewAdd,
            width: "520px", mobileSheet: {mode: "expanded"},
            content: `<div class="b3-dialog__content av-related-view__picker">
    <input class="b3-text-field fn__block" type="search" placeholder="${window.siyuan.languages.searchPlaceholder}" aria-label="${window.siyuan.languages.search}">
    <div class="b3-list av-related-view__candidates"></div>
    <div class="fn__flex"><button class="b3-button b3-button--cancel" data-related-picker="more">${window.siyuan.languages.more}</button><span class="fn__flex-1"></span><button class="b3-button" data-related-picker="new" disabled>${window.siyuan.languages._attrView.relatedDatabaseViewNew}</button></div>
</div>`, destroyCallback: () => { controller?.abort(); clearTimeout(timer); if (this.dialog === dialog) this.dialog = undefined; }});
        this.dialog = dialog;
        const input = dialog.element.querySelector<HTMLInputElement>("input");
        const list = dialog.element.querySelector<HTMLElement>(".av-related-view__candidates");
        const create = dialog.element.querySelector<HTMLButtonElement>('[data-related-picker="new"]');
        const more = dialog.element.querySelector<HTMLButtonElement>('[data-related-picker="more"]');
        const valid = () => dialog.element.isConnected && canEditAVHost(this.hostElement, this.protyle);
        const load = async (append = false) => {
            controller?.abort();
            const request = controller = new AbortController();
            create.disabled = true;
            preview = undefined;
            keyword = input.value;
            if (!append) { page = 1; list.innerHTML = '<div class="b3-list--empty"><span class="b3-loading"></span></div>'; }
            try {
                const response = await fetchSyncPost("/api/av/getAttributeViewRelationCandidates", {
                    avID: this.definition.sourceAvID, keyID: this.definition.keyID, blockID: this.host.sourceBlockID,
                    relationContext: this.host.relationContext,
                    keyword, page, pageSize: 20, selectedBlockIDs: [], includeNewItemPreview: true,
                }, undefined, false, request.signal);
                if (request.signal.aborted || !valid()) return;
                if (response.code !== 0 || !response.data) {
                    list.textContent = window.siyuan.languages._attrView.relatedDatabaseViewUnavailable;
                    return;
                }
                preview = response.data.newItemPreview;
                create.disabled = !preview || !!preview.error;
                const rows = response.data.rows || [];
                const html = rows.map(row => `<button type="button" class="b3-list-item" data-item-id="${row.id}"><span class="b3-list-item__text">${escapeHtmlTextAndAttr(row.cells.find(cell => cell.valueType === "block")?.value?.block?.content || window.siyuan.languages.untitled)}</span></button>`).join("");
                if (append) list.insertAdjacentHTML("beforeend", html);
                else list.innerHTML = html || `<div class="b3-list--empty">${window.siyuan.languages.emptyContent}</div>`;
                more.classList.toggle("fn__none", page * 20 >= response.data.total);
            } catch (error) {
                if (!request.signal.aborted && valid()) list.textContent = window.siyuan.languages._attrView.relatedDatabaseViewUnavailable;
            }
        };
        input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => { void load(); }, Constants.TIMEOUT_INPUT); });
        more.addEventListener("click", () => { page++; void load(true); });
        list.addEventListener("click", event => {
            const item = (event.target as HTMLElement).closest<HTMLElement>("[data-item-id]");
            if (!item || !valid()) return;
            this.updateMembers([item.dataset.itemId], []);
            dialog.destroy();
        });
        create.addEventListener("click", async () => {
            if (!valid() || create.disabled || !preview || keyword !== input.value) return;
            create.disabled = true;
            const request = {avID: this.definition.sourceAvID, keyID: this.definition.keyID,
                blockID: this.host.sourceBlockID, relationContext: this.host.relationContext,
                keyword, useInputName: !!keyword.trim(), preview,
                cells: [{itemID: this.definition.sourceItemID, relatedItemIDs: [] as string[]}],
                app: this.protyle.app.appId, session: this.protyle.id};
            try {
                const response = await fetchWithDocumentSelection(selection => fetchSyncPost("/api/av/createAttributeViewRelationItem", {...request, selection}, undefined, false),
                    {notebooks: [this.protyle.notebookId], isValid: valid});
                if (response?.code === 0) {
                    if (response.data && "warnings" in response.data && response.data.warnings?.length) {
                        showMessage(response.data.warnings.map(item => escapeHtmlTextAndAttr(item)).join("<br>"));
                    }
                    this.invalidate();
                    dialog.destroy();
                    if (response.data && "itemID" in response.data) void this.inspectCreatedItem(response.data.itemID);
                }
                else if (response) showMessage(window.siyuan.languages._attrView.relatedDatabaseViewUnavailable);
            } catch (error) {
                if (valid()) showMessage(window.siyuan.languages._attrView.relatedDatabaseViewUnavailable);
            } finally {
                if (valid()) create.disabled = false;
            }
        });
        void load();
        dialog.focusWhenReady(() => input);
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.host.active = false;
        beginAVRender(this.hostElement);
        clearTimeout(this.timeout);
        closeAVCellEditor(this.element, false);
        this.dialog?.destroy();
        this.unregisterRefresh();
        setAVData(this.hostElement, undefined);
        deleteAVRelationHost(this.hostElement);
        const views = registrations.get(this.protyle.id);
        views?.delete(this);
        if (!views?.size) registrations.delete(this.protyle.id);
        if (!registrations.size) {
            removalObserver?.disconnect();
            removalObserver = undefined;
        }
    }
}

export const preserveRelatedAVViews = (source: HTMLElement, destination = source) => {
    const states = new Map((panels.get(source) || []).map(view => [view.identity, view.state()]));
    disposeRelatedAVViews(source);
    if (source !== destination && panels.has(destination)) {
        panels.get(destination).forEach(view => view.restore(states.get(view.identity)));
    } else pendingStates.set(destination, states);
};

export const mountRelatedAVViews = (element: HTMLElement, tables: IRelatedAVTable[], protyle: IProtyle, sourceBlockID: string) => {
    const states = pendingStates.get(element);
    pendingStates.delete(element);
    const views = getRelatedAVDefinitions(tables).flatMap(definition => {
        const source = Array.from(element.children).find((child): child is HTMLElement =>
            child instanceof HTMLElement && child.dataset.avId === definition.sourceAvID);
        if (!source) return [];
        const view = new RelatedAVView(protyle, source, definition, sourceBlockID,
            states?.get(getRelatedAVIdentity(definition.sourceAvID, definition.sourceItemID, definition.keyID)));
        source.append(view.element);
        return [view];
    });
    panels.set(element, views);
};

export const syncRelatedAVViews = (element: HTMLElement, forceHidden = false) => panels.get(element)?.forEach(view => view.sync(forceHidden));

export const disposeRelatedAVViews = (element: HTMLElement) => {
    panels.get(element)?.forEach(view => view.dispose());
    panels.delete(element);
};

export const destroyRelatedAVViews = (protyleID: string) => {
    registrations.get(protyleID)?.forEach(view => view.dispose());
    registrations.delete(protyleID);
};

export const syncRelatedAVEditor = (protyleID: string) => registrations.get(protyleID)?.forEach(view => view.sync());

// 关联表可能通过汇总或模板引用其他笔记本，关闭笔记本时先清空所有跨库详情，重试再验证访问权限。
export const invalidateRelatedAVSecurity = () => registrations.forEach(views => views.forEach(view => view.invalidateSecurity()));
