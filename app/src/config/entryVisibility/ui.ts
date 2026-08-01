import {Dialog} from "../../dialog";
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

const promptName = (title: string, value: string, callback: (name: string) => void) => {
    const dialog = new Dialog({
        title,
        width: "420px",
        content: `<div class="b3-dialog__content"><input class="b3-text-field fn__block" value="${escapeAttr(value)}"></div>
<div class="b3-dialog__action"><button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div><button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button></div>`,
    });
    const input = dialog.element.querySelector<HTMLInputElement>("input");
    const submit = () => {
        const name = input.value.trim();
        if (!name) {
            input.focus();
            return;
        }
        callback(name);
        dialog.destroy();
    };
    dialog.element.querySelector(".b3-button--cancel").addEventListener("click", () => dialog.destroy());
    dialog.element.querySelector(".b3-button--text").addEventListener("click", submit);
    input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            submit();
        }
    });
    input.select();
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

const profileCard = (
    id: string,
    name: string,
    base: Config.TEntryVisibilityBase,
    builtin: boolean,
    active: boolean,
) => `<div class="b3-card${active ? " b3-card--current" : ""}" data-profile-id="${escapeAttr(id)}">
    <div class="b3-card__img"><span><svg class="b3-card__icon"><use xlink:href="#${builtin ? "iconSettings" : "iconMenu"}"></use></svg></span></div>
    <div class="fn__flex-1 fn__flex-column">
        <div class="b3-card__info b3-card__info--left fn__flex-1">
            <div class="fn__ellipsis config-name">${escapeHtml(name)}</div>
            <div class="b3-card__desc">${builtin ? window.siyuan.languages.entryBuiltin : window.siyuan.languages.entryCustom} · ${window.siyuan.languages.entryBasedOn} ${baseLabel(base)}${active ? ` · ${window.siyuan.languages.current}` : ""}</div>
        </div>
    </div>
    <div class="b3-card__actions b3-card__actions--right">
        ${active ? "" : `<button class="b3-button b3-button--outline" data-action="activate">${window.siyuan.languages.use}</button>`}
        <button class="block__icon block__icon--show ariaLabel" data-action="edit" data-position="north" aria-label="${window.siyuan.languages.edit}"><svg><use xlink:href="#iconEdit"></use></svg></button>
        ${builtin ? "" : `<button class="block__icon block__icon--show ariaLabel" data-action="rename" data-position="north" aria-label="${window.siyuan.languages.rename}"><svg><use xlink:href="#iconEdit"></use></svg></button>`}
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

const renderEntryNode = (profile: Config.IEntryVisibilityProfile, prefix: string, item: IEntryCatalogNode,
                         parents: string[] = []): string => {
    const path = `${prefix}.${item.key}`;
    const label = item.label();
    const displayLabel = [...parents, label].join(" - ");
    const checked = typeof profile.entries[path] === "boolean"
        ? profile.entries[path]
        : profile.base === ENTRY_PROFILE_FULL || item.simple;
    return `<div data-entry-row data-search="${escapeAttr(displayLabel.toLowerCase())}">
    <label class="b3-label fn__flex" style="border-bottom:0">
        <span class="fn__flex-1">${escapeHtml(displayLabel)}</span>
        <input class="b3-switch" type="checkbox" data-entry-path="${escapeAttr(path)}"${checked ? " checked" : ""}>
    </label>
    ${item.children?.map((child) => renderEntryNode(profile, path, child, [...parents, label])).join("") || ""}
</div>`;
};

const openProfileEditor = (root: HTMLElement, profileID: string) => {
    let config = cloneConfig();
    let profile = config.profiles.find((item) => item.id === profileID);
    if (!profile) {
        const base = profileID === ENTRY_PROFILE_SIMPLE ? ENTRY_PROFILE_SIMPLE : ENTRY_PROFILE_FULL;
        profile = createProfile(base, false, `${baseLabel(base)} ${window.siyuan.languages.duplicate}`);
        config.profiles.push(profile);
        config.active = profile.id;
        saveEntryVisibility(config);
        renderProfileCards(root);
    }
    const dialog = new Dialog({
        title: `${window.siyuan.languages.entryVisibility} - ${escapeHtml(profile.name)}`,
        width: "720px",
        height: "80vh",
        content: `<div class="b3-dialog__content fn__flex-column" style="height:100%;box-sizing:border-box">
    <div class="fn__flex"><input class="b3-text-field fn__flex-1" data-type="entry-search" placeholder="${escapeAttr(window.siyuan.languages.searchPlaceholder)}"><span class="fn__space"></span><button class="b3-button b3-button--outline" data-action="restore">${window.siyuan.languages.entryRestoreBase}</button></div>
    <div class="b3-label__text" style="margin:8px 0">${window.siyuan.languages.entryBasedOn} ${baseLabel(profile.base)}</div>
    <div class="fn__flex-1" data-type="entry-sections" style="overflow:auto"></div>
</div>`,
    });
    const sections = dialog.element.querySelector<HTMLElement>("[data-type='entry-sections']");
    sections.innerHTML = entryCatalog.map((section) => `<div class="b3-card fn__flex-column" data-entry-section style="cursor:default;margin-bottom:12px">
    <div class="config-title" style="padding:16px 16px 8px">${escapeHtml(section.label())}</div>
    <div>${section.children.map((item) => renderEntryNode(profile, section.key, item)).join("")}</div>
</div>`).join("");
    sections.addEventListener("change", (event) => {
        const input = (event.target as Element).closest<HTMLInputElement>("[data-entry-path]");
        if (!input) {
            return;
        }
        config = cloneConfig();
        profile = config.profiles.find((item) => item.id === profile.id);
        if (!profile) {
            return;
        }
        profile.entries[input.dataset.entryPath] = input.checked;
        saveEntryVisibility(config);
    });
    dialog.element.querySelector<HTMLInputElement>("[data-type='entry-search']").addEventListener("input", (event) => {
        const value = (event.currentTarget as HTMLInputElement).value.trim().toLowerCase();
        const rows = Array.from(sections.querySelectorAll<HTMLElement>("[data-entry-row]")).reverse();
        rows.forEach((row) => {
            const childMatches = row.querySelector("[data-entry-row]:not(.fn__none)");
            row.classList.toggle("fn__none", Boolean(value) && !row.dataset.search.includes(value) && !childMatches);
        });
        sections.querySelectorAll<HTMLElement>("[data-entry-section]").forEach((section) => {
            section.classList.toggle("fn__none", !section.querySelector("[data-entry-row]:not(.fn__none)"));
        });
    });
    dialog.element.querySelector("[data-action='restore']").addEventListener("click", () => {
        confirmDialog(window.siyuan.languages.entryRestoreBase, window.siyuan.languages.entryRestoreBaseConfirm, () => {
            config = cloneConfig();
            profile = config.profiles.find((item) => item.id === profile.id);
            if (!profile) {
                return;
            }
            profile.entries = {...profile.entries, ...createEntryProfileSnapshot(profile.base)};
            saveEntryVisibility(config);
            dialog.destroy();
            openProfileEditor(root, profile.id);
        });
    });
};

const openCreateDialog = (root: HTMLElement) => {
    const dialog = new Dialog({
        title: window.siyuan.languages.entryCreateProfile,
        width: "420px",
        content: `<div class="b3-dialog__content">
    <label class="b3-label">${window.siyuan.languages.name}<input class="b3-text-field fn__block" data-type="name" value="${escapeAttr(uniqueName(window.siyuan.languages.entryCustomProfile))}" style="margin-top:8px"></label>
    <label class="b3-label">${window.siyuan.languages.entryBasedOn}<select class="b3-select fn__block" data-type="base" style="margin-top:8px"><option value="simple">${window.siyuan.languages.entrySimple}</option><option value="full">${window.siyuan.languages.entryFull}</option><option value="current">${window.siyuan.languages.current}</option></select></label>
</div><div class="b3-dialog__action"><button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div><button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button></div>`,
    });
    dialog.element.querySelector(".b3-button--cancel").addEventListener("click", () => dialog.destroy());
    dialog.element.querySelector(".b3-button--text").addEventListener("click", () => {
        const name = dialog.element.querySelector<HTMLInputElement>("[data-type='name']").value.trim();
        if (!name) {
            return;
        }
        const selection = dialog.element.querySelector<HTMLSelectElement>("[data-type='base']").value;
        const config = cloneConfig();
        const profile = createProfile(selection === "current" ? getCurrentBase() : selection as Config.TEntryVisibilityBase,
            selection === "current", name);
        config.profiles.push(profile);
        saveEntryVisibility(config);
        renderProfileCards(root);
        dialog.destroy();
        openProfileEditor(root, profile.id);
    });
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
    <div class="fn__flex b3-label config-item config-wrap b3-label--noborder">
        <div><div class="config-name">${window.siyuan.languages.entryVisibility}</div><div class="b3-label__text">${window.siyuan.languages.entryVisibilityTip}</div></div>
        <span class="fn__space fn__flex-1"></span>
        <button class="b3-button b3-button--outline" data-action="import"><svg class="b3-button__icon"><use xlink:href="#iconUpload"></use></svg>${window.siyuan.languages.import}</button>
        <span class="fn__space"></span>
        <button class="b3-button b3-button--outline" data-action="export-all"><svg class="b3-button__icon"><use xlink:href="#iconDownload"></use></svg>${window.siyuan.languages.entryExportAll}</button>
        <span class="fn__space"></span>
        <button class="b3-button b3-button--outline" data-action="create"><svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>${window.siyuan.languages.entryCreateProfile}</button>
        <input class="fn__none" data-type="entry-import" type="file" accept="application/json,.json">
    </div>
    <div class="fn__hr"></div>
    <div data-type="entry-profiles"></div>
</div>`;

export const mountEntryVisibility = (root: HTMLElement) => {
    renderProfileCards(root);
    root.querySelector("[data-action='create']")?.addEventListener("click", () => openCreateDialog(root));
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
        } else if (action === "rename" && profile) {
            promptName(window.siyuan.languages.rename, profile.name, (name) => {
                const latest = cloneConfig();
                const renamed = latest.profiles.find((item) => item.id === profile.id);
                if (renamed) {
                    renamed.name = uniqueName(name, latest.profiles.filter((item) => item.id !== profile.id));
                    saveEntryVisibility(latest);
                    renderProfileCards(root);
                }
            });
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
