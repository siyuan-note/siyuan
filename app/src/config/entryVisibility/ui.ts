import {confirmDialog} from "../../dialog/confirmDialog";
import {showMessage} from "../../dialog/message";
import {escapeAttr, escapeHtml} from "../../util/escape";
import {genUUID} from "../../util/genID";
import {
    entryCatalog,
    getEntryCatalogChildren,
    getEntryCatalogPathChain,
    getEntryPaths,
    IEntryCatalogNode,
    IEntryCatalogSection,
} from "./catalog";
import {
    createEntryProfileSnapshot,
    createEntryOrderSnapshot,
    ENTRY_PROFILE_FULL,
    ENTRY_PROFILE_SIMPLE,
    ENTRY_VISIBILITY_VERSION,
    getActiveEntryProfile,
    isEntryVisible,
    saveEntryVisibility,
} from "./runtime";
import {moveEntryOrder, resolveEntryOrder} from "./order";

type TImportFile = {
    type: "siyuan-entry-profile" | "siyuan-entry-profile-bundle";
    version: number;
    profile?: Config.IEntryVisibilityProfile;
    profiles?: Config.IEntryVisibilityProfile[];
};

const cloneConfig = () => JSON.parse(JSON.stringify(
    window.siyuan.config.appearance.entryVisibility
)) as Config.IEntryVisibility;

const baseLabel = (base: Config.TEntryVisibilityBase) => base === ENTRY_PROFILE_SIMPLE
    ? window.siyuan.languages.entrySimple
    : window.siyuan.languages.entryFull;

const uniqueName = (name: string, profiles = window.siyuan.config.appearance.entryVisibility.profiles) => {
    const normalized = name.trim() || window.siyuan.languages.entryCustomProfile;
    if (!profiles.some((item) => item.name === normalized)) {
        return normalized;
    }
    let index = 2;
    while (profiles.some((item) => item.name === `${normalized} (${index})`)) {
        index++;
    }
    return `${normalized} (${index})`;
};

const downloadJSON = (name: string, data: unknown) => {
    const blob = new Blob([JSON.stringify(data, undefined, 2)], {type: "application/json"});
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name.replace(/[\\/:*?"<>|]/g, "-");
    anchor.click();
    URL.revokeObjectURL(url);
};

const exportProfile = (profile: Config.IEntryVisibilityProfile) => {
    downloadJSON(`${profile.name}.siyuan-entry.json`, {
        type: "siyuan-entry-profile",
        version: ENTRY_VISIBILITY_VERSION,
        profile,
    } satisfies TImportFile);
};

const exportBundle = () => {
    downloadJSON("入口方案.siyuan-entry-bundle.json", {
        type: "siyuan-entry-profile-bundle",
        version: ENTRY_VISIBILITY_VERSION,
        profiles: window.siyuan.config.appearance.entryVisibility.profiles,
    } satisfies TImportFile);
};

const getCurrentBase = (): Config.TEntryVisibilityBase => {
    const active = window.siyuan.config.appearance.entryVisibility.active;
    if (active === ENTRY_PROFILE_SIMPLE || active === ENTRY_PROFILE_FULL) {
        return active;
    }
    return getActiveEntryProfile()?.base || ENTRY_PROFILE_FULL;
};

const createProfile = (base: Config.TEntryVisibilityBase, current = false, name?: string) => {
    const profile: Config.IEntryVisibilityProfile = {
        id: genUUID(),
        name: uniqueName(name || window.siyuan.languages.entryCustomProfile),
        base,
        entries: createEntryProfileSnapshot(base),
        orders: createEntryOrderSnapshot(current),
    };
    if (current) {
        getEntryPaths().forEach((path) => {
            profile.entries[path] = isEntryVisible(path);
        });
    }
    return profile;
};

const duplicateProfile = (profile: Config.IEntryVisibilityProfile) => {
    const copy = JSON.parse(JSON.stringify(profile)) as Config.IEntryVisibilityProfile;
    copy.id = genUUID();
    copy.name = uniqueName(`${profile.name} ${window.siyuan.languages.duplicate}`);
    copy.orders ||= createEntryOrderSnapshot();
    return copy;
};

const getEntryViewHost = (root: HTMLElement) => root.closest<HTMLElement>(".config__tab-container") || root;

const getEntryViews = (root: HTMLElement) => Array.from(getEntryViewHost(root).children)
    .filter((element): element is HTMLElement =>
        element instanceof HTMLElement && element.classList.contains("config-entry-visibility__view"));

const removeEntryView = (root: HTMLElement, view?: HTMLElement) => {
    const views = view ? [view] : getEntryViews(root);
    views.forEach((item) => {
        item.classList.remove("config__view--show");
        item.addEventListener("transitionend", (event) => {
            if (event.propertyName === "opacity") {
                item.remove();
            }
        });
        window.setTimeout(() => item.remove(), 300);
    });
};

const createEntryView = (root: HTMLElement) => {
    removeEntryView(root);
    const view = document.createElement("div");
    view.className = "config-entry-visibility__view config__view";
    view.innerHTML = `<div class="b3-dialog__header fn__flex">
    <div class="block__logo fn__pointer fn__flex-1" data-action="back">
        <svg class="block__logoicon"><use xlink:href="#iconLeft"></use></svg>
        <span class="ft__breakword">${window.siyuan.languages.entryVisibility}</span>
    </div>
</div>
<div class="b3-dialog__body fn__flex-1"></div>`;
    getEntryViewHost(root).append(view);
    view.getBoundingClientRect();
    view.classList.add("config__view--show");
    return view;
};

const profileCard = (
    id: string,
    name: string,
    base: Config.TEntryVisibilityBase,
    builtin: boolean,
    active: boolean,
) => `<div class="b3-card${active ? " b3-card--current" : ""}" data-profile-id="${escapeAttr(id)}" data-action="${builtin ? "view" : "edit"}">
    <div class="fn__flex-1 fn__flex-column">
        <div class="b3-card__info b3-card__info--left fn__flex-1">
            <div class="fn__ellipsis config-name">${escapeHtml(name)}</div>
            <div class="b3-card__desc">${builtin ? window.siyuan.languages.entryBuiltin : `${window.siyuan.languages.entryCustom} · ${window.siyuan.languages.entryBasedOn} ${baseLabel(base)}`}${active ? ` · ${window.siyuan.languages.current}` : ""}${builtin ? ` · ${base === ENTRY_PROFILE_SIMPLE ? window.siyuan.languages.entrySimpleTip : window.siyuan.languages.entryFullTip}` : ""}</div>
        </div>
    </div>
    <div class="b3-card__actions b3-card__actions--right">
        ${active ? "" : `<button class="b3-button b3-button--outline" data-action="activate">${window.siyuan.languages.use}</button>`}
        <button class="block__icon block__icon--show ariaLabel" data-action="duplicate" data-position="north" aria-label="${window.siyuan.languages.duplicate}"><svg><use xlink:href="#iconCopy"></use></svg></button>
        ${builtin ? "" : `<button class="block__icon block__icon--show ariaLabel" data-action="export" data-position="north" aria-label="${window.siyuan.languages.export}"><svg><use xlink:href="#iconDownload"></use></svg></button>`}
        <button class="block__icon block__icon--show${active || builtin ? " fn__none" : " block__icon--warning"} ariaLabel" data-action="delete" data-position="north" aria-label="${window.siyuan.languages.delete}"><svg><use xlink:href="#iconTrashcan"></use></svg></button>
    </div>
</div>`;

const renderProfileCards = (root: HTMLElement) => {
    const container = root.querySelector<HTMLElement>("[data-type='entry-profiles']");
    if (!container) {
        return;
    }
    const config = window.siyuan.config.appearance.entryVisibility;
    const cards = [
        profileCard(ENTRY_PROFILE_SIMPLE, window.siyuan.languages.entrySimple, ENTRY_PROFILE_SIMPLE, true,
            config.active === ENTRY_PROFILE_SIMPLE),
        profileCard(ENTRY_PROFILE_FULL, window.siyuan.languages.entryFull, ENTRY_PROFILE_FULL, true,
            config.active === ENTRY_PROFILE_FULL),
        ...config.profiles.map((profile) => profileCard(profile.id, profile.name, profile.base, false,
            config.active === profile.id)),
    ];
    container.innerHTML = `<div class="b3-cards b3-cards--nowrap">${cards.join("")}</div>`;
};

const isEntryChecked = (profile: Config.IEntryVisibilityProfile, path: string, item: IEntryCatalogNode) =>
    typeof profile.entries[path] === "boolean"
        ? profile.entries[path]
        : profile.base === ENTRY_PROFILE_FULL || item.simple;

const getProfileEntryOrder = (profile: Config.IEntryVisibilityProfile, parentPath: string,
                              nodes = getEntryCatalogChildren(parentPath) || []) => {
    const defaultOrder = nodes.map((item) => item.key);
    return resolveEntryOrder(defaultOrder, profile.orders?.[parentPath],
        new Set(nodes.filter((item) => item.type === "separator").map((item) => item.key)));
};

const orderEntryNodes = (profile: Config.IEntryVisibilityProfile, parentPath: string,
                         nodes: IEntryCatalogNode[]) => {
    const indexes = new Map(getProfileEntryOrder(profile, parentPath, nodes).map((key, index) => [key, index]));
    return [...nodes].sort((itemA, itemB) =>
        (indexes.get(itemA.key) ?? Number.MAX_SAFE_INTEGER) - (indexes.get(itemB.key) ?? Number.MAX_SAFE_INTEGER));
};

const renderEntrySwitch = (profile: Config.IEntryVisibilityProfile, path: string, item: IEntryCatalogNode,
                           parentEnabled: boolean, readOnly: boolean) => `<input class="b3-switch" type="checkbox"
    aria-label="${escapeAttr(item.label())}" data-entry-path="${escapeAttr(path)}"${readOnly ? ' data-entry-readonly aria-disabled="true"' : ""}
    ${!parentEnabled && !readOnly ? " disabled" : ""}${isEntryChecked(profile, path, item) ? " checked" : ""}>`;

const renderEntryColumn = (profile: Config.IEntryVisibilityProfile, title: string, prefix: string,
                           nodes: IEntryCatalogNode[], depth: number, selectedPaths: string[],
                           parentEnabled: boolean, readOnly: boolean, sortable: boolean) => `<section class="config-entry-visibility__column"
    data-entry-column data-entry-depth="${depth}">
    <div class="config-entry-visibility__column-title" title="${escapeAttr(title)}">${escapeHtml(title)}</div>
    <div class="config-entry-visibility__column-list">
        ${nodes.map((item) => {
        const path = `${prefix}.${item.key}`;
        const draggable = sortable && parentEnabled;
        if (item.type === "separator") {
            return `<div class="config-entry-visibility__row config-entry-visibility__row--separator"
                data-entry-row data-entry-key="${escapeAttr(item.key)}" data-entry-parent="${escapeAttr(prefix)}">
                ${draggable ? '<span class="config-entry-visibility__drag" draggable="true"><svg><use xlink:href="#iconDrag"></use></svg></span>' : ""}
                <span class="config-entry-visibility__label">${window.siyuan.languages.entrySeparator}</span>
            </div>`;
        }
        const label = item.label();
        const hasChildren = Boolean(item.children?.length);
        const selected = selectedPaths[depth] === path;
        const rowTag = hasChildren ? "div" : "label";
        return `<${rowTag} class="config-entry-visibility__row config-entry-visibility__row--${hasChildren ? "navigable" : "toggleable"}${selected ? " config-entry-visibility__row--current" : ""}${parentEnabled ? "" : " config-entry-visibility__row--disabled"}"
            data-entry-row data-entry-key="${escapeAttr(item.key)}" data-entry-parent="${escapeAttr(prefix)}" data-entry-path-row="${escapeAttr(path)}"${hasChildren ? ` data-action="navigate-entry" data-entry-path="${escapeAttr(path)}" data-entry-depth="${depth}"` : ""}>
            ${draggable ? '<span class="config-entry-visibility__drag" draggable="true"><svg><use xlink:href="#iconDrag"></use></svg></span>' : ""}
            ${hasChildren ? `<button class="config-entry-visibility__navigate" data-action="navigate-entry"
                data-entry-path="${escapeAttr(path)}" data-entry-depth="${depth}" title="${escapeAttr(label)}">
                <span>${escapeHtml(label)}</span>
            </button>` : `<span class="config-entry-visibility__label" title="${escapeAttr(label)}">${escapeHtml(label)}</span>`}
            ${renderEntrySwitch(profile, path, item, parentEnabled, readOnly)}
            ${hasChildren ? `<button class="block__icon block__icon--show config-entry-visibility__arrow" data-action="navigate-entry"
                data-entry-path="${escapeAttr(path)}" data-entry-depth="${depth}" aria-label="${escapeAttr(window.siyuan.languages.expand)}">
                <svg><use xlink:href="#iconRight"></use></svg>
            </button>` : '<span class="config-entry-visibility__arrow-space"></span>'}
        </${rowTag}>`;
    }).join("")}
    </div>
</section>`;

const renderEntryColumns = (profile: Config.IEntryVisibilityProfile, sectionKey: string,
                            selectedPaths: string[], readOnly: boolean, visiblePaths?: Set<string>,
                            visibleSectionKeys?: Set<string>) => {
    const sections = visibleSectionKeys
        ? entryCatalog.filter((item) => visibleSectionKeys.has(item.key))
        : entryCatalog;
    const section = sections.find((item) => item.key === sectionKey) || sections[0] || entryCatalog[0];
    const locationColumn = `<section class="config-entry-visibility__column config-entry-visibility__column--locations" data-entry-column>
    <div class="config-entry-visibility__column-title">${window.siyuan.languages.position}</div>
    <div class="config-entry-visibility__column-list">
        ${sections.map((item) => `<button class="b3-list-item config-entry-visibility__location${item.key === section.key ? " config-entry-visibility__location--current" : ""}"
            data-action="select-entry-section" data-entry-section="${escapeAttr(item.key)}" title="${escapeAttr(item.label())}">
            <span class="b3-list-item__text">${escapeHtml(item.label())}</span>
            <svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg>
        </button>`).join("")}
    </div>
</section>`;
    const columns = [locationColumn];
    let nodes = section.children;
    let prefix = section.key;
    let title = section.label();
    let parentEnabled = true;
    let depth = 0;
    while (nodes.length > 0) {
        const orderedNodes = orderEntryNodes(profile, prefix, nodes);
        const columnNodes = visiblePaths
            ? orderedNodes.filter((item) => item.type !== "separator" && visiblePaths.has(`${prefix}.${item.key}`))
            : orderedNodes;
        if (columnNodes.length === 0) {
            break;
        }
        columns.push(renderEntryColumn(profile, title, prefix, columnNodes, depth, selectedPaths,
            parentEnabled, readOnly, !visiblePaths && section.sortable !== false && !readOnly));
        const selectedPath = selectedPaths[depth];
        const selectedNode = selectedPath && columnNodes.find((item) => `${prefix}.${item.key}` === selectedPath);
        if (!selectedNode?.children?.length) {
            break;
        }
        parentEnabled = parentEnabled && isEntryChecked(profile, selectedPath, selectedNode);
        nodes = selectedNode.children;
        prefix = selectedPath;
        title = selectedNode.label();
        depth++;
    }
    return `<div class="config-entry-visibility__columns">${columns.join("")}</div>`;
};

interface IEntrySearchResult {
    section: IEntryCatalogSection;
    item: IEntryCatalogNode;
    path: string;
    labels: string[];
}

const getEntrySearchResults = (query: string) => {
    const results: IEntrySearchResult[] = [];
    const visit = (section: IEntryCatalogSection, prefix: string, nodes: IEntryCatalogNode[], labels: string[]) => {
        nodes.forEach((item) => {
            if (item.type === "separator") {
                return;
            }
            const path = `${prefix}.${item.key}`;
            const itemLabels = [...labels, item.label()];
            if (itemLabels.join(" - ").toLowerCase().includes(query)) {
                results.push({section, item, path, labels: itemLabels});
            }
            if (item.children) {
                visit(section, path, item.children, itemLabels);
            }
        });
    };
    entryCatalog.forEach((section) => visit(section, section.key, section.children, [section.label()]));
    return results;
};

const getEntrySearchFilter = (query: string) => {
    const results = getEntrySearchResults(query);
    const visiblePaths = new Set<string>();
    const visibleSectionKeys = new Set<string>();
    results.forEach((result) => {
        visibleSectionKeys.add(result.section.key);
        getEntryCatalogPathChain(result.section.key, result.path).forEach((path) => visiblePaths.add(path));
    });
    return {results, visiblePaths, visibleSectionKeys};
};

const openProfileEditor = (root: HTMLElement, profileID?: string) => {
    const builtin = profileID === ENTRY_PROFILE_SIMPLE || profileID === ENTRY_PROFILE_FULL;
    const existing = profileID
        ? window.siyuan.config.appearance.entryVisibility.profiles.find((item) => item.id === profileID)
        : undefined;
    const draft: Config.IEntryVisibilityProfile = builtin
        ? {
            id: profileID,
            name: baseLabel(profileID),
            base: profileID,
            entries: createEntryProfileSnapshot(profileID),
            orders: createEntryOrderSnapshot(),
        }
        : existing
        ? JSON.parse(JSON.stringify(existing)) as Config.IEntryVisibilityProfile
        : createProfile(ENTRY_PROFILE_SIMPLE);
    draft.orders ||= createEntryOrderSnapshot();
    const initialJSON = JSON.stringify(draft);
    const creating = !builtin && !existing;
    const view = createEntryView(root);
    const body = view.querySelector<HTMLElement>(".b3-dialog__body");
    body.innerHTML = `<div class="b3-dialog__content config-entry-visibility__content">
    ${builtin ? "" : `<div class="config-group">
        <div class="config-title">${creating ? window.siyuan.languages.entryCreateProfile : escapeHtml(draft.name)}</div>
        <div class="config-items">
            <label class="fn__flex b3-label config-item config-wrap">
                <div class="fn__flex-1"><div class="config-name">${window.siyuan.languages.name}</div></div>
                <span class="fn__space"></span>
                <input class="b3-text-field fn__flex-center fn__size200" data-profile-field="name" value="${escapeAttr(draft.name)}">
            </label>
            <label class="fn__flex b3-label config-item config-wrap">
                <div class="fn__flex-1"><div class="config-name">${window.siyuan.languages.entryBasedOn}</div></div>
                <span class="fn__space"></span>
                ${creating ? `<select class="b3-select fn__flex-center fn__size200" data-profile-field="base">
                    <option value="simple"${draft.base === ENTRY_PROFILE_SIMPLE ? " selected" : ""}>${window.siyuan.languages.entrySimple}</option>
                    <option value="full"${draft.base === ENTRY_PROFILE_FULL ? " selected" : ""}>${window.siyuan.languages.entryFull}</option>
                    <option value="current">${window.siyuan.languages.current}</option>
                </select>` : `<div class="fn__size200">${baseLabel(draft.base)}</div>`}
            </label>
        </div>
    </div>`}
    <div class="config-group">
        ${builtin ? `<div class="config-title">${escapeHtml(draft.name)}</div>` : ""}
        <div class="fn__flex">
            <input class="b3-text-field fn__flex-1" data-type="entry-search" placeholder="${escapeAttr(window.siyuan.languages.searchPlaceholder)}">
            ${builtin ? "" : `<span class="fn__space"></span>
            <button class="b3-button b3-button--outline" data-action="restore">${window.siyuan.languages.entryRestoreBase.replace("${x}", baseLabel(draft.base))}</button>`}
        </div>
    </div>
    <div class="config-entry-visibility__browser" data-type="entry-browser"></div>
</div>
<div class="b3-dialog__action">
    ${builtin ? `<button class="b3-button b3-button--text" data-action="cancel">${window.siyuan.languages.close}</button>` : `<button class="b3-button b3-button--cancel" data-action="cancel">${window.siyuan.languages.cancel}</button>
    <span class="fn__space"></span>
    <button class="b3-button b3-button--text" data-action="confirm">${window.siyuan.languages.confirm}</button>`}
</div>`;
    const browser = view.querySelector<HTMLElement>("[data-type='entry-browser']");
    const searchInput = view.querySelector<HTMLInputElement>("[data-type='entry-search']");
    const restoreButton = view.querySelector<HTMLButtonElement>("[data-action='restore']");
    let selectedSectionKey = entryCatalog[0].key;
    let selectedPaths: string[] = [];
    let previousQuery = "";
    let dragging: {parentPath: string; sourceKey: string; order?: string[]} | undefined;
    const clearDropTarget = () => {
        browser.querySelectorAll(".config-entry-visibility__row--drop-before, .config-entry-visibility__row--drop-after")
            .forEach((item) => item.classList.remove("config-entry-visibility__row--drop-before",
                "config-entry-visibility__row--drop-after"));
    };
    const updateRestoreButton = () => {
        if (restoreButton) {
            restoreButton.textContent = window.siyuan.languages.entryRestoreBase.replace("${x}", baseLabel(draft.base));
        }
    };
    const renderBrowser = (scrollToEnd = false, resetEntryColumns = false, revealSelection = false) => {
        const oldColumns = Array.from(browser.querySelectorAll<HTMLElement>("[data-entry-column]"));
        const oldScrollTops = oldColumns.map((column) => column.querySelector<HTMLElement>(
            ".config-entry-visibility__column-list")?.scrollTop || 0);
        const oldColumnsContainer = browser.querySelector<HTMLElement>(".config-entry-visibility__columns");
        const oldScrollLeft = oldColumnsContainer?.scrollLeft || 0;
        const query = searchInput.value.trim().toLowerCase();
        const queryChanged = query !== previousQuery;
        const filter = query ? getEntrySearchFilter(query) : undefined;
        if (filter && filter.results.length === 0) {
            browser.innerHTML = `<div class="b3-list--empty">${window.siyuan.languages.emptyContent}</div>`;
            previousQuery = query;
            return;
        }
        if (filter && queryChanged) {
            const target = filter.results.find((item) => item.section.key === selectedSectionKey) || filter.results[0];
            selectedSectionKey = target.section.key;
            selectedPaths = getEntryCatalogPathChain(target.section.key, target.path);
            scrollToEnd = true;
            resetEntryColumns = true;
            revealSelection = true;
        }
        browser.innerHTML = renderEntryColumns(draft, selectedSectionKey, selectedPaths, builtin,
            filter?.visiblePaths, filter?.visibleSectionKeys);
        previousQuery = query;
        const columnsContainer = browser.querySelector<HTMLElement>(".config-entry-visibility__columns");
        const columns = Array.from(browser.querySelectorAll<HTMLElement>("[data-entry-column]"));
        columns.forEach((column, index) => {
            const list = column.querySelector<HTMLElement>(".config-entry-visibility__column-list");
            if (list) {
                list.scrollTop = resetEntryColumns && index > 0 ? 0 : oldScrollTops[index] || 0;
                if (revealSelection) {
                    const current = list.querySelector<HTMLElement>(
                        ".config-entry-visibility__location--current, .config-entry-visibility__row--current");
                    if (current) {
                        list.scrollTop = Math.max(0, current.offsetTop - list.clientHeight / 2);
                    }
                }
            }
        });
        if (columnsContainer) {
            columnsContainer.scrollLeft = scrollToEnd ? columnsContainer.scrollWidth : oldScrollLeft;
        }
    };
    const leaveEditor = () => removeEntryView(root, view);
    const closeEditor = () => {
        if (JSON.stringify(draft) !== initialJSON) {
            confirmDialog(window.siyuan.languages.confirm, window.siyuan.languages.discardUnsavedChanges, leaveEditor);
            return;
        }
        leaveEditor();
    };
    renderBrowser();
    searchInput.addEventListener("input", () => renderBrowser());
    browser.addEventListener("dragstart", (event: DragEvent) => {
        if (builtin || searchInput.value.trim()) {
            event.preventDefault();
            return;
        }
        const handle = (event.target as Element).closest<HTMLElement>(".config-entry-visibility__drag");
        const row = handle?.closest<HTMLElement>("[data-entry-row]");
        if (!row?.dataset.entryParent || !row.dataset.entryKey) {
            event.preventDefault();
            return;
        }
        dragging = {parentPath: row.dataset.entryParent, sourceKey: row.dataset.entryKey};
        row.classList.add("config-entry-visibility__row--dragging");
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", row.dataset.entryKey);
    });
    browser.addEventListener("dragover", (event: DragEvent) => {
        if (!dragging) {
            return;
        }
        const row = (event.target as Element).closest<HTMLElement>("[data-entry-row]");
        if (!row || row.dataset.entryParent !== dragging.parentPath || !row.dataset.entryKey) {
            clearDropTarget();
            dragging.order = undefined;
            return;
        }
        const nodes = getEntryCatalogChildren(dragging.parentPath) || [];
        const order = getProfileEntryOrder(draft, dragging.parentPath, nodes);
        const after = event.clientY >= row.getBoundingClientRect().top + row.offsetHeight / 2;
        const movedOrder = moveEntryOrder(order, dragging.sourceKey, row.dataset.entryKey, after,
            new Set(nodes.filter((item) => item.type === "separator").map((item) => item.key)));
        clearDropTarget();
        dragging.order = movedOrder;
        if (!movedOrder) {
            return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        row.classList.add(`config-entry-visibility__row--drop-${after ? "after" : "before"}`);
    });
    browser.addEventListener("drop", (event: DragEvent) => {
        if (!dragging?.order) {
            return;
        }
        event.preventDefault();
        draft.orders ||= {};
        draft.orders[dragging.parentPath] = dragging.order;
        dragging = undefined;
        renderBrowser();
    });
    browser.addEventListener("dragend", () => {
        dragging = undefined;
        clearDropTarget();
        browser.querySelector(".config-entry-visibility__row--dragging")?.classList.remove(
            "config-entry-visibility__row--dragging");
    });
    view.addEventListener("input", (event) => {
        if (builtin) {
            return;
        }
        const target = event.target as HTMLInputElement;
        if (target.dataset.profileField === "name") {
            draft.name = target.value;
        }
    });
    view.addEventListener("change", (event) => {
        if (builtin) {
            return;
        }
        const target = event.target as HTMLInputElement | HTMLSelectElement;
        if (target.matches("[data-entry-path]")) {
            draft.entries[(target as HTMLInputElement).dataset.entryPath] = (target as HTMLInputElement).checked;
            renderBrowser();
            return;
        }
        if (target.dataset.profileField !== "base") {
            return;
        }
        const selection = target.value;
        draft.base = selection === "current" ? getCurrentBase() : selection as Config.TEntryVisibilityBase;
        draft.entries = createEntryProfileSnapshot(draft.base);
        draft.orders = createEntryOrderSnapshot(selection === "current");
        if (selection === "current") {
            getEntryPaths().forEach((path) => {
                draft.entries[path] = isEntryVisible(path);
            });
        }
        updateRestoreButton();
        renderBrowser();
    });
    view.addEventListener("click", (event) => {
        if ((event.target as Element).closest(".config-entry-visibility__drag")) {
            event.preventDefault();
            return;
        }
        const entrySwitch = (event.target as HTMLElement).closest<HTMLInputElement>("input[data-entry-path]");
        if (entrySwitch) {
            if (entrySwitch.hasAttribute("data-entry-readonly")) {
                event.preventDefault();
                showMessage(window.siyuan.languages.entryBuiltinReadonlyTip);
            }
            return;
        }
        const actionElement = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
        const action = actionElement?.dataset.action;
        if (action === "back" || action === "cancel") {
            closeEditor();
        } else if (action === "select-entry-section") {
            selectedSectionKey = actionElement.dataset.entrySection;
            selectedPaths = [];
            renderBrowser(true, true);
        } else if (action === "navigate-entry") {
            const depth = Number(actionElement.dataset.entryDepth);
            selectedPaths = selectedPaths.slice(0, depth);
            selectedPaths[depth] = actionElement.dataset.entryPath;
            renderBrowser(true);
        } else if (!builtin && action === "restore") {
            const restoreTarget = baseLabel(draft.base);
            confirmDialog(window.siyuan.languages.entryRestoreBase.replace("${x}", restoreTarget),
                window.siyuan.languages.entryRestoreBaseConfirm.replace("${x}", restoreTarget), () => {
                draft.entries = createEntryProfileSnapshot(draft.base);
                draft.orders = createEntryOrderSnapshot();
                renderBrowser();
            });
        } else if (!builtin && action === "confirm") {
            const nameInput = view.querySelector<HTMLInputElement>("[data-profile-field='name']");
            const name = draft.name.trim();
            if (!name) {
                nameInput.focus();
                return;
            }
            const config = cloneConfig();
            draft.name = uniqueName(name, config.profiles.filter((item) => item.id !== existing?.id));
            if (existing) {
                config.profiles = config.profiles.map((item) => item.id === existing.id ? draft : item);
            } else {
                config.profiles.push(draft);
            }
            saveEntryVisibility(config);
            renderProfileCards(root);
            leaveEditor();
        }
    });
    const nameInput = view.querySelector<HTMLInputElement>("[data-profile-field='name']");
    if (creating && nameInput) {
        nameInput.select();
    }
};

const importProfiles = async (root: HTMLElement, file: File) => {
    try {
        const data = JSON.parse(await file.text()) as TImportFile;
        if (data.version !== 1 && data.version !== ENTRY_VISIBILITY_VERSION) {
            throw new Error("unsupported version");
        }
        let imported: Config.IEntryVisibilityProfile[];
        if (data.type === "siyuan-entry-profile" && data.profile) {
            imported = [data.profile];
        } else if (data.type === "siyuan-entry-profile-bundle" && Array.isArray(data.profiles)) {
            imported = data.profiles;
        } else {
            throw new Error("invalid type");
        }
        const config = cloneConfig();
        let importedCount = 0;
        imported.forEach((item) => {
            if (!item || typeof item.name !== "string" || !item.name.trim() || !item.entries ||
                Array.isArray(item.entries) ||
                (item.base !== ENTRY_PROFILE_SIMPLE && item.base !== ENTRY_PROFILE_FULL)) {
                return;
            }
            const entries = Object.entries(item.entries).reduce<Record<string, boolean>>((result, [path, visible]) => {
                if (typeof visible === "boolean") {
                    result[path] = visible;
                }
                return result;
            }, {});
            const orders = item.orders && !Array.isArray(item.orders)
                ? Object.entries(item.orders).reduce<Record<string, string[]>>((result, [path, order]) => {
                    if (Array.isArray(order)) {
                        result[path] = order.filter((key): key is string => typeof key === "string");
                    }
                    return result;
                }, {})
                : createEntryOrderSnapshot();
            config.profiles.push({
                id: genUUID(),
                name: uniqueName(item.name, config.profiles),
                base: item.base,
                entries,
                orders,
            });
            importedCount++;
        });
        if (imported.length > 0 && importedCount === 0) {
            throw new Error("invalid profiles");
        }
        saveEntryVisibility(config);
        renderProfileCards(root);
        showMessage(window.siyuan.languages.imported);
    } catch (error) {
        console.warn("import entry visibility profile failed", error);
        showMessage(window.siyuan.languages.entryImportInvalid, 6000, "error");
    }
};

export const genEntryVisibilityHtml = () => `<div class="b3-label config-item" data-type="entry-visibility">
    <div class="fn__flex config-wrap">
        <div><div class="config-name">${window.siyuan.languages.entryVisibility}</div><div class="b3-label__text">${window.siyuan.languages.entryVisibilityTip}</div></div>
        <span class="fn__space fn__flex-1"></span>
        <button class="b3-button b3-button--outline" data-action="import"><svg class="b3-button__icon"><use xlink:href="#iconUpload"></use></svg>${window.siyuan.languages.import}</button>
        <span class="fn__space"></span>
        <button class="b3-button b3-button--outline" data-action="export-all"><svg class="b3-button__icon"><use xlink:href="#iconDownload"></use></svg>${window.siyuan.languages.export}</button>
        <span class="fn__space"></span>
        <button class="b3-button b3-button--outline" data-action="create"><svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>${window.siyuan.languages.entryCreateProfile}</button>
        <input class="fn__none" data-type="entry-import" type="file" accept="application/json,.json">
    </div>
    <div class="fn__hr"></div>
    <div data-type="entry-profiles"></div>
</div>`;

export const mountEntryVisibility = (root: HTMLElement) => {
    renderProfileCards(root);
    root.querySelector("[data-action='create']")?.addEventListener("click", () => openProfileEditor(root));
    root.querySelector("[data-action='export-all']")?.addEventListener("click", exportBundle);
    const fileInput = root.querySelector<HTMLInputElement>("[data-type='entry-import']");
    root.querySelector("[data-action='import']")?.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
        const file = fileInput.files?.[0];
        fileInput.value = "";
        if (file) {
            void importProfiles(root, file);
        }
    });
    root.querySelector("[data-type='entry-profiles']")?.addEventListener("click", (event) => {
        const card = (event.target as Element).closest<HTMLElement>("[data-profile-id]");
        const action = (event.target as Element).closest<HTMLElement>("[data-action]")?.dataset.action;
        if (!card || !action) {
            return;
        }
        const id = card.dataset.profileId;
        const config = cloneConfig();
        const profile = config.profiles.find((item) => item.id === id);
        if (action === "activate") {
            config.active = id;
            saveEntryVisibility(config);
            renderProfileCards(root);
        } else if (action === "edit" || action === "view") {
            openProfileEditor(root, id);
        } else if (action === "duplicate") {
            const copy = profile ? duplicateProfile(profile) : createProfile(id as Config.TEntryVisibilityBase, false,
                `${baseLabel(id as Config.TEntryVisibilityBase)} ${window.siyuan.languages.duplicate}`);
            config.profiles.push(copy);
            saveEntryVisibility(config);
            renderProfileCards(root);
        } else if (action === "export" && profile) {
            exportProfile(profile);
        } else if (action === "delete" && profile && config.active !== profile.id) {
            confirmDialog(window.siyuan.languages.deleteOpConfirm,
                window.siyuan.languages.confirmDeleteTip.replace("${x}", escapeHtml(profile.name)), () => {
                    const latest = cloneConfig();
                    latest.profiles = latest.profiles.filter((item) => item.id !== profile.id);
                    saveEntryVisibility(latest);
                    renderProfileCards(root);
                }, undefined, true);
        }
    });
};
