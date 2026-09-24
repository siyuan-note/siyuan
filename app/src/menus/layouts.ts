import {Constants} from "../constants";
import {setStorageVal} from "../protyle/util/compatibility";
import {fetchPost} from "../util/fetch";
import {getAllLayout} from "../layout/util";
import {showMessage} from "../dialog/message";
import {openInputDialog} from "../dialog/inputDialog";
import {confirmDialog} from "../dialog/confirmDialog";
import {escapeHtml} from "../util/escape";
import {upDownHint} from "../util/upDownHint";
import {isBrowser} from "../util/functions";
import {editWindowWorkspace, getWindowWorkspaces, openWindowWorkspace, removeWindowWorkspace} from "../window/workspace";
import {MenuItem} from "./Menu";
import * as dayjs from "dayjs";
/// #if !BROWSER
import {ipcRenderer} from "electron";
/// #endif

const editLayout = (layoutName?: string) => {
    const dialog = openInputDialog({
        positionId: Constants.DIALOG_SAVEWORKSPACE,
        title: layoutName ? window.siyuan.languages.mainWindowLayouts :
            window.siyuan.languages.save,
        value: layoutName || "",
        placeholder: window.siyuan.languages.memo,
        width: "520px",
        confirmText: window.siyuan.languages.confirm,
        onConfirm: (value, dialog) => {
            value = value.trim();
            if (!value) {
                showMessage(window.siyuan.languages["_kernel"]["142"]);
                return;
            }
            dialog.destroy();
            if (layoutName) {
                window.siyuan.storage[Constants.LOCAL_LAYOUTS].find((layoutItem: ISaveLayout) => {
                    if (layoutItem.name === layoutName) {
                        layoutItem.name = value;
                        layoutItem.time = Date.now();
                        setStorageVal(Constants.LOCAL_LAYOUTS, window.siyuan.storage[Constants.LOCAL_LAYOUTS]);
                        return true;
                    }
                });
                return;
            }
            const hadName = window.siyuan.storage[Constants.LOCAL_LAYOUTS].find((item: ISaveLayout) => {
                if (item.name === value) {
                    confirmDialog(window.siyuan.languages.save, window.siyuan.languages.exportTplTip, () => {
                        item.layout = getAllLayout();
                        item.time = Date.now();
                        item.filesPaths = window.siyuan.storage[Constants.LOCAL_FILESPATHS];
                        setStorageVal(Constants.LOCAL_LAYOUTS, window.siyuan.storage[Constants.LOCAL_LAYOUTS]);
                    });
                    return true;
                }
            });
            if (hadName) {
                return;
            }
            window.siyuan.storage[Constants.LOCAL_LAYOUTS].push({
                name: value,
                time: Date.now(),
                layout: getAllLayout(),
                filesPaths: window.siyuan.storage[Constants.LOCAL_FILESPATHS]
            });
            setStorageVal(Constants.LOCAL_LAYOUTS, window.siyuan.storage[Constants.LOCAL_LAYOUTS]);
        },
    });
    dialog.element.setAttribute("data-key", Constants.DIALOG_SAVEWORKSPACE);
};

const openLayout = (name: string) => {
    const item: ISaveLayout = window.siyuan.storage[Constants.LOCAL_LAYOUTS]
        .find((layout: ISaveLayout) => layout.name === name);
    if (!item) {
        return;
    }
    fetchPost("/api/system/setUILayout", {layout: item.layout}, () => {
        if (item.filesPaths) {
            window.siyuan.storage[Constants.LOCAL_FILESPATHS] = item.filesPaths;
            setStorageVal(Constants.LOCAL_FILESPATHS, item.filesPaths, () => window.location.reload());
        } else {
            window.location.reload();
        }
    });
};

export const openSelectedLayouts = async (mainName: string, workspaceIDs: string[]) => {
    await Promise.allSettled(workspaceIDs.map(id => openWindowWorkspace(id)));
    if (mainName) {
        openLayout(mainName);
    }
};

type LayoutTarget = {type: "main", name: string} | {type: "window", id: string, opened: boolean};

export const getLayoutActions = (target: LayoutTarget, time?: number): IMenu[] => {
    const actions: IMenu[] = [{
        id: "open",
        icon: target.type === "main" ? "iconReplace" : target.opened ? "iconFocus" : "iconOpen",
        label: target.type === "main" ? window.siyuan.languages.use :
            target.opened ? window.siyuan.languages.windowWorkspaceSwitch : window.siyuan.languages.openBy,
        click: () => {
            if (target.type === "window") {
                void openWindowWorkspace(target.id);
            } else {
                openLayout(target.name);
            }
        },
    }, ...(target.type === "main" ? [{
        id: "update",
        icon: "iconRefresh",
        label: window.siyuan.languages.update,
        click: () => {
            const item: ISaveLayout = window.siyuan.storage[Constants.LOCAL_LAYOUTS]
                .find((layout: ISaveLayout) => layout.name === target.name);
            if (item) {
                item.layout = getAllLayout();
                item.filesPaths = window.siyuan.storage[Constants.LOCAL_FILESPATHS];
                item.time = Date.now();
                setStorageVal(Constants.LOCAL_LAYOUTS, window.siyuan.storage[Constants.LOCAL_LAYOUTS]);
            }
        },
    }] : []), {
        id: "rename",
        icon: "iconEdit",
        label: window.siyuan.languages.rename,
        click: () => {
            if (target.type === "window") {
                editWindowWorkspace(target.id);
            } else {
                editLayout(target.name);
            }
        },
    }, {
        id: "delete",
        icon: "iconTrashcan",
        label: window.siyuan.languages.delete,
        click: () => {
            if (target.type === "window") {
                removeWindowWorkspace(target.id);
                return;
            }
            const layouts: ISaveLayout[] = window.siyuan.storage[Constants.LOCAL_LAYOUTS];
            const index = layouts.findIndex(layout => layout.name === target.name);
            if (index > -1) {
                layouts.splice(index, 1);
                setStorageVal(Constants.LOCAL_LAYOUTS, layouts);
            }
        },
    }];
    if (time) {
        actions.push({id: "separator_time", type: "separator"}, {
            id: "modifiedAt",
            iconHTML: "",
            type: "readonly",
            label: `${window.siyuan.languages.modifiedAt} ${dayjs(time).format("YYYY-MM-DD HH:mm:ss")}`,
        });
    }
    return actions;
};

export const getLayoutSubMenu = (): IMenu[] => {
    return [{
        iconHTML: "",
        type: "empty",
        label: `<div class="fn__flex-column b3-menu__filter window-workspace__list"><div class="window-workspace__search fn__flex-shrink"><input spellcheck="false" class="b3-text-field fn__block" placeholder="${window.siyuan.languages.searchPlaceholder}"></div>
<div class="window-workspace__toolbar fn__flex"><span class="fn__flex-1" data-type="selected-count"></span><button data-id="open-selected" class="b3-button b3-button--outline b3-button--small">${window.siyuan.languages.openBy}</button></div>
<div class="fn__flex-1 window-workspace__entries"></div></div>`,
        bind(menuElement) {
            const input = menuElement.querySelector<HTMLInputElement>(".b3-text-field");
            const list = menuElement.querySelector<HTMLElement>(".window-workspace__entries");
            const menu = window.siyuan.menus.menu;
            let openIDs: string[] = [];
            let selectedMain = "";
            const selectedWindows = new Set<string>();
            const updateSelection = () => {
                const count = Number(!!selectedMain) + selectedWindows.size;
                const button = menuElement.querySelector<HTMLButtonElement>("[data-id='open-selected']");
                const label = menuElement.querySelector<HTMLElement>("[data-type='selected-count']");
                if (button) {
                    button.disabled = count === 0;
                }
                if (label) {
                    label.textContent = window.siyuan.languages.layoutSelectedCount.replace("${x}", count.toString());
                }
            };
            menuElement.querySelector<HTMLButtonElement>("[data-id='open-selected']").addEventListener("click", event => {
                event.preventDefault();
                event.stopPropagation();
                menu.remove();
                void openSelectedLayouts(selectedMain, Array.from(selectedWindows));
            });
            const closeActions = () => {
                list.querySelectorAll<HTMLElement>(":scope > .b3-menu__item").forEach(row => {
                    row.classList.remove("b3-menu__item--show");
                    row.querySelectorAll(".b3-menu__item--current").forEach(item => {
                        item.classList.remove("b3-menu__item--current");
                    });
                });
            };
            list.addEventListener("scroll", closeActions);
            const focusActions = (row: HTMLElement) => {
                closeActions();
                const submenu = row.querySelector<HTMLElement>(":scope > .b3-menu__submenu");
                menu.element.querySelectorAll(".b3-menu__item--current").forEach(item => {
                    item.classList.remove("b3-menu__item--current");
                });
                row.classList.add("b3-menu__item--show");
                menu.showSubMenu(submenu);
                const first = submenu.querySelector<HTMLElement>(".b3-menu__item:not([disabled])");
                first.focus();
                first.classList.add("b3-menu__item--current");
            };
            const appendRow = (target: LayoutTarget, name: string, time?: number) => {
                const element = new MenuItem({
                    iconHTML: "",
                    label: escapeHtml(name),
                    type: "submenu",
                    submenu: getLayoutActions(target, time),
                    click: (element, event) => {
                        if (element.querySelector(":scope > .b3-menu__submenu").contains(event.target as Node)) {
                            return true;
                        }
                        if (target.type === "window") {
                            void openWindowWorkspace(target.id);
                        } else {
                            openLayout(target.name);
                        }
                    },
                }).element;
                if (target.type === "window") {
                    element.dataset.workspaceId = target.id;
                } else {
                    element.dataset.name = target.name;
                }
                const checkbox = document.createElement("input");
                checkbox.type = "checkbox";
                checkbox.className = "window-workspace__check";
                checkbox.checked = target.type === "main" ? selectedMain === target.name : selectedWindows.has(target.id);
                checkbox.setAttribute("aria-label", name);
                checkbox.addEventListener("click", event => event.stopPropagation());
                checkbox.addEventListener("keydown", event => event.stopPropagation());
                checkbox.addEventListener("change", () => {
                    if (target.type === "main") {
                        selectedMain = checkbox.checked ? target.name : "";
                        list.querySelectorAll<HTMLInputElement>("[data-name] .window-workspace__check").forEach(other => {
                            if (other !== checkbox) {
                                other.checked = false;
                            }
                        });
                    } else if (checkbox.checked) {
                        selectedWindows.add(target.id);
                    } else {
                        selectedWindows.delete(target.id);
                    }
                    updateSelection();
                });
                const selection = document.createElement("span");
                selection.className = "window-workspace__selection";
                selection.append(checkbox);
                selection.addEventListener("click", event => {
                    event.stopPropagation();
                    if (event.target !== checkbox) {
                        checkbox.click();
                    }
                });
                element.insertBefore(selection, element.firstChild);
                const label = element.querySelector<HTMLElement>(".b3-menu__label");
                label.classList.add("fn__ellipsis", "window-workspace__name");
                label.setAttribute("title", name);
                list.append(element);
            };
            const render = (selectFirst = document.activeElement === input) => {
                const query = input.value.toLowerCase();
                const layouts: ISaveLayout[] = window.siyuan.storage[Constants.LOCAL_LAYOUTS];
                list.innerHTML = `<div class="b3-menu__item b3-menu__item--readonly">
<span class="b3-menu__label">${window.siyuan.languages.mainWindowLayouts}</span>
<button data-id="save" class="b3-button b3-button--outline b3-button--small">${window.siyuan.languages.save}</button></div>`;
                const save = list.querySelector<HTMLElement>("[data-id='save']");
                save.addEventListener("keydown", event => {
                    if (event.key === "Enter" || event.key === " ") {
                        event.stopPropagation();
                    }
                });
                save.addEventListener("click", event => {
                    event.preventDefault();
                    event.stopPropagation();
                    menu.remove();
                    editLayout();
                });
                layouts.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, {numeric: true}))
                    .filter(item => item.name.toLowerCase().includes(query))
                    .forEach(item => appendRow({type: "main", name: item.name}, item.name, item.time));
                const workspaces = isBrowser() ? [] : getWindowWorkspaces().filter(item => item.name.toLowerCase().includes(query));
                if (!isBrowser()) {
                    list.insertAdjacentHTML("beforeend", `<div class="b3-menu__item b3-menu__item--readonly"><span class="b3-menu__label">${window.siyuan.languages.windowWorkspaces}</span></div>`);
                    workspaces.forEach(item => appendRow({type: "window", id: item.id, opened: openIDs.includes(item.id)}, item.name, item.time));
                }
                updateSelection();
                if (selectFirst) {
                    menu.element.querySelectorAll(".b3-menu__item--current").forEach(item => {
                        item.classList.remove("b3-menu__item--current");
                    });
                    list.querySelector(".b3-menu__item:not(.b3-menu__item--readonly)")?.classList.add("b3-menu__item--current");
                }
            };
            input.addEventListener("focus", () => {
                closeActions();
                menu.element.querySelectorAll(".b3-menu__item--current").forEach(item => {
                    item.classList.remove("b3-menu__item--current");
                });
                list.querySelector(".b3-menu__item:not(.b3-menu__item--readonly)")?.classList.add("b3-menu__item--current");
            });
            input.addEventListener("blur", () => list.querySelector(".b3-menu__item--current")?.classList.remove("b3-menu__item--current"));
            input.addEventListener("keydown", event => {
                event.stopPropagation();
                if (event.isComposing) {
                    return;
                }
                upDownHint(list, event, "b3-menu__item--current");
                if (event.key === "Escape" || (event.key === "ArrowLeft" && !input.value)) {
                    menu.remove(true);
                } else if (event.key === "Enter") {
                    list.querySelector<HTMLElement>(".b3-menu__item--current")?.click();
                } else if (event.key === "ArrowRight") {
                    const current = list.querySelector<HTMLElement>(".b3-menu__item--current");
                    if (current && input.selectionStart === input.value.length) {
                        event.preventDefault();
                        focusActions(current);
                    }
                }
            });
            input.addEventListener("compositionend", () => render(true));
            input.addEventListener("input", (event: InputEvent) => {
                if (!event.isComposing) {
                    event.stopPropagation();
                    render(true);
                }
            });
            render();
            /// #if !BROWSER
            void ipcRenderer.invoke(Constants.SIYUAN_GET, {cmd: Constants.SIYUAN_WINDOW_WORKSPACE_GET_OPEN}).then((ids: string[]) => {
                openIDs = Array.isArray(ids) ? ids : [];
                if (menuElement.isConnected) {
                    render();
                }
            });
            /// #endif
        },
    }];
};
