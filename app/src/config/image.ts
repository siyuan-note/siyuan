import {escapeHtml} from "../util/escape";
import {confirmDialog} from "../dialog/confirmDialog";
import {pathPosix} from "../util/pathName";
import {isBrowser} from "../util/functions";
import {hasClosestByClassName} from "../protyle/util/hasClosest";
import {fetchPost} from "../util/fetch";
import {getAllModels} from "../layout/getAll";
import {openBy} from "../editor/util";
import {renderAssetsPreview} from "../asset/renderAssets";
import {writeText} from "../protyle/util/compatibility";

export const image = {
    element: undefined as Element,
    genHTML: () => {
        return `<div class="fn__flex-column" style="height: 100%">
    <div class="layout-tab-bar fn__flex">
        <div class="item item--full item--focus" data-type="remove">
            <span class="fn__flex-1"></span>
            <span class="item__text">${window.siyuan.languages.unreferencedAssets}</span>
            <span class="fn__flex-1"></span>
        </div>
        <div class="item item--full" data-type="missing">
            <span class="fn__flex-1"></span>
            <span class="item__text">${window.siyuan.languages.missingAssets}</span>
            <span class="fn__flex-1"></span>
        </div>
    </div>
    <div class="fn__flex-1">
        <div class="config-assets" data-type="remove" data-init="true">
            <div class="fn__hr--b"></div>
            <label class="fn__flex">
                <div class="fn__space"></div>
                <button id="removeAll" class="b3-button b3-button--outline fn__flex-center fn__size200">
                    <svg class="svg"><use xlink:href="#iconTrashcan"></use></svg>
                    ${window.siyuan.languages.delete}
                </button>
            </label>
            <div class="fn__hr"></div>
            <ul class="b3-list b3-list--background config-assets__list">
                <li class="fn__loading"><img src="/stage/loading-pure.svg"></li>
            </ul>
            <div class="config-assets__preview"></div>
        </div>
        <div class="fn__none config-assets" data-type="missing">
            <div class="fn__hr"></div>
            <ul class="b3-list b3-list--background config-assets__list">
                <li class="fn__loading"><img src="/stage/loading-pure.svg"></li>
            </ul>
            <div class="fn__hr"></div>
        </div>
    </div>
</div>`;
    },
    bindEvent: () => {
        const assetsListElement = image.element.querySelector(".config-assets__list");
        image.element.addEventListener("click", (event) => {
            let target = event.target as HTMLElement;
            while (target && !target.isEqualNode(image.element)) {
                const type = target.getAttribute("data-type");
                if (target.id === "removeAll") {
                    confirmDialog(window.siyuan.languages.deleteOpConfirm, `${window.siyuan.languages.clearAll}`, () => {
                        fetchPost("/api/asset/removeUnusedAssets", {}, response => {
                            getAllModels().asset.forEach(item => {
                                if (response.data.paths.includes(item.path)) {
                                    item.parent.close();
                                }
                            });
                            assetsListElement.innerHTML = `<li class="b3-list--empty">${window.siyuan.languages.emptyContent}</li>`;
                            image.element.querySelector(".config-assets__preview").innerHTML = "";
                        });
                    });
                } else if (target.classList.contains("item") && !target.classList.contains("item--focus")) {
                    image.element.querySelector(".layout-tab-bar .item--focus").classList.remove("item--focus");
                    target.classList.add("item--focus");
                    image.element.querySelectorAll(".config-assets").forEach(item => {
                        if (type === item.getAttribute("data-type")) {
                            item.classList.remove("fn__none");
                            if (!item.getAttribute("data-init")) {
                                fetchPost("/api/asset/getMissingAssets", {}, response => {
                                    image._renderList(response.data.missingAssets, item.querySelector(".config-assets__list"), false);
                                });
                                item.setAttribute("data-init", "true");
                            }
                        } else {
                            item.classList.add("fn__none");
                        }
                    });
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "copy") {
                    writeText(target.parentElement.querySelector(".b3-list-item__text").textContent.trim());
                } else if (type === "open") {
                    /// #if !BROWSER
                    openBy(target.parentElement.getAttribute("data-path"), "folder");
                    /// #endif
                } else if (type === "clear") {
                    const pathString = target.parentElement.getAttribute("data-path");
                    confirmDialog(window.siyuan.languages.deleteOpConfirm, `${window.siyuan.languages.delete} <b>${pathPosix().basename(pathString)}</b>`, () => {
                        fetchPost("/api/asset/removeUnusedAsset", {
                            path: pathString,
                        }, response => {
                            getAllModels().asset.forEach(item => {
                                if (response.data.path === item.path) {
                                    item.parent.parent.removeTab(item.parent.id);
                                }
                            });
                            const liElement = target.parentElement;
                            if (liElement.parentElement.querySelectorAll("li").length === 1) {
                                liElement.parentElement.innerHTML = `<li class="b3-list--empty">${window.siyuan.languages.emptyContent}</li>`;
                            } else {
                                liElement.remove();
                            }
                            image.element.querySelector(".config-assets__preview").innerHTML = "";
                        });
                    });
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                }
                target = target.parentElement;
            }
        });

        assetsListElement.addEventListener("mouseover", (event) => {
            const liElement = hasClosestByClassName(event.target as Element, "b3-list-item");
            if (liElement && liElement.getAttribute("data-path") !== assetsListElement.nextElementSibling.getAttribute("data-path")) {
                const item = liElement.getAttribute("data-path");
                assetsListElement.nextElementSibling.setAttribute("data-path", item);
                assetsListElement.nextElementSibling.innerHTML = renderAssetsPreview(item);
            }
        });
        fetchPost("/api/asset/getUnusedAssets", {}, response => {
            image._renderList(response.data.unusedAssets, assetsListElement);
        });
    },
    _renderList: (data: string[], element: Element, action = true) => {
        let html = "";
        let boxOpenHTML = "";
        if (!isBrowser() && action) {
            boxOpenHTML = `<span data-type="open" class="b3-tooltips b3-tooltips__w b3-list-item__action" aria-label="${window.siyuan.languages.showInFolder}">
    <svg><use xlink:href="#iconFolder"></use></svg>
</span>`;
        }
        let boxClearHTML = "";
        if (action) {
            boxClearHTML = `<span data-type="clear" class="b3-tooltips b3-tooltips__w b3-list-item__action" aria-label="${window.siyuan.languages.delete}">
    <svg><use xlink:href="#iconTrashcan"></use></svg>
</span>`;
        } else {
            boxClearHTML = `<span data-type="copy" class="b3-tooltips b3-tooltips__w b3-list-item__action" aria-label="${window.siyuan.languages.copy}">
    <svg><use xlink:href="#iconCopy"></use></svg>
</span>`;
        }
        data.forEach((item) => {
            const idx = item.indexOf("assets/");
            const dataPath = item.substr(idx);
            html += `<li data-path="${dataPath}"  class="b3-list-item b3-list-item--hide-action">
    <span class="b3-list-item__text">${escapeHtml(item)}</span>
    ${boxOpenHTML}
    ${boxClearHTML}
</li>`;
        });
        element.innerHTML = html || `<li class="b3-list--empty">${window.siyuan.languages.emptyContent}</li>`;
    }
};
