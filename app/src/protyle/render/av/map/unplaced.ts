import type {AVTableRow} from "../../../../types/api";
import {Constants} from "../../../../constants";
import {showMessage} from "../../../../dialog/message";
import {Menu} from "../../../../plugin/Menu";
import {escapeAttr, escapeHtml} from "../../../../util/escape";
import {fetchSyncPost} from "../../../../util/fetch";
import {isMobile} from "../../../../util/functions";
import {validateAVLocation} from "../locationValue";
import {openMapRecord} from "./openRecord";
import {canEditMapSettings} from "./settings";
import {getMapSettings} from "./state";
import {registerMapUnplacedMenu} from "./unplacedMenu";
import {DesktopMapUnplacedHandle, DesktopMapUnplacedState, openDesktopMapUnplaced} from "./desktopUnplaced";
import {isAVMapIdentifier} from "./protocol";

const PAGE_SIZE = 50;

export const toMapUnplacedRow = (source: AVTableRow, locationKeyID: string): IAVRow | undefined => {
    const primary = source.cells?.find(cell => cell?.value?.type === "block");
    const location = source.cells?.find(cell => cell?.value?.type === "location" && cell.value.keyID === locationKeyID);
    const value = location?.value?.location;
    if (!primary?.value?.block || !location?.value || !validateAVLocation(value) ||
        value?.latitude != null || value?.longitude != null) {
        return;
    }
    return {id: source.id, cells: [
        {id: primary.id, valueType: "block", value: {id: primary.value.id, type: "block", isDetached: primary.value.isDetached,
            block: {content: primary.value.block.content, id: primary.value.block.id, icon: primary.value.block.icon}}},
        {id: location.id, valueType: "location", value: {id: location.value.id, keyID: locationKeyID,
            type: "location", location: value}},
    ]};
};

export const bindMapUnplaced = (options: {
    root: HTMLElement;
    blockElement: HTMLElement;
    protyle: IProtyle;
    data: IAV;
    current: () => boolean;
}) => {
    const {root, blockElement, protyle, data, current} = options;
    const toggle = root.querySelector<HTMLButtonElement>("[data-map-unplaced-toggle]");
    if (!toggle) return () => {};
    const locationKeyID = getMapSettings(data.view as IAVTable).locationKeyID;
    const query = blockElement.querySelector<HTMLElement>('[data-type="av-search"]')?.textContent.trim() || "";
    const context = {id: data.id, blockID: blockElement.dataset.nodeId || "", viewID: data.viewID, query};
    const view = data.view;
    let destroyed = false;
    const available = () => !destroyed && current() && canEditMapSettings(protyle) && data.view === view &&
        data.viewID === context.viewID && blockElement.dataset.avId === context.id &&
        (blockElement.querySelector<HTMLElement>('[data-type="av-search"]')?.textContent.trim() || "") === query &&
        !window.siyuan.notebooks?.some(notebook => notebook.id === protyle.notebookId && notebook.encrypted && notebook.closed) &&
        getMapSettings(data.view as IAVTable).locationKeyID === locationKeyID;
    const countRequest = new AbortController();
    let menu: Menu;
    let request: AbortController;
    let searchTimer: number;
    let search = "";
    let page = 0;
    let total = 0;
    let rows: IAVRow[] = [];
    let loading = false;
    let elements: HTMLElement[] = [];
    let count: HTMLElement;
    let releaseMenu: () => void;
    let native: DesktopMapUnplacedHandle;
    let nativeGeneration = 0;

    const updateCount = (value: number) => {
        toggle.classList.toggle("fn__none", value === 0);
    };
    const refreshCount = async () => {
        try {
            const response = await fetchSyncPost("/api/av/getAttributeViewMapUnplaced", {
                ...context, search: "", page: 1, pageSize: 1,
            }, undefined, false, countRequest.signal);
            if (!countRequest.signal.aborted && available() && response.code === 0 && response.data) {
                updateCount(response.data.total);
            } else if (!countRequest.signal.aborted && available()) {
                toggle.classList.remove("fn__none");
            }
        } catch {
            // 计数暂不可用时保留入口，允许用户打开列表重试。
            if (!countRequest.signal.aborted && available()) toggle.classList.remove("fn__none");
        }
    };
    const clearRows = () => {
        elements.forEach(element => element.remove());
        elements = [];
    };
    const addItem = (item: IMenu) => {
        const element = menu.addItem(item);
        if (element) elements.push(element);
    };
    const resetPosition = () => window.siyuan.menus.menu.resetPosition();
    const renderRows = (more = true) => {
        clearRows();
        count.textContent = total.toString();
        count.classList.remove("fn__none");
        rows.forEach(row => {
            const primary = row.cells[0].value;
            addItem({icon: "iconFile", label: escapeHtml(primary.block.content || window.siyuan.languages.untitled),
                click: element => {
                    if (menu && element.isConnected && available()) void openMapRecord(protyle, blockElement, row);
                }});
        });
        if (!rows.length) addItem({type: "readonly", iconHTML: "", label: escapeHtml(window.siyuan.languages.empty)});
        if (more && page * PAGE_SIZE < total) {
            addItem({icon: "iconArrowDown", label: escapeHtml(window.siyuan.languages.loadMore), click: element => {
                element.remove();
                void load();
                return true;
            }});
        }
        resetPosition();
    };
    const load = async (reset = false) => {
        if (!menu || !available() || loading && !reset) return;
        request?.abort();
        const controller = new AbortController();
        request = controller;
        const searchValue = search.trim();
        const nextPage = reset ? 1 : page + 1;
        loading = true;
        if (reset) {
            rows = [];
            page = 0;
            count.classList.add("fn__none");
            clearRows();
        }
        addItem({type: "readonly", iconHTML: "", label: escapeHtml(window.siyuan.languages.loading)});
        resetPosition();
        try {
            const response = await fetchSyncPost("/api/av/getAttributeViewMapUnplaced", {
                ...context, search: searchValue, page: nextPage, pageSize: PAGE_SIZE,
            }, undefined, false, controller.signal);
            if (controller.signal.aborted || !menu || !available() || searchValue !== search.trim()) return;
            if (response.code !== 0 || !response.data) throw new Error(response.msg || "");
            const nextRows = (response.data.rows || []).filter((row): row is AVTableRow => !!row)
                .map(row => toMapUnplacedRow(row, locationKeyID)).filter((row): row is IAVRow => !!row);
            rows = reset ? nextRows : [...rows, ...nextRows];
            page = nextPage;
            total = response.data.total;
            if (!searchValue) {
                countRequest.abort();
                updateCount(total);
            }
            renderRows();
        } catch {
            if (!controller.signal.aborted && menu && available() && searchValue === search.trim()) {
                if (reset) {
                    clearRows();
                    count.classList.add("fn__none");
                } else {
                    renderRows(false);
                }
                addItem({icon: "iconRefresh", label: escapeHtml(window.siyuan.languages.retry), click: element => {
                    element.remove();
                    void load(reset);
                    return true;
                }});
                resetPosition();
            }
        } finally {
            if (request === controller) loading = false;
        }
    };
    const openNative = (canvas: HTMLElement) => {
        const labels = window.siyuan.languages;
        let members = new Map<string, IAVRow>();
        let state: DesktopMapUnplacedState = {requestID: 0, query: "", rows: [], total: 0, page: 1,
            loading: true, error: false, labels: {title: labels.mapUnplaced, search: labels.searchPlaceholder,
                empty: labels.empty, loading: labels.loading, more: labels.next, previous: labels.previous,
                retry: labels.retry, close: labels.close}};
        const loadPage = async (requestID: number, query: string, nextPage: number) => {
            request?.abort();
            const controller = new AbortController();
            request = controller;
            const generation = ++nativeGeneration;
            members.clear();
            state = {...state, requestID, query, page: nextPage, rows: [], loading: true, error: false};
            native.update(state);
            try {
                const response = await fetchSyncPost("/api/av/getAttributeViewMapUnplaced", {
                    ...context, search: query.trim(), page: nextPage, pageSize: PAGE_SIZE,
                }, undefined, false, controller.signal);
                if (controller.signal.aborted || generation !== nativeGeneration || !native) return;
                if (!available()) { native.close(); return; }
                if (response.code !== 0 || !response.data || !Array.isArray(response.data.rows) ||
                    response.data.rows.length > PAGE_SIZE || !Number.isSafeInteger(response.data.total) || response.data.total < 0) {
                    throw new Error("Invalid unplaced page");
                }
                const nextMembers = new Map<string, IAVRow>();
                response.data.rows.forEach(source => {
                    if (!source || !isAVMapIdentifier(source.id) || nextMembers.has(source.id)) return;
                    const row = toMapUnplacedRow(source, locationKeyID);
                    if (row) nextMembers.set(row.id, row);
                });
                members = nextMembers;
                state = {...state, rows: Array.from(members.values(), row => ({id: row.id,
                    title: (row.cells[0].value.block.content || labels.untitled).slice(0, 2048)})),
                    total: response.data.total, loading: false};
                if (!query.trim()) {
                    countRequest.abort();
                    updateCount(state.total);
                }
                native.update(state);
            } catch {
                if (controller.signal.aborted || generation !== nativeGeneration || !native) return;
                if (!available()) { native.close(); return; }
                members.clear();
                state = {...state, rows: [], loading: false, error: true};
                native.update(state);
            }
        };
        native = openDesktopMapUnplaced(canvas, toggle, state, action => {
            if (!native) return;
            if (!available()) { native.close(); return; }
            if (action.action === "select") {
                const row = !state.loading && !state.error && action.requestID === state.requestID ? members.get(action.id) : undefined;
                native.close();
                if (row && available()) {
                    toggle.focus();
                    void openMapRecord(protyle, blockElement, row);
                }
                return;
            }
            request?.abort();
            nativeGeneration++;
            members.clear();
            if (action.action === "editing") {
                state = {...state, rows: [], loading: true};
                return;
            }
            void loadPage(action.requestID, action.query, action.page);
        }, failed => {
            nativeGeneration++;
            request?.abort();
            members.clear();
            native = undefined;
            toggle.setAttribute("aria-expanded", "false");
            if (failed && available()) showMessage(escapeHtml(`${labels.mapUnplaced}: ${labels.retry}`), 5000, "error");
        }, available);
        if (!native) return false;
        toggle.setAttribute("aria-expanded", "true");
        void loadPage(0, "", 1);
        return true;
    };
    toggle.addEventListener("click", event => {
        event.preventDefault();
        if (!available()) return;
        if (native) {
            native.close();
            return;
        }
        if (menu) {
            menu.close();
            return;
        }
        const canvas = root.querySelector<HTMLElement>(".av__map-canvas");
        if (!isMobile() && canvas && openNative(canvas)) return;
        menu = new Menu(undefined, () => {
            clearTimeout(searchTimer);
            request?.abort();
            releaseMenu?.();
            releaseMenu = undefined;
            menu = undefined;
            toggle.setAttribute("aria-expanded", "false");
        });
        if (!isMobile() && canvas) releaseMenu = registerMapUnplacedMenu(menu.element, canvas);
        rows = [];
        page = 0;
        total = 0;
        search = "";
        elements = [];
        menu.addItem({type: "readonly", iconHTML: "", label: `${escapeHtml(window.siyuan.languages.mapUnplaced)} <span class="counter fn__none" data-map-unplaced-count></span>`});
        count = menu.element.querySelector<HTMLElement>("[data-map-unplaced-count]");
        let input: HTMLInputElement;
        menu.addItem({type: "empty", label: `<div class="av__map-unplaced-search"><input type="search" ${Constants.ATTRIBUTE_MENU_KEYMAP}="true" class="b3-text-field fn__block" aria-label="${escapeAttr(window.siyuan.languages.search)}" placeholder="${escapeAttr(window.siyuan.languages.searchPlaceholder)}"></div>`,
            bind: element => { input = element.querySelector("input"); }});
        const searchRows = () => {
            request?.abort();
            clearTimeout(searchTimer);
            search = input.value;
            clearRows();
            count.classList.add("fn__none");
            addItem({type: "readonly", iconHTML: "", label: escapeHtml(window.siyuan.languages.loading)});
            searchTimer = window.setTimeout(() => { void load(true); }, Constants.TIMEOUT_INPUT);
        };
        input.addEventListener("input", (inputEvent: InputEvent) => {
            inputEvent.stopPropagation();
            if (!inputEvent.isComposing) searchRows();
        });
        input.addEventListener("compositionend", searchRows);
        const rect = toggle.getBoundingClientRect();
        toggle.setAttribute("aria-expanded", "true");
        menu.open({x: rect.right, y: rect.bottom, h: rect.height, isLeft: true, target: toggle});
        void load(true);
        if (!isMobile()) input.focus();
    });
    void refreshCount();
    return () => {
        destroyed = true;
        countRequest.abort();
        request?.abort();
        clearTimeout(searchTimer);
        menu?.close();
        native?.close();
    };
};
