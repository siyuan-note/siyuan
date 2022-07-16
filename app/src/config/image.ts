import {escapeHtml} from "../util/escape";
import {confirmDialog} from "../dialog/confirmDialog";
import {pathPosix} from "../util/pathName";
import {isBrowser} from "../util/functions";
import {hasClosestByClassName} from "../protyle/util/hasClosest";
import {fetchPost} from "../util/fetch";
import {getAllModels} from "../layout/getAll";
import {openBy} from "../editor/util";
import {renderAssetsPreview} from "../asset/renderAssets";

export const image = {
    element: undefined as Element,
    genHTML: () => {
        return `
<div class="b3-label config-assets">
    <div class="fn__flex">
        ${window.siyuan.languages.clearUnused}
        <div class="fn__flex-1"></div>
        <button id="removeAll" class="b3-button b3-button--outline fn__flex-center fn__size200">
            <svg class="svg"><use xlink:href="#iconTrashcan"></use></svg>
            ${window.siyuan.languages.delete}
        </button>
    </div>
    <div class="fn__hr"></div>
    <ul class="b3-list b3-list--background" id="assetsList">
        <li class="ft__center" style="list-style: none"><img src="/stage/loading-pure.svg"></li>
    </ul><div class="config-assets__preview"></div>
</div>`;
    },
    bindEvent: () => {
        image.element.querySelector("#removeAll").addEventListener("click", () => {
            confirmDialog(window.siyuan.languages.clearUnused,
                `${window.siyuan.languages.clearAll}`,
                () => {
                    fetchPost("/api/asset/removeUnusedAssets", {}, response => {
                        getAllModels().asset.forEach(item => {
                            if (response.data.paths.includes(item.path)) {
                                item.parent.parent.removeTab(item.parent.id);
                            }
                        });
                        fetchPost("/api/asset/getUnusedAssets", {}, response => {
                            image.onUnusedassets(response.data);
                        });
                    });
                });
        });

        const assetsListElement = image.element.querySelector("#assetsList");
        assetsListElement.addEventListener("click", (event) => {
            let target = event.target as HTMLElement;
            while (target && !target.isEqualNode(assetsListElement)) {
                if (target.classList.contains("b3-tooltips")) {
                    const pathString = target.parentElement.getAttribute("data-path");
                    const type = target.getAttribute("data-type");
                    if (type === "open") {
                        /// #if !BROWSER
                        openBy(pathString, "folder");
                        /// #endif
                    } else if (type === "clear") {
                        confirmDialog(window.siyuan.languages.clearUnused,
                            `${window.siyuan.languages.delete} <b>${pathPosix().basename(pathString)}</b>`,
                            () => {
                                fetchPost("/api/asset/removeUnusedAsset", {
                                    path: pathString,
                                }, response => {
                                    getAllModels().asset.forEach(item => {
                                        if (response.data.path === item.path) {
                                            item.parent.parent.removeTab(item.parent.id);
                                        }
                                    });
                                });
                                const liElement = target.parentElement;
                                if (liElement.parentElement.querySelectorAll("li").length === 1) {
                                    liElement.parentElement.remove();
                                } else {
                                    liElement.remove();
                                }
                                image.element.querySelector(".config-assets__preview").innerHTML = "";
                            });
                    }
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
            image.onUnusedassets(response.data);
        });
    },
    onUnusedassets: (data: { unusedAssets: string[] }) => {
        let html = "";
        let boxOpenHTML = "";
        if (!isBrowser()) {
            boxOpenHTML = `<span data-type="open" class="b3-tooltips b3-tooltips__w b3-list-item__action" aria-label="${window.siyuan.languages.showInFolder}">
    <svg><use xlink:href="#iconFolder"></use></svg>
</span>`;
        }
        const boxClearHTML = `<span data-type="clear" class="b3-tooltips b3-tooltips__w b3-list-item__action" aria-label="${window.siyuan.languages.delete}">
    <svg><use xlink:href="#iconTrashcan"></use></svg>
</span>`;
        data.unusedAssets.forEach((item) => {
            const idx = item.indexOf("assets/");
            const dataPath = item.substr(idx);
            html += `<li data-path="${dataPath}"  class="b3-list-item b3-list-item--hide-action">
    <span class="b3-list-item__text">${escapeHtml(item)}</span>
    ${boxOpenHTML}
    ${boxClearHTML}
</li>`;
        });
        image.element.querySelector("#assetsList").innerHTML = html || `<li class="b3-list--empty">${window.siyuan.languages.emptyContent}</li>`;
        image.element.querySelector(".config-assets__preview").innerHTML = "";
    }
};
