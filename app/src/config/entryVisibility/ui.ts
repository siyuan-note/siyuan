import {confirmDialog} from "../../dialog/confirmDialog";
import {showMessage} from "../../dialog/message";
import {escapeAttr, escapeHtml} from "../../util/escape";
import {genUUID} from "../../util/genID";
import {entryCatalog, getEntryPaths, IEntryCatalogNode} from "./catalog";
import {
    createEntryProfileSnapshot,
    ENTRY_PROFILE_FULL,
    ENTRY_PROFILE_SIMPLE,
    ENTRY_VISIBILITY_VERSION,
    getActiveEntryProfile,
    isEntryVisible,
    saveEntryVisibility,
} from "./runtime";

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
    };
    if (current) {
        getEntryPaths().forEach((path) => {
            profile.entries[path] = isEntryVisible(path);
        });
    }
    return profile;
};

const duplicateProfile = (profile: Config.IEntryVisibilityProfile) => ({
    ...JSON.parse(JSON.stringify(profile)) as Config.IEntryVisibilityProfile,
    id: genUUID(),
    name: uniqueName(`${profile.name} ${window.siyuan.languages.duplicate}`),
});

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
) => `<div class="b3-card${active ? " b3-card--current" : ""}" data-profile-id="${escapeAttr(id)}"${builtin ? "" : ' data-action="edit"'}>
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

const renderEntryRow = (profile: Config.IEntryVisibilityProfile, prefix: string, item: IEntryCatalogNode,
                        entryLocation: string, groupHeader = false, parentPath?: string): string => {
    const path = `${prefix}.${item.key}`;
    const label = item.label();
    const checked = typeof profile.entries[path] === "boolean"
        ? profile.entries[path]
        : profile.base === ENTRY_PROFILE_FULL || item.simple;
    return `<label class="b3-label config-item config-wrap fn__flex${groupHeader ? " config-entry-visibility__group-title" : ""}" data-entry-row${groupHeader ? " data-entry-group-header" : ""} data-search="${escapeAttr(entryLocation.toLowerCase())}">
    <span class="fn__flex-1">
        <span${groupHeader ? ' class="config-name"' : ""}>${escapeHtml(label)}</span>
        ${groupHeader ? `<span class="b3-label__text">${window.siyuan.languages.entrySubmenu}</span>` : ""}
        <span class="b3-label__text fn__none" data-entry-location>${escapeHtml(entryLocation)}</span>
    </span>
    <input class="b3-switch" type="checkbox" data-entry-path="${escapeAttr(path)}"${parentPath ? ` data-entry-parent-path="${escapeAttr(parentPath)}"` : ""}${checked ? " checked" : ""}>
</label>`;
};

const renderSubmenuGroups = (profile: Config.IEntryVisibilityProfile, prefix: string, item: IEntryCatalogNode,
                             sectionLabel: string, parents: string[] = [], parentPath?: string): string => {
    const path = `${prefix}.${item.key}`;
    const label = item.label();
    const locationParts = [sectionLabel, ...parents, label];
    const directChildren = item.children?.filter((child) => !child.children) || [];
    const nestedChildren = item.children?.filter((child) => child.children) || [];
    const group = `<div class="config-items" data-entry-group>
    ${renderEntryRow(profile, prefix, item, locationParts.join(" - "), true, parentPath)}
    ${directChildren.map((child) => renderEntryRow(profile, path, child,
        [...locationParts, child.label()].join(" - "), false, path)).join("")}
</div>`;
    return `${group}${nestedChildren.map((child) => renderSubmenuGroups(profile, path, child, sectionLabel,
        [...parents, label], path)).join("")}`;
};

const updateEntryDependencies = (sections: HTMLElement) => {
    const switches = Array.from(sections.querySelectorAll<HTMLInputElement>("[data-entry-path]"));
    const switchesByPath = new Map(switches.map((item) => [item.dataset.entryPath, item]));
    switches.forEach((item) => {
        const parentPath = item.dataset.entryParentPath;
        if (!parentPath) {
            item.disabled = false;
            return;
        }
        const parent = switchesByPath.get(parentPath);
        item.disabled = !parent || parent.disabled || !parent.checked;
    });
};

const renderEntryGroups = (profile: Config.IEntryVisibilityProfile, section: typeof entryCatalog[number]) => {
    const sectionLabel = section.label();
    const mainMenu = window.siyuan.languages.mainMenu;
    const groups: string[] = [];
    let mainItems: IEntryCatalogNode[] = [];
    const flushMainItems = () => {
        if (mainItems.length === 0) {
            return;
        }
        groups.push(`<div class="config-items" data-entry-group>
    <div class="b3-label config-item config-wrap config-entry-visibility__group-title">
        <div class="config-name">${mainMenu}</div>
    </div>
    ${mainItems.map((item) => renderEntryRow(profile, section.key, item,
        [sectionLabel, mainMenu, item.label()].join(" - "))).join("")}
</div>`);
        mainItems = [];
    };
    section.children.forEach((item) => {
        if (item.children) {
            flushMainItems();
            groups.push(renderSubmenuGroups(profile, section.key, item, sectionLabel));
        } else {
            mainItems.push(item);
        }
    });
    flushMainItems();
    return groups.join("");
};

const openProfileEditor = (root: HTMLElement, profileID?: string) => {
    const existing = profileID
        ? window.siyuan.config.appearance.entryVisibility.profiles.find((item) => item.id === profileID)
        : undefined;
    const draft = existing
        ? JSON.parse(JSON.stringify(existing)) as Config.IEntryVisibilityProfile
        : createProfile(ENTRY_PROFILE_SIMPLE);
    const initialJSON = JSON.stringify(draft);
    const creating = !existing;
    const view = createEntryView(root);
    const body = view.querySelector<HTMLElement>(".b3-dialog__body");
    body.innerHTML = `<div class="b3-dialog__content" style="height:100%;box-sizing:border-box;overflow:auto;padding:0">
    <div class="config-group">
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
    </div>
    <div class="config-group">
        <div class="fn__flex">
            <input class="b3-text-field fn__flex-1" data-type="entry-search" placeholder="${escapeAttr(window.siyuan.languages.searchPlaceholder)}">
            <span class="fn__space"></span>
            <button class="b3-button b3-button--outline" data-action="restore">${window.siyuan.languages.entryRestoreBase.replace("${x}", baseLabel(draft.base))}</button>
        </div>
    </div>
    <div data-type="entry-sections"></div>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel" data-action="cancel">${window.siyuan.languages.cancel}</button>
    <span class="fn__space"></span>
    <button class="b3-button b3-button--text" data-action="confirm">${window.siyuan.languages.confirm}</button>
</div>`;
    const sections = view.querySelector<HTMLElement>("[data-type='entry-sections']");
    const searchInput = view.querySelector<HTMLInputElement>("[data-type='entry-search']");
    const restoreButton = view.querySelector<HTMLButtonElement>("[data-action='restore']");
    const updateRestoreButton = () => {
        restoreButton.textContent = window.siyuan.languages.entryRestoreBase.replace("${x}", baseLabel(draft.base));
    };
    const renderSections = () => {
        sections.innerHTML = entryCatalog.map((section) => `<div class="config-group" data-entry-section>
    <div class="config-title">${escapeHtml(section.label())}</div>
    <div class="config-entry-visibility__groups">${renderEntryGroups(draft, section)}</div>
</div>`).join("");
        updateEntryDependencies(sections);
    };
    const filterSections = () => {
        const value = searchInput.value.trim().toLowerCase();
        sections.querySelectorAll<HTMLElement>("[data-entry-location]").forEach((locationElement) => {
            locationElement.classList.toggle("fn__none", !value);
        });
        sections.querySelectorAll<HTMLElement>("[data-entry-group]").forEach((group) => {
            const rows = Array.from(group.querySelectorAll<HTMLElement>("[data-entry-row]"));
            const matches = rows.map((row) => !value || row.dataset.search.includes(value));
            const groupVisible = matches.some(Boolean);
            group.classList.toggle("fn__none", !groupVisible);
            rows.forEach((row, index) => {
                row.classList.toggle("fn__none", !groupVisible ||
                    (Boolean(value) && !matches[index] && !row.hasAttribute("data-entry-group-header")));
            });
        });
        sections.querySelectorAll<HTMLElement>("[data-entry-section]").forEach((section) => {
            section.classList.toggle("fn__none", !section.querySelector("[data-entry-group]:not(.fn__none)"));
        });
    };
    const leaveEditor = () => removeEntryView(root, view);
    const closeEditor = () => {
        if (JSON.stringify(draft) !== initialJSON) {
            confirmDialog(window.siyuan.languages.confirm, window.siyuan.languages.discardUnsavedChanges, leaveEditor);
            return;
        }
        leaveEditor();
    };
    renderSections();
    searchInput.addEventListener("input", filterSections);
    view.addEventListener("input", (event) => {
        const target = event.target as HTMLInputElement;
        if (target.dataset.profileField === "name") {
            draft.name = target.value;
        }
    });
    view.addEventListener("change", (event) => {
        const target = event.target as HTMLInputElement | HTMLSelectElement;
        if (target.matches("[data-entry-path]")) {
            draft.entries[(target as HTMLInputElement).dataset.entryPath] = (target as HTMLInputElement).checked;
            updateEntryDependencies(sections);
            return;
        }
        if (target.dataset.profileField !== "base") {
            return;
        }
        const selection = target.value;
        draft.base = selection === "current" ? getCurrentBase() : selection as Config.TEntryVisibilityBase;
        draft.entries = createEntryProfileSnapshot(draft.base);
        if (selection === "current") {
            getEntryPaths().forEach((path) => {
                draft.entries[path] = isEntryVisible(path);
            });
        }
        updateRestoreButton();
        renderSections();
        filterSections();
    });
    view.addEventListener("click", (event) => {
        const action = (event.target as HTMLElement).closest<HTMLElement>("[data-action]")?.dataset.action;
        if (action === "back" || action === "cancel") {
            closeEditor();
        } else if (action === "restore") {
            const restoreTarget = baseLabel(draft.base);
            confirmDialog(window.siyuan.languages.entryRestoreBase.replace("${x}", restoreTarget),
                window.siyuan.languages.entryRestoreBaseConfirm.replace("${x}", restoreTarget), () => {
                draft.entries = createEntryProfileSnapshot(draft.base);
                renderSections();
                filterSections();
            });
        } else if (action === "confirm") {
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
    if (creating) {
        nameInput.select();
    }
};

const importProfiles = async (root: HTMLElement, file: File) => {
    try {
        const data = JSON.parse(await file.text()) as TImportFile;
        if (data.version !== ENTRY_VISIBILITY_VERSION) {
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
            config.profiles.push({
                id: genUUID(),
                name: uniqueName(item.name, config.profiles),
                base: item.base,
                entries,
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
        } else if (action === "edit") {
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
