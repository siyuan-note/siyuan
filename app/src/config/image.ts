import {escapeHtml} from "../util/escape";
import {confirmDialog} from "../dialog/confirmDialog";
import {isBrowser, isMobile} from "../util/functions";
import {hasClosestByClassName} from "../protyle/util/hasClosest";
import {fetchPost} from "../util/fetch";
/// #if !MOBILE
import {getAllModels} from "../layout/getAll";
import * as path from "path";
/// #endif
import {openBy} from "../editor/util";
import {renderAssetsPreview} from "../asset/renderAssets";
import {writeText} from "../protyle/util/compatibility";
import {Constants} from "../constants";
import {showMessage} from "../dialog/message";
import {Protyle} from "../protyle";
import {App} from "../index";
import {disabledProtyle, onGet} from "../protyle/util/onGet";
import {removeLoading} from "../protyle/ui/initUI";

export const image = {
    element: undefined as Element,
    genHTML: () => {
        const isM = isMobile();
        return `<div class="fn__flex-column" style="height: 100%">
    <div class="layout-tab-bar fn__flex">
        <div class="item item--full item--focus" data-type="remove">
            <span class="fn__flex-1"></span>
            <span class="item__text">${window.siyuan.languages.unreferencedAssets}</span>
            <span class="fn__flex-1"></span>
        </div>
        <div class="item item--full" data-type="removeAV">
            <span class="fn__flex-1"></span>
                <span class="item__text">${window.siyuan.languages.unreferencedAV}</span>
            <span class="fn__flex-1"></span>
        </div>
        <div class="item item--full" data-type="missing">
            <span class="fn__flex-1"></span>
            <span class="item__text">${window.siyuan.languages.missingAssets}</span>
            <span class="fn__flex-1"></span>
        </div>
    </div>
    <div class="fn__flex-1">
        <div class="config-assets${isM ? " b3-list--mobile" : ""}" data-type="remove" data-init="true">
            <div class="fn__hr--b"></div>
            <div class="fn__flex">
                <div class="fn__space"></div>
                <button id="removeAll" class="b3-button b3-button--outline fn__flex-center fn__size200">
                    <svg class="svg"><use xlink:href="#iconTrashcan"></use></svg>
                    ${window.siyuan.languages.delete}
                </button>
            </div>
            <div class="fn__hr"></div>
            <ul class="b3-list b3-list--background config-assets__list">
                <li class="fn__loading"><img src="/stage/loading-pure.svg"></li>
            </ul>
            <div class="config-assets__preview"></div>
        </div>
        <div class="fn__none config-assets${isM ? " b3-list--mobile" : ""}" data-type="removeAV">
            <div class="fn__hr--b"></div>
            <div class="fn__flex">
                <div class="fn__space"></div>
                <button id="removeAVAll" class="b3-button b3-button--outline fn__flex-center fn__size200">
                    <svg class="svg"><use xlink:href="#iconTrashcan"></use></svg>
                    ${window.siyuan.languages.delete}
                </button>
            </div>
            <div class="fn__hr"></div>
            <ul class="b3-list b3-list--background config-assets__list">
                <li class="fn__loading"><img src="/stage/loading-pure.svg"></li>
            </ul>
            <div class="config-assets__preview" style="display: block;padding: 8px;"></div>
        </div>
        <div class="fn__none config-assets${isM ? " b3-list--mobile" : ""}" data-type="missing">
            <div class="fn__hr"></div>
            <ul class="b3-list b3-list--background config-assets__list">
                <li class="fn__loading"><img src="/stage/loading-pure.svg"></li>
            </ul>
            <div class="fn__hr"></div>
        </div>
    </div>
</div>`;
    },
    bindEvent: (app: App) => {
        const assetsListElement = image.element.querySelector('.config-assets[data-type="remove"] .config-assets__list');
        const avListElement = image.element.querySelector('.config-assets[data-type="removeAV"] .config-assets__list');
        const editor = new Protyle(app, avListElement.nextElementSibling as HTMLElement, {
            blockId: "",
            action: [Constants.CB_GET_HISTORY],
            render: {
                background: false,
                gutter: false,
                breadcrumb: false,
                breadcrumbDocName: false,
            },
            typewriterMode: false,
        });
        disabledProtyle(editor.protyle);
        removeLoading(editor.protyle);
        image.element.addEventListener("click", (event) => {
            let target = event.target as HTMLElement;
            while (target && !target.isEqualNode(image.element)) {
                const type = target.getAttribute("data-type");
                if (target.id === "removeAll") {
                    confirmDialog(window.siyuan.languages.deleteOpConfirm, `${window.siyuan.languages.clearAll}`, () => {
                        fetchPost("/api/asset/removeUnusedAssets", {}, response => {
                            /// #if !MOBILE
                            getAllModels().asset.forEach(item => {
                                if (response.data.paths.includes(item.path)) {
                                    item.parent.close();
                                }
                            });
                            /// #endif
                            assetsListElement.innerHTML = `<li class="b3-list--empty">${window.siyuan.languages.emptyContent}</li>`;
                            assetsListElement.nextElementSibling.innerHTML = "";
                        });
                    }, undefined, true);
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (target.id === "removeAVAll") {
                    confirmDialog(window.siyuan.languages.deleteOpConfirm, `${window.siyuan.languages.clearAllAV}`, () => {
                        fetchPost("/api/av/removeUnusedAttributeViews", {}, () => {
                            avListElement.innerHTML = `<li class="b3-list--empty">${window.siyuan.languages.emptyContent}</li>`;
                            avListElement.nextElementSibling.innerHTML = "";
                        });
                    }, undefined, true);
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (target.classList.contains("item") && !target.classList.contains("item--focus")) {
                    image.element.querySelector(".layout-tab-bar .item--focus").classList.remove("item--focus");
                    target.classList.add("item--focus");
                    image.element.querySelectorAll(".config-assets").forEach(item => {
                        if (type === item.getAttribute("data-type")) {
                            item.classList.remove("fn__none");
                            if (type === "remove") {
                                fetchPost("/api/asset/getUnusedAssets", {}, response => {
                                    image._renderList(response.data, assetsListElement, "unrefAssets");
                                });
                            } else if (!item.getAttribute("data-init")) {
                                if (type === "removeAV") {
                                    fetchPost("/api/av/getUnusedAttributeViews", {}, response => {
                                        image._renderList(response.data, avListElement, "unRefAV");
                                    });
                                } else {
                                    fetchPost("/api/asset/getMissingAssets", {}, response => {
                                        image._renderList(response.data, item.querySelector(".config-assets__list"), "lostAssets");
                                    });
                                }
                                item.setAttribute("data-init", "true");
                            }
                        } else {
                            item.classList.add("fn__none");
                        }
                    });
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (target.getAttribute("data-tab-type") === "unRefAV") {
                    onGet({
                        data: {
                            data: {
                                content: `<div class="av" data-node-id="${Lute.NewNodeID()}" data-av-id="${target.dataset.item}" data-type="NodeAttributeView" data-av-type="table"><div spellcheck="true"></div><div class="protyle-attr" contenteditable="false">${Constants.ZWSP}</div></div>`,
                                id: Lute.NewNodeID(),
                                rootID: Lute.NewNodeID(),
                            },
                            msg: "",
                            code: 0
                        },
                        protyle: editor.protyle,
                        action: [Constants.CB_GET_HISTORY, Constants.CB_GET_HTML],
                    });
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "copy") {
                    if (target.parentElement.getAttribute("data-tab-type") === "unRefAV") {
                        writeText(`<div class="av" data-node-id="${Lute.NewNodeID()}" data-av-id="${target.parentElement.dataset.item}" data-type="NodeAttributeView" data-av-type="table"></div>`);
                    } else {
                        writeText(target.parentElement.querySelector(".b3-list-item__text").textContent.trim());
                    }
                    showMessage(window.siyuan.languages.copied);
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "open") {
                    /// #if !BROWSER
                    if (target.parentElement.getAttribute("data-tab-type") === "unRefAV") {
                        openBy(path.join(window.siyuan.config.system.dataDir, "storage", "av", target.parentElement.dataset.item) + ".json", "folder");
                    } else {
                        openBy(target.parentElement.dataset.item, "folder");
                    }
                    /// #endif
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "clear") {
                    const liElement = target.parentElement;
                    confirmDialog(window.siyuan.languages.deleteOpConfirm, `${window.siyuan.languages.delete} <b>${liElement.querySelector(".b3-list-item__text").textContent}</b>`, () => {
                        if (liElement.getAttribute("data-tab-type") === "unRefAV") {
                            fetchPost("/api/av/removeUnusedAttributeView", {
                                id: liElement.getAttribute("data-item"),
                            }, () => {
                                if (liElement.parentElement.querySelectorAll("li").length === 1) {
                                    liElement.parentElement.innerHTML = `<li class="b3-list--empty">${window.siyuan.languages.emptyContent}</li>`;
                                } else {
                                    liElement.remove();
                                }
                                onGet({
                                    data: {
                                        data: {
                                            content: "",
                                            id: Lute.NewNodeID(),
                                            rootID: Lute.NewNodeID(),
                                        },
                                        msg: "",
                                        code: 0
                                    },
                                    protyle: editor.protyle,
                                    action: [Constants.CB_GET_HISTORY, Constants.CB_GET_HTML],
                                });
                            });
                        } else {
                            fetchPost("/api/asset/removeUnusedAsset", {
                                path: liElement.getAttribute("data-item"),
                            }, response => {
                                /// #if !MOBILE
                                getAllModels().asset.forEach(item => {
                                    if (response.data.path === item.path) {
                                        item.parent.parent.removeTab(item.parent.id);
                                    }
                                });
                                /// #endif
                                if (liElement.parentElement.querySelectorAll("li").length === 1) {
                                    liElement.parentElement.innerHTML = `<li class="b3-list--empty">${window.siyuan.languages.emptyContent}</li>`;
                                } else {
                                    liElement.remove();
                                }
                                assetsListElement.nextElementSibling.innerHTML = "";
                            });
                        }
                    }, undefined, true);
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                }
                target = target.parentElement;
            }
        });

        assetsListElement.addEventListener("mouseover", (event) => {
            const liElement = hasClosestByClassName(event.target as Element, "b3-list-item");
            if (liElement && liElement.getAttribute("data-item") !== assetsListElement.nextElementSibling.getAttribute("data-item")) {
                const item = liElement.getAttribute("data-item");
                assetsListElement.nextElementSibling.setAttribute("data-item", item);
                assetsListElement.nextElementSibling.innerHTML = renderAssetsPreview(item);
            }
        });
        fetchPost("/api/asset/getUnusedAssets", {}, response => {
            image._renderList(response.data, assetsListElement, "unrefAssets");
        });
    },
    _renderList: (data: {
        item: string,
        name: string
    }[], element: Element, type: "unRefAV" | "unrefAssets" | "lostAssets") => {
        let html = "";
        let boxOpenHTML = "";
        if (!isBrowser() && type !== "lostAssets") {
            boxOpenHTML = `<span data-type="open" class="ariaLabel b3-list-item__action" aria-label="${window.siyuan.languages.showInFolder}">
    <svg><use xlink:href="#iconFolder"></use></svg>
</span>`;
        }
        let boxClearHTML = "";
        if (type !== "lostAssets") {
            boxClearHTML = `<span data-type="clear" class="ariaLabel b3-list-item__action" aria-label="${window.siyuan.languages.delete}">
    <svg><use xlink:href="#iconTrashcan"></use></svg>
</span>`;
        }
        const isM = isMobile();
        data.forEach((item) => {
            html += `<li data-tab-type="${type}" data-item="${item.item}"  class="b3-list-item${isM ? "" : " b3-list-item--hide-action"}">
    <span class="b3-list-item__text">${escapeHtml(item.name || item.item)}</span>
    <span data-type="copy" class="ariaLabel b3-list-item__action" aria-label="${window.siyuan.languages[type === "unRefAV" ? "copyMirror" : "copy"]}">
        <svg><use xlink:href="#iconCopy"></use></svg>
    </span>
    ${boxOpenHTML}
    ${boxClearHTML}
</li>`;
        });
        element.innerHTML = html || `<li class="b3-list--empty">${window.siyuan.languages.emptyContent}</li>`;
    }
};
