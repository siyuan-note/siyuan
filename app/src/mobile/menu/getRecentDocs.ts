import {fetchPost} from "../../util/fetch";
import {unicode2Emoji} from "../../emoji";
import {Constants} from "../../constants";
import {escapeHtml} from "../../util/escape";
import {hasClosestByClassName} from "../../protyle/util/hasClosest";
import {openModel} from "./model";
import {openMobileFileById} from "../editor";
import {App} from "../../index";

export const getRecentDocs = (app: App) => {
    fetchPost("/api/storage/getRecentDocs", {sortBy: "viewedAt"}, (response) => {
        let html = "";
        response.data.forEach((item: any, index: number) => {
            html += `<li data-index="${index}" data-node-id="${item.rootID}" class="b3-list-item${index === 0 ? " b3-list-item--focus" : ""}">
${unicode2Emoji(item.icon || window.siyuan.storage[Constants.LOCAL_IMAGES].file, "b3-list-item__graphic", true)}
<span class="b3-list-item__text">${escapeHtml(item.title)}</span>
</li>`;
        });
        openModel({
            title: window.siyuan.languages.recentDocs,
            icon: "iconList",
            html: `<ul class="b3-list b3-list--mobile">${html}</ul>`,
            bindEvent(element: HTMLElement) {
                element.firstElementChild.addEventListener("click", (event) => {
                    const liElement = hasClosestByClassName(event.target as HTMLElement, "b3-list-item");
                    if (liElement) {
                        openMobileFileById(app, liElement.dataset.nodeId, [Constants.CB_GET_SCROLL]);
                    }
                });
            }
        });
    });
};
