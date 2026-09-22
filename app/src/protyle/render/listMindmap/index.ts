import {Constants} from "../../../constants";
import {showMessage} from "../../../dialog/message";
import {fetchSyncPost} from "../../../util/fetch";
import {normalizeHTMLAssetIFrameBlockDOM} from "../../../asset/html";
import {updateTransaction, transaction} from "../../wysiwyg/transaction";
import {genListItemElement, setTaskListItemMarker} from "../../wysiwyg/list";
import {nextTaskListMarker, nextTaskListStatus} from "../../wysiwyg/taskListMarker";
import {getTaskStatusItems} from "../../wysiwyg/taskStatusDialog";
import {getTabTask} from "../tabsRender";
import {focusBlock} from "../../util/selection";
import {Menu} from "../../../plugin/Menu";
import {completeTabsListSource} from "../../wysiwyg/tabsList";
import {waitForPendingTransactions} from "../../util/transactionQueue";
import {hideAllElements, hideElements} from "../../ui/hideElements";
import {globalClickHideMenu} from "../../../boot/globalEvent/click";
import {countBlockWord} from "../../../layout/status";
import {openLink} from "../../../editor/openLink";
import {suspendBlockPopover} from "../../../block/popover";
import {matchHotKey} from "../../util/hotKey";
import {setFullscreen} from "../../breadcrumb/action";
import {
    getBuiltinColorPropertyValue, getBuiltinInlineStylePreview, getBuiltinInlineStylePropertyValue,
    getInlineStyleByID, getInlineStylePreview, getInlineStylePropertyValue,
    getInlineStylesCache, getVisibleOrderedStyleKeys, isBuiltinOrderKey,
    TBuiltinInlineStyleID,
} from "../../toolbar/inlineStyle";
import {openInlineStyleDialog} from "../../toolbar/inlineStyleDialog";
import {
    addListMindmapNode, cleanListMindmapHTML, deleteListMindmapNode,
    moveListMindmapNode, readListMindmap, replaceListMindmapContent,
    writeListMindmapMetadata, getListMindmapTabItem,
} from "./model";
import type {ListMindmapMetadata, ListMindmapModel} from "./model";
import {getListMindmapElements, registerListMindmapRoot} from "./render";
import {ListMindmapView} from "./view";
import {openListMindmapEditor} from "./editor";
import {focusListMindmap} from "./create";

const roots = new WeakMap<IProtyle, {refresh: () => void, destroy: () => void}>();

const canToggleView = (owner: IProtyle, list: HTMLElement) => !owner.disabled && !owner.lite &&
    list.isConnected && !!list.dataset.nodeId &&
    !owner.options.action.includes(Constants.CB_GET_HISTORY) &&
    list.closest(".protyle-wysiwyg") === owner.wysiwyg.element;

const canEdit = (owner: IProtyle, list: HTMLElement) => canToggleView(owner, list) &&
    !list.closest(".protyle-wysiwyg__embed");

export const toggleListMindmap = (owner: IProtyle, list: HTMLElement) => {
    if (list.dataset.type !== "NodeList" || !canToggleView(owner, list)) {
        return;
    }
    const previous = list.getAttribute(Constants.CUSTOM_SY_LIST_MINDMAP) || "";
    const next = previous === "1" ? "" : "1";
    if (next) {
        try {
            readListMindmap(list);
        } catch (error) {
            console.error(error);
            showMessage(window.siyuan.languages.listMindmapInvalid);
            return;
        }
    }
    hideElements(["gutter", "toolbar", "hint"], owner);
    list.setAttribute(Constants.CUSTOM_SY_LIST_MINDMAP, next);
    transaction(owner, [{action: "setAttrs", id: list.dataset.nodeId,
        data: JSON.stringify({[Constants.CUSTOM_SY_LIST_MINDMAP]: next})}], [{action: "setAttrs", id: list.dataset.nodeId,
        data: JSON.stringify({[Constants.CUSTOM_SY_LIST_MINDMAP]: previous})}]);
    roots.get(owner)?.refresh();
};

class ListMindmapController {
    public readonly list: HTMLElement;
    private readonly owner: IProtyle;
    private readonly host: HTMLElement;
    private readonly view: ListMindmapView;
    private model: ListMindmapModel;
    private snapshot = "";
    private activeEditor?: {finish: () => Promise<boolean>, destroy: () => void};
    private editRequest = 0;
    private disposed = false;
    private taskChanges: Promise<void> = Promise.resolve();

    constructor(owner: IProtyle, list: HTMLElement) {
        this.owner = owner;
        this.list = list;
        this.model = readListMindmap(list);
        list.querySelector(":scope > .list-mindmap")?.remove();
        this.host = document.createElement("div");
        this.host.className = "list-mindmap";
        this.host.contentEditable = "false";
        this.host.addEventListener("pointermove", event => {
            if (event.pointerType !== "mouse" || event.buttons || !owner.options.render.gutter ||
                !owner.gutter || this.host.classList.contains("fullscreen") ||
                (event.target as Element).closest(".list-mindmap__editor, .protyle-toolbar, .protyle-util")) {
                return;
            }
            // 脑图内部的鼠标事件不冒泡到编辑器，块标仍定位到原列表块。
            owner.gutter.render(owner, list, this.host);
        });
        this.host.addEventListener("pointerdown", event => {
            const target = event.target as HTMLElement;
            // 脑图阻止事件冒泡，主动复用公共收起逻辑，并保留内嵌编辑器浮层的交互。
            globalClickHideMenu(target);
            if (!target.closest(".protyle-toolbar, .protyle-util, [data-sub-element-source]")) {
                hideAllElements(["toolbar", "util", "gutter"]);
                hideElements(["hint"], this.owner);
                // 进入脑图交互时清除外层块选区，同时保留多选工具栏的操作上下文。
                if (event.button === 0 && !this.owner.toolbar.isMultiSelectMode() &&
                    this.owner.wysiwyg.element.querySelector(".protyle-wysiwyg--select, .protyle-wysiwyg--select-mode")) {
                    hideElements(["select"], this.owner);
                    countBlockWord([], this.owner);
                }
            }
        }, {capture: true});
        this.host.addEventListener("keydown", event => {
            if (event.isComposing || (event.target instanceof Element &&
                event.target.closest("input, textarea, select, .list-mindmap__editor"))) {
                return;
            }
            const keys = owner.options?.action && window.siyuan.config.keymap.editor.general;
            if (keys && (matchHotKey(keys.undo, event) || matchHotKey(keys.redo, event))) {
                event.preventDefault();
                event.stopImmediatePropagation();
                void this.undo(matchHotKey(keys.redo, event));
            }
        }, {capture: true});
        list.appendChild(this.host);
        let restoreFullscreenChrome: () => void;
        this.view = new ListMindmapView({
            host: this.host, model: this.model, labels: window.siyuan.languages,
            onOpenLink: (href, event) => openLink(owner.app, href, event, event.ctrlKey || event.metaKey),
            onInteractionStart: event => suspendBlockPopover(this.host, event),
            readOnly: !canEdit(owner, list),
            onFullscreen: (enter, button) => {
                if (enter) {
                    const drag = document.getElementById("drag");
                    const controls = document.getElementById("windowControls");
                    const dragHidden = drag?.classList.contains("fn__hidden");
                    const controlsZIndex = controls?.style.zIndex;
                    // 脑图可以从全屏编辑器中打开，退出后恢复原窗口控件状态。
                    restoreFullscreenChrome = () => {
                        drag?.classList.toggle("fn__hidden", !!dragHidden);
                        if (controls) {
                            controls.style.zIndex = controlsZIndex;
                        }
                    };
                }
                setFullscreen(this.host, enter, button);
                if (!enter) {
                    restoreFullscreenChrome?.();
                    restoreFullscreenChrome = undefined;
                }
            },
            colors: () => {
                const type = "color";
                const data = getInlineStylesCache();
                return getVisibleOrderedStyleKeys(type, data).map(key => {
                    if (isBuiltinOrderKey(type, key)) {
                        return {label: `${window.siyuan.languages.color} ${key}`,
                            value: getBuiltinColorPropertyValue(Number(key), type)};
                    }
                    const style = getInlineStyleByID(key, data);
                    return {label: style.name, value: getInlineStylePropertyValue(style, type)};
                });
            },
            nodeColors: () => {
                const data = getInlineStylesCache();
                return getVisibleOrderedStyleKeys("style1", data).map(key => {
                    if (isBuiltinOrderKey("style1", key)) {
                        return {label: window.siyuan.languages[`${key}Style`],
                            color: getBuiltinInlineStylePropertyValue(key as TBuiltinInlineStyleID, "color"),
                            backgroundColor: getBuiltinInlineStylePropertyValue(key as TBuiltinInlineStyleID, "backgroundColor"),
                            preview: getBuiltinInlineStylePreview(key as TBuiltinInlineStyleID)};
                    }
                    const style = getInlineStyleByID(key, data);
                    return {label: style.name, ...getInlineStylePreview(style)};
                });
            },
            onManageNodeColors: () => openInlineStyleDialog("style1"),
            onManageLineColors: () => openInlineStyleDialog("color"),
            finishEdit: () => this.activeEditor?.finish(),
            onExit: async () => {
                if (this.activeEditor && !await this.activeEditor.finish()) {
                    return;
                }
                if (canToggleView(owner, list)) {
                    toggleListMindmap(owner, list);
                } else {
                    this.destroy();
                }
            },
            onEdit: (id, contentHost) => this.edit(id, contentHost),
            onTaskToggle: (id, cycle) => this.setTask(id, cycle ? nextTaskListStatus : nextTaskListMarker),
            onTabTaskToggle: (id, itemId) => this.setTabTask(id, itemId, nextTaskListMarker),
            onTabTaskMenu: (id, itemId, anchor) => {
                const item = getListMindmapTabItem(list, id, itemId);
                const marker = item && getTabTask(item);
                if (!canEdit(owner, list) || marker == null) {
                    return;
                }
                const menu = new Menu();
                getTaskStatusItems(marker, next => this.setTabTask(id, itemId, () => next)).forEach(entry => menu.addItem(entry));
                const rect = anchor.getBoundingClientRect();
                menu.open({x: rect.left, y: rect.bottom, h: rect.height});
            },
            onTaskMenu: (id, anchor) => {
                if (!canEdit(owner, list)) {
                    return;
                }
                const marker = readListMindmap(list).nodes.get(id)?.taskMarker;
                if (marker === undefined) {
                    return;
                }
                const menu = new Menu();
                getTaskStatusItems(marker, next => this.setTask(id, () => next)).forEach(item => menu.addItem(item));
                const rect = anchor.getBoundingClientRect();
                menu.open({x: rect.left, y: rect.bottom, h: rect.height});
            },
            isTaskCycle: event => matchHotKey(window.siyuan.config.keymap.editor.list.checkToggle, event),
            onRootTitleChange: title => this.metadata(metadata => {
                metadata.rootTitle = title;
            }),
            onMove: (id, target, placement) => this.change(() => moveListMindmapNode(list, id, target, placement)),
            onAdd: async (id, kind) => {
                const target = this.model.nodes.get(id);
                if (!target) {
                    return;
                }
                const item = genListItemElement(target.element || list);
                if (!await this.change(() => addListMindmapNode(list, id, kind === "child" ? "child" : "after", item))) {
                    return;
                }
                const content = this.view.getContentHost(item.dataset.nodeId);
                if (content) {
                    this.edit(item.dataset.nodeId, content);
                }
            },
            onDelete: id => this.change(() => deleteListMindmapNode(list, id)),
            onFold: id => this.change(() => {
                const node = this.model.nodes.get(id);
                if (node?.element && !node.virtual) {
                    node.element.setAttribute("fold", node.collapsed ? "0" : "1");
                }
            }),
            onUndo: () => this.undo(false),
            onRedo: () => this.undo(true),
            onNodeStyle: (id, patch) => this.metadata(metadata => {
                metadata.nodes[id] = {...metadata.nodes[id], ...patch};
            }),
            onRelationAdd: (from, to) => this.metadata(metadata => {
                if (from !== to && !metadata.relations.some(relation => relation.from === from && relation.to === to)) {
                    metadata.relations.push({id: Lute.NewNodeID(), from, to, label: ""});
                }
            }),
            onRelationChange: (id, patch, expected) => this.metadata(metadata => {
                const relation = metadata.relations.find(item => item.id === id);
                if (!relation || (expected !== undefined && JSON.stringify(relation) !== expected)) {
                    showMessage(window.siyuan.languages.listMindmapStale);
                    return false;
                }
                if (patch.from !== undefined || patch.to !== undefined) {
                    const from = patch.from ?? relation.from;
                    const to = patch.to ?? relation.to;
                    const nodes = readListMindmap(this.list).nodes;
                    if (!nodes.has(from) || !nodes.has(to) || from === to || metadata.relations.some(item =>
                        item.id !== id && item.from === from && item.to === to)) {
                        return false;
                    }
                }
                Object.assign(relation, patch);
                if ("route" in patch && patch.route === undefined) {
                    delete relation.route;
                }
            }),
            onRelationDelete: id => this.metadata(metadata => {
                metadata.relations = metadata.relations.filter(item => item.id !== id);
            }),
        });
        list.dataset.listMindmapRendered = "true";
        this.snapshot = cleanListMindmapHTML(list.outerHTML);
        if (canEdit(owner, list)) {
            const range = focusListMindmap(list, this.host);
            if (range) {
                owner.toolbar.range = range;
            }
        }
    }

    private metadata(change: (metadata: ListMindmapMetadata) => void | false) {
        this.change(() => {
            const metadata = readListMindmap(this.list).metadata;
            if (change(metadata) === false) {
                return false;
            }
            writeListMindmapMetadata(this.list, metadata);
        });
    }

    private setTask(id: string, next: (marker: string) => string) {
        return this.queueTask(() => {
            const node = readListMindmap(this.list).nodes.get(id);
            if (node?.taskMarker === undefined) {
                return;
            }
            const marker = next(node.taskMarker);
            if (marker !== node.taskMarker) {
                setTaskListItemMarker(this.owner, node.element, marker);
                this.refresh();
            }
        });
    }

    private setTabTask(id: string, itemId: string, next: (marker: string) => string) {
        return this.queueTask(async () => {
            await this.change(() => {
                const item = getListMindmapTabItem(this.list, id, itemId);
                const marker = item && getTabTask(item);
                if (marker == null) {
                    return false;
                }
                const value = next(marker);
                if (value === marker) {
                    return false;
                }
                item.setAttribute("tabs-task", value);
            }, true);
        });
    }

    private queueTask(change: () => void | Promise<void>) {
        // 连续操作串行提交，正文保存后重新查找源节点，避免使用过期状态覆盖任务。
        this.taskChanges = this.taskChanges.then(async () => {
            if (this.disposed || !this.list.isConnected || !canEdit(this.owner, this.list) ||
                (this.activeEditor && !await this.activeEditor.finish())) {
                return;
            }
            if (this.disposed || !this.list.isConnected || !canEdit(this.owner, this.list)) {
                return;
            }
            await change();
        }).catch(error => {
            console.error(error);
            showMessage(window.siyuan.languages.listMindmapInvalid);
        });
        return this.taskChanges;
    }

    private async change(change: () => unknown, editing = false) {
        if (this.disposed || !this.list.isConnected || !canEdit(this.owner, this.list)) {
            return false;
        }
        if (!editing && this.activeEditor && !await this.activeEditor.finish()) {
            return false;
        }
        if (this.disposed || !this.list.isConnected || !canEdit(this.owner, this.list)) {
            return false;
        }
        const before = cleanListMindmapHTML(this.list.outerHTML);
        try {
            if (change() === false) {
                return false;
            }
            updateTransaction(this.owner, this.list, before);
            this.refresh();
            return true;
        } catch (error) {
            console.error(error);
            showMessage(window.siyuan.languages.listMindmapInvalid);
            return false;
        }
    }

    private async edit(id: string, host: HTMLElement) {
        const request = ++this.editRequest;
        if (!canEdit(this.owner, this.list) || (this.activeEditor && !await this.activeEditor.finish()) ||
            request !== this.editRequest || this.disposed || !host.isConnected) {
            return;
        }
        const node = this.model.nodes.get(id);
        if (!node || node.virtual) {
            return;
        }
        this.view.setEditing(id);
        this.activeEditor = openListMindmapEditor({
            owner: this.owner, node, host,
            canEdit: () => !this.disposed && this.list.isConnected && canEdit(this.owner, this.list),
            onSave: html => this.change(() => replaceListMindmapContent(this.list, id, html), true),
            onResize: () => this.view.refreshLayout(),
            onFinish: () => {
                this.activeEditor = undefined;
                this.view.setEditing(undefined);
                if (!this.disposed) {
                    this.view.update(this.model);
                }
            },
            onUndo: redo => this.undo(redo),
        });
        if (!this.activeEditor) {
            this.view.setEditing(undefined);
            this.view.update(this.model);
        }
    }

    private async undo(redo: boolean) {
        if (!canEdit(this.owner, this.list) || (this.activeEditor && !await this.activeEditor.finish())) {
            return;
        }
        if (redo) {
            this.owner.undo.redo(this.owner);
        } else {
            this.owner.undo.undo(this.owner);
        }
    }

    public refresh() {
        this.view.setReadOnly(!canEdit(this.owner, this.list));
        const snapshot = cleanListMindmapHTML(this.list.outerHTML);
        if (snapshot === this.snapshot) {
            return;
        }
        this.model = readListMindmap(this.list);
        this.snapshot = snapshot;
        this.view.update(this.model);
    }

    public destroy() {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        const restoreFocus = this.host.contains(document.activeElement) && this.list.isConnected &&
            this.list.getAttribute(Constants.CUSTOM_SY_LIST_MINDMAP) !== "1";
        this.activeEditor?.destroy();
        this.view.destroy();
        this.host.remove();
        this.list.removeAttribute("data-list-mindmap-rendered");
        if (restoreFocus) {
            focusBlock(this.list);
        }
    }
}

// 补齐折叠隐藏的正文后才允许改动列表，避免以局部视图覆盖完整块树。
const completeList = async (owner: IProtyle, list: HTMLElement) => {
    await owner.wysiwyg.flushPendingInput();
    await waitForPendingTransactions(owner);
    if (!list.isConnected) {
        return "failed";
    }
    const before = cleanListMindmapHTML(list.outerHTML);
    const response = await fetchSyncPost("/api/block/getBlockDOM", {id: list.dataset.nodeId, notebook: owner.notebookId});
    if (response.code !== 0 || !list.isConnected) {
        return "failed";
    }
    if (cleanListMindmapHTML(list.outerHTML) !== before) {
        return "changed";
    }
    const template = document.createElement("template");
    template.innerHTML = normalizeHTMLAssetIFrameBlockDOM(response.data?.dom || "");
    const full = template.content.firstElementChild;
    if (full?.getAttribute("data-type") !== "NodeList" || full.getAttribute("data-node-id") !== list.dataset.nodeId) {
        return "failed";
    }
    const completed = completeTabsListSource(list, full);
    list.replaceChildren(...Array.from(completed.childNodes));
    return "complete";
};

export const initListMindmaps = (owner: IProtyle) => {
    if (owner.lite || roots.has(owner)) {
        return;
    }
    const root = owner.wysiwyg.element;
    const instances = new Map<HTMLElement, ListMindmapController>();
    const loading = new WeakSet<HTMLElement>();
    let frame = 0;
    let disposed = false;
    const refresh = () => {
        if (disposed) {
            return;
        }
        const lists = new Set(getListMindmapElements(root));
        instances.forEach((instance, list) => {
            if (!lists.has(list)) {
                instance.destroy();
                instances.delete(list);
            } else {
                try {
                    instance.refresh();
                } catch (error) {
                    console.error(error);
                    instance.destroy();
                    instances.delete(list);
                }
            }
        });
        lists.forEach(list => {
            if (instances.has(list) || loading.has(list)) {
                return;
            }
            const mount = () => {
                if (disposed || !root.contains(list) || list.getAttribute(Constants.CUSTOM_SY_LIST_MINDMAP) !== "1") {
                    return;
                }
                try {
                    instances.set(list, new ListMindmapController(owner, list));
                } catch (error) {
                    console.error(error);
                    list.querySelector(":scope > .list-mindmap")?.remove();
                    list.removeAttribute("data-list-mindmap-rendered");
                }
            };
            if (canEdit(owner, list)) {
                loading.add(list);
                let retry = false;
                void completeList(owner, list).then(complete => {
                    if (complete === "complete") {
                        mount();
                    } else if (complete === "changed") {
                        retry = true;
                    }
                }).catch(error => console.error(error)).finally(() => {
                    loading.delete(list);
                    if (retry) {
                        schedule();
                    }
                });
            } else {
                mount();
            }
        });
    };
    const schedule = () => {
        if (!frame && !disposed) {
            frame = requestAnimationFrame(() => {
                frame = 0;
                refresh();
            });
        }
    };
    const unregister = registerListMindmapRoot(root, schedule);
    const observer = new MutationObserver(records => {
        if (records.some(record => {
            const element = record.target instanceof Element ? record.target : record.target.parentElement;
            return !element?.closest(".list-mindmap") && !(record.type === "attributes" &&
                ["data-list-mindmap-rendered", Constants.ATTRIBUTE_EDITING].includes(record.attributeName));
        })) {
            schedule();
        }
    });
    observer.observe(root, {childList: true, subtree: true, attributes: true, characterData: true});
    roots.set(owner, {refresh: schedule, destroy: () => {
        disposed = true;
        unregister();
        observer.disconnect();
        cancelAnimationFrame(frame);
        instances.forEach(instance => instance.destroy());
        instances.clear();
    }});
    schedule();
};

export const destroyListMindmaps = (owner: IProtyle) => {
    roots.get(owner)?.destroy();
    roots.delete(owner);
};
