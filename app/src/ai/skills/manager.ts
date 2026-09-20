import {Dialog} from "../../dialog";
import {openInputDialog} from "../../dialog/inputDialog";
import {showMessage} from "../../dialog/message";
import {fetchSyncPost} from "../../util/fetch";
import {escapeHtml} from "../../util/escape";
import {getFileRenameTarget, getFileTree} from "../../util/fileTree";
import {getHostCapabilities} from "../../util/hostCapabilities";
import {isBrowser, isMobile} from "../../util/functions";
import {canChangeSkillEntry, getSkillDirectory, SkillSourceState} from "./state";
import {createSkillManagerPage} from "./page";
import type {AISkillFileData, AISkillFileEntry, AISkillFileRequestInput} from "../../types/api";
/// #if !MOBILE
import {openBy} from "../../editor/util";
/// #endif

// 对话框保持居中，并跟随软键盘调整后的可见区域。
const bindSkillDialogViewport = (dialog: Dialog) => {
    const viewport = window.visualViewport;
    if (!isMobile() || !viewport) {
        return;
    }
    const container = dialog.element.querySelector<HTMLElement>(".b3-dialog");
    const resize = () => {
        container.style.top = `${viewport.offsetTop}px`;
        container.style.height = `${viewport.height}px`;
    };
    viewport.addEventListener("resize", resize);
    viewport.addEventListener("scroll", resize);
    resize();
    return () => {
        viewport.removeEventListener("resize", resize);
        viewport.removeEventListener("scroll", resize);
    };
};

const confirmSkillAction = (title: string, text: string, remove = false): Promise<boolean> => new Promise(resolve => {
    let accepted = false;
    const dialog = new Dialog({
        title,
        width: isMobile() ? "92vw" : "520px",
        content: `<div class="b3-dialog__content ft__breakword">${text}</div>
<div class="b3-dialog__action">
<button class="b3-button b3-button--cancel" id="cancelDialogConfirmBtn" data-action="cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
<button class="b3-button b3-button--${remove ? "remove" : "text"}" id="confirmDialogConfirmBtn" data-action="confirm">${window.siyuan.languages.confirm}</button></div>`,
        destroyCallback: () => {
            disposeViewport?.();
            resolve(accepted);
        },
    });
    dialog.element.querySelector("[data-action=cancel]").addEventListener("click", () => dialog.destroy());
    const confirm = dialog.element.querySelector<HTMLButtonElement>("[data-action=confirm]");
    confirm.addEventListener("click", () => {
        accepted = true;
        dialog.destroy();
    });
    dialog.element.addEventListener("keydown", event => {
        event.stopPropagation();
        if (event.key === "Escape" && !event.isComposing) {
            event.preventDefault();
            dialog.destroy();
        }
    });
    const disposeViewport = bindSkillDialogViewport(dialog);
    confirm.focus({preventScroll: true});
});

export const openSkillManager = (settingRoot?: HTMLElement) => {
    const lang = window.siyuan.languages;
    const mobile = isMobile();
    const settingHost = mobile ? (settingRoot?.closest<HTMLElement>(".config") || settingRoot ||
        document.querySelector<HTMLElement>("#modelMain > .config")) : undefined;
    if (mobile && !settingHost) {
        return;
    }
    if (settingHost?.querySelector(".skill-manager-page")) {
        return;
    }
    const state = new SkillSourceState();
    const expandedPaths = new Set<string>();
    const localFiles = !isBrowser() && !isMobile() && getHostCapabilities().localFileSystem;
    let entries: AISkillFileEntry[] = [];
    let selected: AISkillFileEntry;
    let selectedRevision = "";
    let readOnlyReason: AISkillFileData["readOnlyReason"];
    let busy = false;
    let closed = false;
    let confirming = false;
    let prompting = false;
    let focusEditorAfterRun = false;
    let listScrollTop = 0;
    const button = (action: string, label: string, extraClass = "") =>
        `<button type="button" class="b3-button b3-button--outline ${extraClass}" data-action="${action}">${label}</button>`;
    const content = `<div class="skill-manager${mobile ? " skill-manager--mobile" : ""}">
${mobile ? `<div class="skill-manager__page-header">
<button type="button" class="block__icon block__icon--show skill-manager__page-back" data-action="back" aria-label="${lang.back}"><svg><use xlink:href="#iconLeft"></use></svg></button>
<div class="skill-manager__title"></div>${button("save", lang.save, "skill-manager__page-save")}</div>` : ""}
<div class="skill-manager__actions skill-manager__main-actions">
${button("newSkill", lang.agentSkillNew)}${button("newFile", lang.agentSkillNewFile)}${button("mkdir", lang.agentSkillNewFolder)}
${button("rename", lang.rename)}${button("remove", lang.remove)}${button("refresh", lang.refresh)}
${localFiles ? button("open", lang.showInFolder) : ""}</div>
<div class="skill-manager__panels">
<div class="skill-manager__sidebar">
<input spellcheck="false" class="b3-text-field skill-manager__search" type="search" placeholder="${lang.agentSkillSearch}" aria-label="${lang.agentSkillSearch}">
<ul class="skill-manager__files b3-list b3-list--background" aria-label="${lang.agentWorkspaceSkills}"></ul></div>
<div class="skill-manager__editor">
<div class="skill-manager__editor-header">${mobile ? "" : button("back", lang.back, "skill-manager__back")}<div class="skill-manager__path ft__breakword"></div></div>
<div class="skill-manager__hint ft__on-surface">${lang.emptyContent}</div>
<textarea class="b3-text-field skill-manager__source fn__none" spellcheck="false" aria-label="${lang.agentSkillSource}" disabled></textarea>
${mobile ? "" : `<div class="skill-manager__actions">${button("save", lang.save)}${localFiles ? button("open", lang.showInFolder, "skill-manager__editor-open") : ""}</div>`}
</div></div></div>`;
    const onDestroy = () => {
        closed = true;
        window.removeEventListener("beforeunload", beforeUnload);
    };
    const dialog = mobile ? undefined : new Dialog({
        title: lang.agentSkillManager,
        width: "min(1100px, 96vw)",
        height: "min(800px, 90vh)",
        containerClassName: "skill-manager-dialog",
        content,
        destroyCallback: onDestroy,
    });
    const page = mobile ? createSkillManagerPage(settingHost, content, onDestroy) : undefined;
    const element = page?.element || dialog.element;
    const root = element.querySelector<HTMLElement>(".skill-manager");
    const list = root.querySelector<HTMLElement>(".skill-manager__files");
    const search = root.querySelector<HTMLInputElement>(".skill-manager__search");
    const source = root.querySelector<HTMLTextAreaElement>("textarea");
    const path = root.querySelector<HTMLElement>(".skill-manager__path");
    const hint = root.querySelector<HTMLElement>(".skill-manager__hint");
    const beforeUnload = (event: BeforeUnloadEvent) => {
        if (state.dirty || busy) {
            event.preventDefault();
            event.returnValue = "";
        }
    };
    window.addEventListener("beforeunload", beforeUnload);
    const narrow = () => isMobile() || window.matchMedia("(max-width: 600px)").matches;
    const update = () => {
        const editable = !!state.path;
        source.disabled = !editable;
        source.readOnly = busy;
        source.classList.toggle("fn__none", !editable);
        hint.classList.toggle("fn__none", editable);
        const reasons = {binary: lang.agentSkillBinaryTip, encoding: lang.agentSkillEncodingTip,
            tooLarge: lang.agentSkillTooLargeTip};
        hint.textContent = selected && !selected.isDir ?
            (reasons[readOnlyReason] || lang.agentSkillResourceTip) + (localFiles ? " " + lang.agentSkillOpenLocationTip : "") :
            lang.emptyContent;
        path.textContent = (state.path || selected?.path || "") + (state.dirty ? " *" : "");
        if (mobile) {
            const editing = root.classList.contains("skill-manager--editing");
            root.querySelector<HTMLElement>(".skill-manager__title").textContent = editing ?
                path.textContent : lang.agentSkillManager;
            root.querySelector<HTMLElement>(".skill-manager__page-save").classList.toggle("fn__none", !editing);
        }
        list.setAttribute("aria-busy", String(busy));
        root.querySelectorAll<HTMLButtonElement>("button[data-action]").forEach(element => {
            const action = element.dataset.action;
            element.disabled = busy || confirming || prompting ||
                (action === "save" && (!editable || !state.dirty)) ||
                (["newFile", "mkdir"].includes(action) && !getSkillDirectory(selected)) ||
                (["rename", "remove"].includes(action) && !canChangeSkillEntry(selected));
        });
    };
    const canDiscard = async () => {
        if (busy || closed || confirming || prompting) {
            return false;
        }
        if (!state.dirty) {
            return true;
        }
        confirming = true;
        update();
        try {
            return await confirmSkillAction(lang.confirm, escapeHtml(lang.discardUnsavedChanges));
        } finally {
            confirming = false;
            update();
        }
    };
    const destroy = page ? page.destroy : dialog.destroy.bind(dialog);
    const close = async () => {
        if (await canDiscard()) {
            closed = true;
            destroy();
        }
    };
    if (dialog) {
        dialog.destroy = () => { void close(); };
    }
    const run = async (action: () => Promise<void>) => {
        if (busy || closed || confirming || prompting) {
            return;
        }
        busy = true;
        update();
        try {
            await action();
        } catch (error) {
            showMessage(escapeHtml(String(error)), 5000, "error");
        } finally {
            busy = false;
            update();
            if (focusEditorAfterRun) {
                focusEditorAfterRun = false;
                const topDialog = window.siyuan.dialogs[window.siyuan.dialogs.length - 1];
                if (!closed && root.isConnected && narrow() && root.classList.contains("skill-manager--editing") &&
                    (!topDialog || topDialog === dialog)) {
                    root.querySelector<HTMLButtonElement>("[data-action=back]").focus({preventScroll: true});
                }
            }
        }
    };
    const guardedRun = async (action: () => Promise<void>) => {
        if (await canDiscard()) {
            await run(action);
        }
    };
    const api = async (data: AISkillFileRequestInput) => {
        const response = await fetchSyncPost("/api/ai/agent/manageSkills", data);
        return response.code === 0 ? response.data : undefined;
    };
    const showEditor = () => {
        listScrollTop = list.scrollTop;
        root.classList.add("skill-manager--editing");
        if (narrow()) {
            if (busy) {
                focusEditorAfterRun = true;
            } else {
                root.querySelector<HTMLButtonElement>("[data-action=back]").focus({preventScroll: true});
            }
        }
    };
    const select = async (entry?: AISkillFileEntry, reveal = true) => {
        const data = entry ? await api({action: "read", path: entry.path}) : undefined;
        if (entry && !data) {
            return;
        }
        selected = entry;
        selectedRevision = data?.revision || "";
        if (!entry?.isDir) {
            readOnlyReason = data?.readOnlyReason;
            // 读取结果优先于列表快照，外部程序可能已改变文件内容或编码。
            if (entry) {
                entry.editable = typeof data?.content === "string";
            }
            state.load(entry?.editable ? entry.path : "", data?.content ?? "", selectedRevision);
            source.value = state.text;
            source.scrollTop = 0;
            if (entry && reveal) {
                showEditor();
            }
        }
        update();
    };
    const renderList = () => {
        const scrollTop = root.classList.contains("skill-manager--editing") && narrow() ? listScrollTop : list.scrollTop;
        list.replaceChildren();
        const rows = getFileTree(entries, search.value, expandedPaths);
        if (!rows.length) {
            const empty = document.createElement("li");
            empty.className = "ft__on-surface skill-manager__empty";
            empty.textContent = lang.emptyContent;
            list.append(empty);
        }
        rows.forEach(entry => {
            const row = document.createElement("li");
            row.className = "b3-list-item" + (entry.path === selected?.path ? " b3-list-item--focus" : "");
            row.style.paddingInlineStart = `${Math.min(entry.depth, 16) * 16 + 4}px`;
            row.dataset.path = entry.path;
            if (entry.isDir) {
                const toggle = document.createElement("button");
                toggle.type = "button";
                toggle.className = "skill-manager__toggle";
                toggle.setAttribute("aria-expanded", String(entry.expanded));
                toggle.setAttribute("aria-label", (entry.expanded ? lang.collapse : lang.expand) + " " + entry.name);
                toggle.innerHTML = `<svg><use xlink:href="#${entry.expanded ? "iconDown" : "iconRight"}"></use></svg>`;
                toggle.disabled = !!search.value.trim();
                toggle.addEventListener("click", () => {
                    if (expandedPaths.has(entry.path)) {
                        expandedPaths.delete(entry.path);
                    } else {
                        expandedPaths.add(entry.path);
                    }
                    renderList();
                });
                row.append(toggle);
            } else {
                const spacer = document.createElement("span");
                spacer.className = "skill-manager__toggle";
                row.append(spacer);
            }
            const item = document.createElement("button");
            item.type = "button";
            item.className = "skill-manager__file";
            item.setAttribute("aria-current", String(entry.path === selected?.path));
            item.innerHTML = `<svg class="b3-list-item__graphic"><use xlink:href="#${entry.isDir ? "iconFolder" : "iconFile"}"></use></svg>`;
            const name = document.createElement("span");
            name.className = "b3-list-item__text";
            name.textContent = entry.name;
            item.append(name);
            item.title = entry.path;
            item.addEventListener("click", () => {
                if (busy || confirming || prompting || closed) {
                    return;
                }
                if (entry.path === state.path) {
                    selected = entry;
                    selectedRevision = state.revision;
                    showEditor();
                    renderList();
                    update();
                    return;
                }
                const action = async () => {
                    await select(entry);
                    if (entry.isDir && !search.value.trim()) {
                        if (expandedPaths.has(entry.path)) {
                            expandedPaths.delete(entry.path);
                        } else {
                            expandedPaths.add(entry.path);
                        }
                    }
                    renderList();
                };
                void (entry.isDir ? run(action) : guardedRun(action));
            });
            row.append(item);
            list.append(row);
        });
        list.scrollTop = scrollTop;
    };
    const reload = async (selectedPath = selected?.path, reveal = false) => {
        const data = await api({action: "list"});
        if (!data?.entries) {
            return;
        }
        entries = data.entries;
        if (reveal) {
            search.value = "";
        }
        let parent = selectedPath?.substring(0, selectedPath.lastIndexOf("/"));
        while (parent) {
            expandedPaths.add(parent);
            parent = parent.substring(0, parent.lastIndexOf("/"));
        }
        state.load("", "", "");
        source.value = "";
        await select(entries.find(entry => entry.path === selectedPath), reveal);
        if (!selected || selected.isDir) {
            root.classList.remove("skill-manager--editing");
        }
        renderList();
    };
    const inputName = (action: "newSkill" | "newFile" | "mkdir" | "rename") => {
        if (busy || closed || confirming || prompting) {
            return;
        }
        prompting = true;
        update();
        const entry = selected;
        const directory = getSkillDirectory(entry);
        const title = action === "newSkill" ? lang.agentSkillNew : action === "newFile" ? lang.agentSkillNewFile :
            action === "mkdir" ? lang.agentSkillNewFolder : lang.rename;
        const prompt = openInputDialog({
            title,
            label: lang.name,
            value: action === "rename" ? entry.path.split("/").pop() : "",
            width: isMobile() ? "92vw" : "520px",
            destroyCallback: () => {
                disposeInputViewport?.();
                prompting = false;
                update();
            },
            onConfirm: (value, inputDialog) => {
                const input = inputDialog.element.querySelector<HTMLInputElement>("input");
                const name = value.trim();
                const target = getFileRenameTarget(action === "rename" ? entry.path : "", name);
                if (target === undefined) {
                    input.setCustomValidity(lang.agentSkillNameTip);
                    input.reportValidity();
                    return;
                }
                prompting = false;
                inputDialog.destroy();
                void run(async () => {
                    let next = target;
                    let data;
                    if (action === "newSkill") {
                        data = await api({action: "create", path: name});
                        next = name + "/SKILL.md";
                    } else if (action === "rename") {
                        if (entry.path === target) {
                            return;
                        }
                        data = await api({action: "move", path: entry.path, target, revision: selectedRevision});
                    } else {
                        next = directory + "/" + name;
                        data = await api(action === "mkdir" ? {action: "mkdir", path: next} :
                            {action: "write", path: next, content: "", revision: ""});
                    }
                    if (data) {
                        await reload(next, true);
                    }
                });
            },
        });
        prompt.element.querySelector("input").addEventListener("input", event =>
            (event.target as HTMLInputElement).setCustomValidity(""));
        const disposeInputViewport = bindSkillDialogViewport(prompt);
    };
    source.addEventListener("input", () => {
        state.text = source.value;
        update();
    });
    search.addEventListener("input", renderList);
    root.addEventListener("click", event => {
        const target = (event.target as Element).closest<HTMLButtonElement>("button[data-action]");
        if (!target || target.disabled || busy || confirming || prompting || closed) {
            return;
        }
        const action = target.dataset.action;
        if (action === "save") {
            void run(async () => {
                const data = await api({action: "write", path: state.path, content: state.content, revision: state.revision});
                if (data) {
                    state.acceptSave(data.revision);
                    if (selected?.path === state.path) {
                        selectedRevision = state.revision;
                    } else if (selected?.isDir && state.path.startsWith(selected.path + "/")) {
                        const directory = await api({action: "read", path: selected.path});
                        if (directory) {
                            selectedRevision = directory.revision;
                        }
                    }
                }
            });
        } else if (action === "back") {
            if (mobile && !root.classList.contains("skill-manager--editing")) {
                void close();
                return;
            }
            void canDiscard().then(allowed => {
                if (allowed) {
                    state.discard();
                    source.value = state.text;
                    root.classList.remove("skill-manager--editing");
                    list.scrollTop = listScrollTop;
                    update();
                    list.querySelector<HTMLButtonElement>("[aria-current=true]")?.focus({preventScroll: true});
                }
            });
        } else if (action === "open") {
            /// #if !MOBILE
            const directory = window.siyuan.config.system.dataDir.replace(/\\/g, "/").replace(/\/$/, "") + "/storage/ai/agent/skills";
            openBy(selected ? directory + "/" + selected.path : directory, selected ? "folder" : "app");
            /// #endif
        } else if (action === "refresh") {
            void guardedRun(() => reload());
        } else if (action === "remove") {
            void canDiscard().then(async allowed => {
                if (!allowed || busy || confirming || prompting || closed) {
                    return;
                }
                const entry = selected;
                confirming = true;
                update();
                const accepted = await confirmSkillAction(lang.remove,
                    escapeHtml(entry.path) + "<br>" + escapeHtml(lang.agentSkillDeleteTip), true);
                confirming = false;
                update();
                if (accepted) {
                    await run(async () => {
                        if (await api({action: "remove", path: entry.path, revision: selectedRevision})) {
                            await reload("");
                        }
                    });
                }
            });
        } else if (["newSkill", "newFile", "mkdir", "rename"].includes(action)) {
            void canDiscard().then(allowed => {
                if (allowed) {
                    inputName(action as "newSkill" | "newFile" | "mkdir" | "rename");
                }
            });
        }
    });
    element.addEventListener("keydown", event => {
        event.stopPropagation();
        if (event.key === "Escape" && !event.isComposing) {
            event.preventDefault();
            if (mobile) {
                root.querySelector<HTMLButtonElement>("[data-action=back]").click();
            } else {
                dialog.destroy();
            }
        }
    });
    update();
    if (mobile) {
        root.querySelector<HTMLButtonElement>("[data-action=back]").focus({preventScroll: true});
    }
    void run(() => reload());
};
