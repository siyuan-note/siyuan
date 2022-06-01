import {Layout} from "./index";
import {Wnd} from "./Wnd";
import {mountHelp, newNotebook} from "../util/mount";
import {Tab} from "./Tab";
import {Model} from "./Model";
import {Graph} from "./dock/Graph";
import {Editor} from "../editor";
import {Files} from "./dock/Files";
import {setPadding} from "../protyle/ui/initUI";
import {newFile} from "../util/newFile";
import {Outline} from "./dock/Outline";
import {Bookmark} from "./dock/Bookmark";
import {updateHotkeyTip} from "../protyle/util/compatibility";
import {Backlinks} from "./dock/Backlinks";
import {Tag} from "./dock/Tag";
import {getAllModels} from "./getAll";
import {Asset} from "../asset";
import {Search} from "../search";
import {Dock} from "./dock";
import {focusByRange} from "../protyle/util/selection";
import {hideElements} from "../protyle/ui/hideElements";
import {fetchPost} from "../util/fetch";
import {hasClosestBlock} from "../protyle/util/hasClosest";
import {getContenteditableElement} from "../protyle/wysiwyg/getBlock";
import {updatePanelByEditor} from "../editor/util";
import {Constants} from "../constants";
import {openSearch} from "../search/spread";

export const setPanelFocus = (element: Element) => {
    if (element.classList.contains("block__icons--active") || element.classList.contains("layout__wnd--active")) {
        return;
    }
    document.querySelectorAll(".block__icons--active").forEach(item => {
        item.classList.remove("block__icons--active");
    });
    document.querySelectorAll(".layout__wnd--active").forEach(item => {
        item.classList.remove("layout__wnd--active");
    });
    if (element.classList.contains("block__icons")) {
        element.classList.add("block__icons--active");
        const blockElement = hasClosestBlock(document.activeElement);
        if (blockElement) {
            const editElement = getContenteditableElement(blockElement) as HTMLElement;
            if (editElement) {
                editElement.blur();
            }
        }
    } else {
        element.classList.add("layout__wnd--active");
    }
};

export const getDockByType = (type: TDockType) => {
    if (!window.siyuan.layout.leftDock) {
        return undefined;
    }
    if (window.siyuan.layout.leftDock.data[type]) {
        return window.siyuan.layout.leftDock;
    }
    if (window.siyuan.layout.rightDock.data[type]) {
        return window.siyuan.layout.rightDock;
    }
    if (window.siyuan.layout.bottomDock.data[type]) {
        return window.siyuan.layout.bottomDock;
    }
    if (window.siyuan.layout.topDock.data[type]) {
        return window.siyuan.layout.topDock;
    }
};

export const switchWnd = (newWnd: Wnd, targetWnd: Wnd) => {
    newWnd.element.after(targetWnd.element);
    // 分割线
    newWnd.element.after(newWnd.element.previousElementSibling);
    newWnd.parent.children.find((item, index) => {
        if (item.id === newWnd.id) {
            const tempResize = newWnd.parent.children[index].resize;
            newWnd.parent.children[index].resize = newWnd.parent.children[index - 1].resize;
            newWnd.parent.children[index - 1].resize = tempResize;
            const temp = item;
            newWnd.parent.children[index] = newWnd.parent.children[index - 1];
            newWnd.parent.children[index - 1] = temp;
            return true;
        }
    });
};

export const getWndByLayout: (layout: Layout) => Wnd = (layout: Layout) => {
    for (let i = 0; i < layout.children.length; i++) {
        const item = layout.children[i];
        if (item instanceof Wnd) {
            return item;
        } else {
            return getWndByLayout(item);
        }
    }
};

const dockToJSON = (dock: Dock) => {
    const json = [];
    const subDockToJSON = (index: number) => {
        const data: IDockTab[] = [];
        dock.element.querySelectorAll(`span[data-index="${index}"]`).forEach(item => {
            data.push({
                type: item.getAttribute("data-type") as TDockType,
                size: {
                    height: parseInt(item.getAttribute("data-height")),
                    width: parseInt(item.getAttribute("data-width")),
                },
                show: item.classList.contains("dock__item--active"),
                icon: item.querySelector("use").getAttribute("xlink:href").substring(1),
                hotkeyLangId: item.getAttribute("data-hotkeylangid")
            });
        });
        return data;
    };
    const data0 = subDockToJSON(0);
    if (data0.length > 0) {
        json.push(data0);
    }
    const data2 = subDockToJSON(1);
    if (data2.length > 0) {
        json.push(data2);
    }
    return json;
};

export const exportLayout = (reload: boolean, cb?: () => void) => {
    const useElement = document.querySelector("#barDock use");
    if (!useElement) {
        return;
    }
    const layoutJSON: any = {
        hideDock: useElement.getAttribute("xlink:href") === "#iconDock",
        layout: {},
        top: dockToJSON(window.siyuan.layout.topDock),
        bottom: dockToJSON(window.siyuan.layout.bottomDock),
        left: dockToJSON(window.siyuan.layout.leftDock),
        right: dockToJSON(window.siyuan.layout.rightDock),
    };
    layoutToJSON(window.siyuan.layout.layout, layoutJSON.layout);
    fetchPost("/api/system/setUILayout", {layout: layoutJSON, exit: typeof cb !== "undefined"}, () => {
        if (reload) {
            window.location.reload();
        } else if (cb) {
            cb();
        }
    });
};

const JSONToDock = (json: any) => {
    window.siyuan.layout.centerLayout = window.siyuan.layout.layout.children[1].children[1] as Layout;
    window.siyuan.layout.topDock = new Dock({position: "Top", data: json.top});
    window.siyuan.layout.leftDock = new Dock({position: "Left", data: json.left});
    window.siyuan.layout.rightDock = new Dock({position: "Right", data: json.right});
    window.siyuan.layout.bottomDock = new Dock({position: "Bottom", data: json.bottom});
};

const JSONToCenter = (json: any, layout?: Layout | Wnd | Tab | Model) => {
    let child: Layout | Wnd | Tab | Model;
    if (json.instance === "Layout") {
        if (!layout) {
            window.siyuan.layout.layout = new Layout({element: document.getElementById("layouts")});
        } else {
            child = new Layout({
                direction: json.direction,
                size: json.size,
                type: json.type,
                resize: json.resize
            });
            (layout as Layout).addLayout(child);
        }
    } else if (json.instance === "Wnd") {
        child = new Wnd(json.resize, (layout as Layout).type);
        (layout as Layout).addWnd(child);
        if (json.width) {
            child.element.classList.remove("fn__flex-1");
            child.element.style.width = json.width;
        }
        if (json.height) {
            child.element.classList.remove("fn__flex-1");
            child.element.style.height = json.height;
        }
    } else if (json.instance === "Tab") {
        if (!json.title) {
            child = newCenterEmptyTab();
        } else {
            let title = json.title;
            if (json.lang) {
                title = window.siyuan.languages[json.lang];
            }
            child = new Tab({
                icon: json.icon,
                docIcon: json.docIcon,
                title
            });
        }
        if (json.pin) {
            child.headElement.classList.add("item--pin");
            if (json.docIcon || json.icon) {
                child.headElement.querySelector(".item__text").classList.add("fn__none");
            }
        }
        if (json.active) {
            child.headElement.setAttribute("data-init-active", "true");
        }
        (layout as Wnd).addTab(child);
    } else if (json.instance === "Editor" && json.blockId) {
        (layout as Tab).addModel(new Editor({
            tab: (layout as Tab),
            blockId: json.blockId,
            mode: json.mode,
            action: [json.action]
        }));
    } else if (json.instance === "Asset") {
        (layout as Tab).addModel(new Asset({
            tab: (layout as Tab),
            path: json.path,
        }));
    } else if (json.instance === "Backlinks") {
        (layout as Tab).addModel(new Backlinks({
            tab: (layout as Tab),
            blockId: json.blockId,
            rootId: json.rootId,
            type: json.type,
        }));
    } else if (json.instance === "Bookmark") {
        (layout as Tab).addModel(new Bookmark((layout as Tab)));
    } else if (json.instance === "Files") {
        (layout as Tab).addModel(new Files({
            tab: (layout as Tab),
        }));
    } else if (json.instance === "Graph") {
        (layout as Tab).addModel(new Graph({
            tab: (layout as Tab),
            blockId: json.blockId,
            rootId: json.rootId,
            type: json.type
        }));
    } else if (json.instance === "Outline") {
        (layout as Tab).addModel(new Outline({
            tab: (layout as Tab),
            blockId: json.blockId,
            type: json.type
        }));
    } else if (json.instance === "Tag") {
        (layout as Tab).addModel(new Tag((layout as Tab)));
    } else if (json.instance === "search") {
        (layout as Tab).addModel(new Search({
            tab: (layout as Tab),
            text: json.text
        }));
    }
    if (json.children) {
        if (Array.isArray(json.children)) {
            json.children.forEach((item: any, index: number) => {
                JSONToCenter(item, layout ? child : window.siyuan.layout.layout);
                if (item.instance === "Tab" && index === json.children.length - 1) {
                    const activeTabElement = (child as Wnd).headersElement.querySelector('[data-init-active="true"]') as HTMLElement;
                    if (activeTabElement) {
                        activeTabElement.removeAttribute("data-init-active");
                        (child as Wnd).switchTab(activeTabElement, false, false);
                    }
                }
            });
        } else {
            JSONToCenter(json.children, child);
        }
    }
};

export const JSONToLayout = () => {
    JSONToCenter(window.siyuan.config.uiLayout.layout);
    JSONToDock(window.siyuan.config.uiLayout);
    setTimeout(() => {
        getAllModels().editor.find(item => {
            if (item.headElement.classList.contains("item--focus")) {
                updatePanelByEditor(item.editor.protyle, false, false);
                return true;
            }
        });
    }, 520);
};

export const layoutToJSON = (layout: Layout | Wnd | Tab | Model, json: any) => {
    if (layout instanceof Layout) {
        json.direction = layout.direction;
        if (layout.parent) {
            if (layout.element.classList.contains("fn__flex-1")) {
                json.size = "auto";
            } else {
                json.size = (layout.parent.direction === "tb" ? layout.element.clientHeight : layout.element.clientWidth) + "px";
            }
        }
        json.resize = layout.resize;
        json.type = layout.type;
        json.instance = "Layout";
    } else if (layout instanceof Wnd) {
        json.resize = layout.resize;
        json.height = layout.element.style.height;
        json.width = layout.element.style.width;
        json.instance = "Wnd";
    } else if (layout instanceof Tab) {
        if (layout.headElement) {
            json.title = layout.title;
            json.icon = layout.icon;
            json.docIcon = layout.docIcon;
            json.pin = layout.headElement.classList.contains("item--pin");
            if (layout.model instanceof Files) {
                json.lang = "fileTree";
            } else if (layout.model instanceof Backlinks && layout.model.type === "pin") {
                json.lang = "backlinks";
            } else if (layout.model instanceof Bookmark) {
                json.lang = "bookmark";
            } else if (layout.model instanceof Graph && layout.model.type !== "local") {
                json.lang = "graphView";
            } else if (layout.model instanceof Outline && layout.model.type !== "local") {
                json.lang = "outline";
            } else if (layout.model instanceof Tag) {
                json.lang = "tag";
            }
            if (layout.headElement.classList.contains("item--focus")) {
                json.active = true;
            }
        }
        json.instance = "Tab";
    } else if (layout instanceof Editor) {
        json.blockId = layout.editor.protyle.block.id;
        json.mode = layout.editor.protyle.preview.element.classList.contains("fn__none") ? "wysiwyg" : "preview";
        json.action = layout.editor.protyle.block.showAll ? Constants.CB_GET_ALL : "";
        json.instance = "Editor";
    } else if (layout instanceof Asset) {
        json.path = layout.path;
        json.instance = "Asset";
    } else if (layout instanceof Backlinks) {
        json.blockId = layout.blockId;
        json.rootId = layout.rootId;
        json.type = layout.type;
        json.instance = "Backlinks";
    } else if (layout instanceof Bookmark) {
        json.instance = "Bookmark";
    } else if (layout instanceof Files) {
        json.instance = "Files";
    } else if (layout instanceof Graph) {
        json.blockId = layout.blockId;
        json.rootId = layout.rootId;
        json.type = layout.type;
        json.instance = "Graph";
    } else if (layout instanceof Outline) {
        json.blockId = layout.blockId;
        json.type = layout.type;
        json.instance = "Outline";
    } else if (layout instanceof Tag) {
        json.instance = "Tag";
    } else if (layout instanceof Search) {
        json.instance = "search";
        json.text = layout.text;
    }

    if (layout instanceof Layout || layout instanceof Wnd) {
        if (layout instanceof Layout &&
            (layout.type === "top" || layout.type === "bottom" || layout.type === "left" || layout.type === "right")) {
            // 四周布局使用默认值，清空内容，重置时使用 dock 数据
            if (layout.type === "top" || layout.type === "bottom") {
                json.children = [{
                    "instance": "Wnd",
                    "children": []
                }, {
                    "instance": "Wnd",
                    "resize": "lr",
                    "children": []
                }];
            } else {
                json.children = [{
                    "instance": "Wnd",
                    "children": []
                }, {
                    "instance": "Wnd",
                    "resize": "tb",
                    "children": []
                }];
            }
        } else {
            json.children = [];
            layout.children.forEach((item: Layout | Wnd | Tab) => {
                const itemJSON = {};
                json.children.push(itemJSON);
                layoutToJSON(item, itemJSON);
            });
        }
    } else if (layout instanceof Tab) {
        json.children = {};
        layoutToJSON(layout.model, json.children);
    }
};

export const resizeTabs = () => {
    const models = getAllModels();
    models.editor.forEach((item) => {
        if (item.editor && item.editor.protyle && item.element.parentElement) {
            hideElements(["gutter"], item.editor.protyle);
            setTimeout(() => {
                // .layout .fn__flex-shrink {transition: width .3s ease;} 时需要再次计算 padding
                setPadding(item.editor.protyle);
            }, 200);
        }
    });
};

export const copyTab = (tab: Tab) => {
    return new Tab({
        icon: tab.icon,
        docIcon: tab.docIcon,
        title: tab.title,
        callback(newTab: Tab) {
            let model: Model;
            if (tab.model instanceof Editor) {
                model = new Editor({
                    tab: newTab,
                    blockId: tab.model.editor.protyle.block.rootID
                });
            } else if (tab.model instanceof Asset) {
                model = new Asset({
                    tab: newTab,
                    path: tab.model.path
                });
            } else if (tab.model instanceof Graph) {
                model = new Graph({
                    tab: newTab,
                    blockId: tab.model.blockId,
                    rootId: tab.model.rootId,
                    type: tab.model.type,
                });
            } else if (tab.model instanceof Files) {
                model = new Files({
                    tab: newTab
                });
            } else if (tab.model instanceof Outline) {
                model = new Outline({
                    tab: newTab,
                    blockId: tab.model.blockId,
                    type: tab.model.type
                });
            } else if (tab.model instanceof Backlinks) {
                model = new Backlinks({
                    tab: newTab,
                    blockId: tab.model.blockId,
                    rootId: tab.model.rootId,
                    type: tab.model.type
                });
            } else if (tab.model instanceof Bookmark) {
                model = new Bookmark(newTab);
            } else if (tab.model instanceof Tag) {
                model = new Tag(newTab);
            } else if (tab.model instanceof Search) {
                model = new Search({
                    tab: newTab,
                    text: tab.model.text
                });
            }
            newTab.addModel(model);
        }
    });
};

export const getInstanceById = (id: string) => {
    const _getInstanceById = (item: Layout | Wnd, id: string) => {
        if (item.id === id) {
            return item;
        }
        if (!item.children) {
            return;
        }
        let ret: Tab | Layout | Wnd;
        for (let i = 0; i < item.children.length; i++) {
            ret = _getInstanceById(item.children[i] as Layout, id) as Tab;
            if (ret) {
                return ret;
            }
        }
    };
    return _getInstanceById(window.siyuan.layout.centerLayout, id);
};

export const addResize = (obj: Layout | Wnd) => {
    if (obj.resize) {
        const resizeWnd = (resizeElement: HTMLElement, direction: string) => {
            const setSize = (item: HTMLElement, direction: string) => {
                if (item.classList.contains("fn__flex-1")) {
                    if (direction === "lr") {
                        item.style.width = item.clientWidth + "px";
                    } else {
                        item.style.height = item.clientHeight + "px";
                    }
                    item.classList.remove("fn__flex-1");
                }
            };

            let range: Range;
            resizeElement.addEventListener("mousedown", (event: MouseEvent) => {
                getAllModels().editor.forEach((item) => {
                    if (item.editor && item.editor.protyle && item.element.parentElement) {
                        hideElements(["gutter"], item.editor.protyle);
                    }
                });

                if (getSelection().rangeCount > 0) {
                    range = getSelection().getRangeAt(0);
                }
                const documentSelf = document;
                const nextElement = resizeElement.nextElementSibling as HTMLElement;
                const previousElement = resizeElement.previousElementSibling as HTMLElement;
                nextElement.style.transition = "";
                previousElement.style.transition = "";
                setSize(nextElement, direction);
                setSize(previousElement, direction);
                const x = event[direction === "lr" ? "clientX" : "clientY"];
                const previousSize = direction === "lr" ? previousElement.clientWidth : previousElement.clientHeight;
                const nextSize = direction === "lr" ? nextElement.clientWidth : nextElement.clientHeight;

                documentSelf.ondragstart = () => {
                    // 文件树拖拽会产生透明效果
                    document.querySelectorAll(".sy__file .b3-list-item").forEach((item: HTMLElement) => {
                        if (item.style.opacity === "0.1") {
                            item.style.opacity = "";
                        }
                    });
                    return false;
                };

                documentSelf.onmousemove = (moveEvent: MouseEvent) => {
                    moveEvent.preventDefault();
                    moveEvent.stopPropagation();
                    const previousNowSize = (previousSize + (moveEvent[direction === "lr" ? "clientX" : "clientY"] - x));
                    const nextNowSize = (nextSize - (moveEvent[direction === "lr" ? "clientX" : "clientY"] - x));
                    if (previousNowSize < 8 || nextNowSize < 8) {
                        return;
                    }
                    if (window.siyuan.layout.leftDock.layout.element.contains(previousElement) && previousNowSize < 188) {
                        return;
                    }
                    if (window.siyuan.layout.rightDock.layout.element.contains(nextElement) && nextNowSize < 188) {
                        return;
                    }
                    previousElement.style[direction === "lr" ? "width" : "height"] = previousNowSize + "px";
                    nextElement.style[direction === "lr" ? "width" : "height"] = nextNowSize + "px";
                };

                documentSelf.onmouseup = () => {
                    documentSelf.onmousemove = null;
                    documentSelf.onmouseup = null;
                    documentSelf.ondragstart = null;
                    documentSelf.onselectstart = null;
                    documentSelf.onselect = null;

                    if (!nextElement.nextElementSibling) {
                        if (!previousElement.previousElementSibling) {
                            nextElement.style[direction === "lr" ? "width" : "height"] = "";
                            nextElement.classList.add("fn__flex-1");
                        } else {
                            previousElement.style[direction === "lr" ? "width" : "height"] = "";
                            previousElement.classList.add("fn__flex-1");
                        }
                    } else if (nextElement.nextElementSibling?.nextElementSibling &&
                        nextElement.parentElement.lastElementChild.isSameNode(nextElement.nextElementSibling.nextElementSibling)) {
                        nextElement.style[direction === "lr" ? "width" : "height"] = "";
                        nextElement.classList.add("fn__flex-1");
                    }
                    resizeTabs();
                    window.siyuan.layout.leftDock.setSize();
                    window.siyuan.layout.topDock.setSize();
                    window.siyuan.layout.bottomDock.setSize();
                    window.siyuan.layout.rightDock.setSize();
                    if (range) {
                        focusByRange(range);
                    }
                    nextElement.style.transition = "var(--b3-width-transition)";
                    previousElement.style.transition = "var(--b3-width-transition)";
                };
            });
        };

        const resizeElement = document.createElement("div");
        if (obj.resize === "lr") {
            resizeElement.classList.add("layout__resize--lr");
        }
        resizeElement.classList.add("layout__resize");
        obj.element.insertAdjacentElement("beforebegin", resizeElement);
        obj.element.style.transition = "var(--b3-width-transition)";
        (resizeElement.previousElementSibling as HTMLElement).style.transition = "var(--b3-width-transition)";
        resizeWnd(resizeElement, obj.resize);
    }
};

export const newCenterEmptyTab = () => {
    return new Tab({
        panel: `<div class="layout__empty b3-list">
    <div class="${!window.siyuan.config.readonly ? " fn__none" : ""}">
        <div class="config-about__logo">
            <img src="/stage/icon.png">
            ${window.siyuan.languages.siyuanNote}
        </div>
        <div class="b3-label__text">${window.siyuan.languages.slogan}</div>
    </div>
    <h1>${window.siyuan.languages.noOpenFile}</h1>
    <div class="fn__hr"></div>
    <div class="fn__hr"></div>
    <div class="b3-list-item" id="editorEmptySearch"><svg class="b3-list-item__graphic"><use xlink:href="#iconSearch"></use></svg><span>${window.siyuan.languages.search}</span><span class="b3-list-item__meta">${updateHotkeyTip(window.siyuan.config.keymap.general.globalSearch.custom)}</span></div>
    <div class="b3-list-item${window.siyuan.config.readonly ? " fn__none" : ""}" id="editorEmptyFile"><svg class="b3-list-item__graphic"><use xlink:href="#iconFile"></use></svg><span>${window.siyuan.languages.newFile}</span><span class="b3-list-item__meta">${updateHotkeyTip(window.siyuan.config.keymap.general.newFile.custom)}</span></div>
    <div class="b3-list-item${window.siyuan.config.readonly ? " fn__none" : ""}" id="editorEmptyNewNotebook"><svg class="b3-list-item__graphic"><use xlink:href="#iconFilesRoot"></use></svg><span>${window.siyuan.languages.newNotebook}</span></div>
    <div class="b3-list-item" id="editorEmptyHelp"><svg class="b3-list-item__graphic"><use xlink:href="#iconHelp"></use></svg><span>${window.siyuan.languages.help}</span></div>
</div>`,
        callback(tab: Tab) {
            tab.panelElement.querySelector("#editorEmptyHelp").addEventListener("click", () => {
                mountHelp();
            });
            tab.panelElement.querySelector("#editorEmptySearch").addEventListener("click", () => {
                openSearch(window.siyuan.config.keymap.general.globalSearch.custom);
            });
            if (!window.siyuan.config.readonly) {
                tab.panelElement.querySelector("#editorEmptyNewNotebook").addEventListener("click", () => {
                    newNotebook();
                });
                tab.panelElement.querySelector("#editorEmptyFile").addEventListener("click", () => {
                    newFile(undefined, undefined, true);
                });
            }
        }
    });
};
