import {Dialog} from "../dialog";
import {confirmDialog} from "../dialog/confirmDialog";
import {fetchSyncPost} from "../util/fetch";
import {escapeHtml} from "../util/escape";
import {showMessage} from "../dialog/message";
import {clearTemplatePreview, previewTemplate} from "../protyle/toolbar/util";
import {getTemplateRenameTarget, getTemplateTree, TemplateEntry} from "./fileTree";
import {getTemplateActionEntry, getTemplateActionState} from "./actionState";
import {openBy} from "../editor/util";
import {getHostCapabilities} from "../util/hostCapabilities";
import {isBrowser, isMobile} from "../util/functions";

export const loadTemplateDirectories = async (select: HTMLSelectElement) => {
    const response = await fetchSyncPost("/api/template/manage", {action: "list"});
    if (response.code !== 0 || !select.isConnected) {
        return;
    }
    const value = select.value;
    select.replaceChildren(new Option("/", ""));
    (response.data as TemplateEntry[]).filter(entry => entry.isDir).forEach(entry => {
        select.add(new Option(entry.path, entry.path));
    });
    select.value = Array.from(select.options).some(option => option.value === value) ? value : "";
};

export const openTemplateManager = (contextID = "", onClose?: () => void, initialPath = "") => {
    const lang = window.siyuan.languages;
    let selected: TemplateEntry;
    let editing: TemplateEntry;
    let editingRevision = "";
    let entries: TemplateEntry[] = [];
    let saved = "";
    let useCRLF = false;
    let revision = "";
    let previewPath = "";
    let busy = false;
    let closed = false;
    const expandedPaths = new Set<string>();
    const button = (action: string, label: string) => `<button type="button" class="b3-button b3-button--outline" data-action="${action}">${label}</button>`;
    const dialog = new Dialog({
        title: lang.templateManager,
        width: "min(1100px, 96vw)",
        height: "min(800px, 90vh)",
        content: `<div class="template-manager">
<div class="template-manager__actions">
${button("new", lang.newTemplate)}${button("mkdir", lang.templateNewFolder)}
${button("rename", lang.rename)}${button("move", lang.move)}${button("remove", lang.remove)}${button("refresh", lang.refresh)}
${!isBrowser() && !isMobile() && getHostCapabilities().localFileSystem ? button("open", lang.showInFolder) : ""}
</div>
<div class="template-manager__panels">
<div class="template-manager__sidebar">
<input class="b3-text-field template-manager__search" type="search" placeholder="${lang.templateSearch}" aria-label="${lang.templateSearch}">
<ul class="template-manager__files b3-list b3-list--background" aria-label="${lang.template}"></ul>
</div>
<div class="template-manager__editor">
<div class="template-manager__path ft__breakword"></div>
<textarea class="b3-text-field template-manager__source" spellcheck="false" aria-label="${lang.templateSource}" disabled></textarea>
<div class="template-manager__actions">${button("save", lang.save)}${button("preview", lang.templatePreview)}</div>
<div class="template-manager__context">
<div>${lang.templateContext}<span class="template-manager__context-name"></span></div>
<div class="ft__on-surface">${lang.templateContextTip}</div>
<div class="template-manager__context-fields">
<input class="b3-text-field" type="search" placeholder="${lang.templateContextSearch}" aria-label="${lang.templateContextSearch}">
<select class="b3-select" aria-label="${lang.templateContext}"></select></div></div>
<div class="template-manager__preview"></div>
</div></div>
</div>`,
        destroyCallback: () => {
            clearTemplatePreview(preview);
            window.removeEventListener("beforeunload", beforeUnload);
            onClose?.();
        }
    });
    const source = dialog.element.querySelector<HTMLTextAreaElement>("textarea");
    const list = dialog.element.querySelector<HTMLElement>(".template-manager__files");
    const pathLabel = dialog.element.querySelector<HTMLElement>(".template-manager__path");
    const preview = dialog.element.querySelector<HTMLElement>(".template-manager__preview");
    const fileSearch = dialog.element.querySelector<HTMLInputElement>(".template-manager__search");
    const search = dialog.element.querySelector<HTMLInputElement>(".template-manager__context input");
    const context = dialog.element.querySelector<HTMLSelectElement>("select");
    const contextName = dialog.element.querySelector<HTMLElement>(".template-manager__context-name");
    if (contextID) {
        context.add(new Option(contextID, contextID));
    }
    const updateContextName = () => {
        const selectedOption = context.selectedOptions[0];
        contextName.textContent = selectedOption?.text || "";
        contextName.title = selectedOption?.text || "";
    };
    updateContextName();
    const dirty = () => source.value !== saved;
    const beforeUnload = (event: BeforeUnloadEvent) => {
        if (dirty() || busy) {
            event.preventDefault();
            event.returnValue = "";
        }
    };
    window.addEventListener("beforeunload", beforeUnload);
    const guard = (action: () => void) => {
        if (busy || closed) {
            return;
        }
        if (dirty()) {
            confirmDialog(lang.confirm, lang.discardUnsavedChanges, action);
        } else {
            action();
        }
    };
    const destroy = dialog.destroy.bind(dialog);
    dialog.destroy = () => guard(() => {
        closed = true;
        clearTemplatePreview(preview);
        destroy();
    });
    const update = () => {
        pathLabel.textContent = (editing?.path || "") + (dirty() ? " *" : "");
        pathLabel.classList.toggle("fn__none", !editing);
        source.disabled = !editing;
        source.readOnly = busy;
        list.setAttribute("aria-busy", String(busy));
        dialog.element.querySelectorAll<HTMLButtonElement>(".template-manager__actions > [data-action]").forEach(element => {
            const action = element.dataset.action;
            const state = getTemplateActionState(action, getTemplateActionEntry(action, selected, editing),
                dirty(), busy, Boolean(context.value));
            element.title = state.packageMove ? lang.templatePackageMoveTip : "";
            element.disabled = state.disabled;
            // 请求期间保留按钮外观，由事件入口拦截重复操作。
            element.setAttribute("aria-disabled", String(state.ariaDisabled));
        });
    };
    const run = async (action: () => Promise<void>) => {
        if (busy || closed) {
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
        }
    };
    const api = async (data: Record<string, unknown>) => {
        const response = await fetchSyncPost("/api/template/manage", data);
        return response.code === 0 ? response : undefined;
    };
    const renderList = () => {
        const scrollTop = list.scrollTop;
        list.replaceChildren();
        const rows = getTemplateTree(entries, fileSearch.value, expandedPaths);
        if (rows.length === 0) {
            const empty = document.createElement("li");
            empty.className = "ft__on-surface template-manager__empty";
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
                toggle.className = "template-manager__toggle";
                toggle.setAttribute("aria-expanded", String(entry.expanded));
                toggle.setAttribute("aria-label", (entry.expanded ? lang.collapse : lang.expand) + " " + entry.name);
                toggle.innerHTML = `<svg><use xlink:href="#${entry.expanded ? "iconDown" : "iconRight"}"></use></svg>`;
                toggle.disabled = !!fileSearch.value.trim();
                toggle.addEventListener("click", () => {
                    if (expandedPaths.has(entry.path)) {
                        expandedPaths.delete(entry.path);
                    } else {
                        expandedPaths.add(entry.path);
                    }
                    renderList();
                    Array.from(list.querySelectorAll<HTMLElement>("li[data-path]"))
                        .find(item => item.dataset.path === entry.path)?.querySelector<HTMLButtonElement>("button").focus({preventScroll: true});
                });
                row.append(toggle);
            } else {
                const spacer = document.createElement("span");
                spacer.className = "template-manager__toggle";
                row.append(spacer);
            }
            const element = document.createElement("button");
            element.type = "button";
            element.className = "template-manager__file";
            element.setAttribute("aria-current", String(entry.path === selected?.path));
            element.innerHTML = `<svg class="b3-list-item__graphic"><use xlink:href="#${entry.isDir ? "iconFolder" : "iconFile"}"></use></svg>`;
            const name = document.createElement("span");
            name.className = "b3-list-item__text";
            name.textContent = entry.name;
            element.append(name);
            element.title = entry.path;
            element.addEventListener("click", () => {
                if (busy || closed) {
                    return;
                }
                if (entry.isDir) {
                    void run(async () => {
                        await select(entry, true);
                        if (!fileSearch.value.trim()) {
                            if (expandedPaths.has(entry.path)) {
                                expandedPaths.delete(entry.path);
                            } else {
                                expandedPaths.add(entry.path);
                            }
                        }
                        renderList();
                    });
                } else if (entry.path === editing?.path) {
                    selected = entry;
                    revision = editingRevision;
                    renderList();
                    update();
                } else if (entry.path !== selected?.path) {
                    guard(() => run(() => select(entry)));
                }
            });
            row.append(element);
            list.append(row);
        });
        list.scrollTop = scrollTop;
    };
    const select = async (entry?: TemplateEntry, preserveEditor = false) => {
        let content = "";
        let absolutePath = "";
        if (entry) {
            const response = await api({action: "read", path: entry.path});
            if (!response) {
                return;
            }
            revision = response.data.revision;
            content = response.data.content;
            absolutePath = response.data.path || "";
        } else {
            revision = "";
        }
        selected = entry;
        if (!preserveEditor) {
            editing = entry && !entry.isDir ? entry : undefined;
            editingRevision = editing ? revision : "";
            useCRLF = content.includes("\r\n") && !content.replace(/\r\n/g, "").includes("\n");
            previewPath = absolutePath;
            source.value = content;
            saved = source.value;
            clearTemplatePreview(preview);
        }
        list.querySelectorAll<HTMLElement>("li[data-path]").forEach(row => {
            const active = row.dataset.path === selected?.path;
            row.classList.toggle("b3-list-item--focus", active);
            row.querySelector(".template-manager__file").setAttribute("aria-current", String(active));
        });
        update();
    };
    const reload = async (path = selected?.path, reveal = false) => {
        const response = await api({action: "list"});
        if (!response) {
            return;
        }
        entries = response.data;
        if (reveal) {
            fileSearch.value = "";
        }
        let parent = path?.substring(0, path.lastIndexOf("/"));
        while (parent) {
            expandedPaths.add(parent);
            parent = parent.substring(0, parent.lastIndexOf("/"));
        }
        await select(entries.find(entry => entry.path === path));
        renderList();
        if (reveal) {
            list.querySelector(".b3-list-item--focus")?.scrollIntoView({block: "nearest", inline: "nearest"});
        }
    };
    const inputPath = (title: string, value: string, callback: (value: string) => Promise<void>, nameOnly = false) => {
        const prompt = new Dialog({
            title,
            width: "min(520px, 92vw)",
            content: `<div class="b3-dialog__content"><label>${nameOnly ? lang.name : lang.savePath}<div class="fn__hr"></div><input class="b3-text-field fn__block" spellcheck="false"></label></div>
<div class="b3-dialog__action">${button("cancel", lang.cancel)}<div class="fn__space"></div>${button("confirm", lang.confirm)}</div>`
        });
        const input = prompt.element.querySelector<HTMLInputElement>("input");
        input.value = value;
        prompt.bindInput(input, () => prompt.element.querySelector<HTMLButtonElement>("[data-action=confirm]").click());
        input.select();
        prompt.element.querySelector("[data-action=cancel]").addEventListener("click", () => prompt.destroy());
        prompt.element.querySelector("[data-action=confirm]").addEventListener("click", () => {
            if (!input.value.trim()) {
                input.focus();
                return;
            }
            if (nameOnly && getTemplateRenameTarget(selected.path, input.value.trim()) === undefined) {
                input.setCustomValidity(lang.templateNameTip);
                input.reportValidity();
                return;
            }
            prompt.destroy();
            void run(() => callback(input.value.trim()));
        });
        input.addEventListener("input", () => input.setCustomValidity(""));
    };
    const move = () => {
        const entry = selected;
        const prompt = new Dialog({
            title: lang.move,
            width: "min(520px, 92vw)",
            content: `<div class="b3-dialog__content"><label>${lang.savePath}<div class="fn__hr"></div><select class="b3-select fn__block"></select></label></div>
<div class="b3-dialog__action">${button("cancel", lang.cancel)}<div class="fn__space"></div>${button("confirm", lang.confirm)}</div>`
        });
        const destination = prompt.element.querySelector<HTMLSelectElement>("select");
        destination.add(new Option("/", ""));
        entries.filter(item => item.isDir && (!entry.isDir || (item.path !== entry.path && !item.path.startsWith(entry.path + "/"))))
            .forEach(item => destination.add(new Option(item.path, item.path)));
        destination.value = entry.path.substring(0, entry.path.lastIndexOf("/"));
        prompt.element.querySelector("[data-action=cancel]").addEventListener("click", () => prompt.destroy());
        prompt.element.querySelector("[data-action=confirm]").addEventListener("click", () => {
            const target = (destination.value ? destination.value + "/" : "") + entry.path.split("/").pop();
            prompt.destroy();
            if (target === entry.path) {
                return;
            }
            void run(async () => {
                if (await api({action: "move", path: entry.path, target, revision})) {
                    await reload(target, true);
                }
            });
        });
    };
    source.addEventListener("input", () => {
        clearTemplatePreview(preview);
        update();
    });
    dialog.element.addEventListener("keydown", event => {
        event.stopPropagation();
        if (event.key === "Escape" && !event.isComposing) {
            event.preventDefault();
            dialog.destroy();
        }
    });
    fileSearch.addEventListener("input", renderList);
    context.addEventListener("change", () => {
        updateContextName();
        clearTemplatePreview(preview);
        update();
    });
    let searchRequest = 0;
    search.addEventListener("input", async () => {
        const request = ++searchRequest;
        try {
            const response = await fetchSyncPost("/api/filetree/searchDocs", {k: search.value});
            if (closed || request !== searchRequest || response.code !== 0) {
                return;
            }
            const selectedOption = context.selectedOptions[0];
            context.replaceChildren();
            if (selectedOption?.value) {
                context.add(new Option(selectedOption.text, selectedOption.value));
            }
            response.data.forEach((doc: {path: string, hPath: string}) => {
                const id = doc.path.split("/").pop().replace(/\.sy$/, "");
                if (id !== context.value) {
                    context.add(new Option(doc.hPath, id));
                }
            });
            updateContextName();
            clearTemplatePreview(preview);
            update();
        } catch (error) {
            showMessage(escapeHtml(String(error)), 5000, "error");
        }
    });
    if (contextID) {
        void fetchSyncPost("/api/block/getRefText", {id: contextID}).then(response => {
            if (!closed && response.code === 0 && context.options[0]?.value === contextID) {
                context.options[0].text = response.data || contextID;
                updateContextName();
            }
        }).catch(() => {});
    }
    dialog.element.addEventListener("click", event => {
        const target = (event.target as Element).closest<HTMLElement>(".template-manager__actions > [data-action]");
        const action = preview.contains(target) ? undefined : target?.dataset.action;
        if (!action || busy || closed || (target as HTMLButtonElement).disabled) {
            return;
        }
        if (action === "save") {
            void run(async () => {
                const content = useCRLF ? source.value.replace(/\n/g, "\r\n") : source.value;
                const response = await api({action: "write", path: editing.path, content, revision: editingRevision});
                if (response) {
                    saved = source.value;
                    editingRevision = response.data.revision;
                    if (selected?.path === editing.path) {
                        revision = editingRevision;
                    } else if (selected?.isDir && editing.path.startsWith(selected.path + "/")) {
                        const directory = await api({action: "read", path: selected.path});
                        if (directory) {
                            revision = directory.data.revision;
                        }
                    }
                }
            });
        } else if (action === "open") {
            const root = window.siyuan.config.system.dataDir.replace(/\\/g, "/").replace(/\/$/, "") + "/templates";
            openBy(selected ? root + "/" + selected.path : root, selected ? "folder" : "app");
        } else if (action === "preview") {
            previewTemplate(previewPath, preview, context.value, source.value);
        } else {
            guard(() => {
                if (action === "refresh") {
                    void run(() => reload());
                } else if (action === "move") {
                    move();
                } else if (action === "remove") {
                    confirmDialog(lang.remove, escapeHtml(selected.path) + "<br>" + lang.templateDeleteTip, () => {
                        void run(async () => {
                            if (await api({action: "remove", path: selected.path, revision})) {
                                await reload("");
                            }
                        });
                    }, undefined, true);
                } else {
                    const directory = selected?.isDir ? selected.path + "/" : (selected?.path.substring(0, selected.path.lastIndexOf("/") + 1) || "");
                    const initial = action === "rename" ? selected.path.split("/").pop() : directory + (action === "new" ? lang.untitled + ".md" : lang.untitled);
                    inputPath(action === "mkdir" ? lang.templateNewFolder : (action === "rename" ? lang.rename : lang.newTemplate), initial, async value => {
                        let response;
                        if (action === "new") {
                            value = /\.md$/i.test(value) ? value : value + ".md";
                            response = await api({action: "write", path: value, content: "", revision: ""});
                        } else if (action === "mkdir") {
                            response = await api({action: "mkdir", path: value});
                        } else {
                            value = getTemplateRenameTarget(selected.path, value);
                            if (value === selected.path) {
                                return;
                            }
                            response = await api({action: "move", path: selected.path, target: value, revision});
                        }
                        if (response) {
                            await reload(value, true);
                        }
                    }, action === "rename");
                }
            });
        }
    });
    update();
    void run(() => reload(initialPath, Boolean(initialPath)));
};
