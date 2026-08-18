import {fetchPost} from "../../util/fetch";
import {unicode2Emoji} from "../../emoji";
import {Constants} from "../../constants";
import {escapeHtml} from "../../util/escape";
import {hasClosestByClassName} from "../../protyle/util/hasClosest";
import {openModel} from "./model";
import {openMobileFileById} from "../editor";
import type {App} from "../../index";
import {setStorageVal} from "../../protyle/util/compatibility";

interface IRecentDoc {
    rootID: string;
    icon: string;
    title: string;
}

const renderRecentDocs = (data: IRecentDoc[], element: HTMLElement, key = "") => {
    let html = "";
    data.forEach((item) => {
        if (!key || item.title.toLowerCase().includes(key.toLowerCase())) {
            html += `<li data-node-id="${item.rootID}" class="b3-list-item">
${unicode2Emoji(item.icon || window.siyuan.storage[Constants.LOCAL_IMAGES].file, "b3-list-item__graphic", true)}
<span class="b3-list-item__text">${escapeHtml(item.title)}</span>
</li>`;
        }
    });
    element.innerHTML = html;
};

export const getRecentDocs = (app: App) => {
    const sortBy = window.siyuan.storage[Constants.LOCAL_RECENT_DOCS].type as TRecentDocsSort;
    fetchPost("/api/storage/getRecentDocs", {sortBy}, (response) => {
        let recentDocs = response.data as IRecentDoc[];
        openModel({
            title: window.siyuan.languages.recentDocs,
            icon: "iconList",
            html: `<div class="fn__flex-column" style="height: 100%">
    <div class="toolbar toolbar--border" style="padding: 8px">
        <input placeholder="${window.siyuan.languages.searchPlaceholder}" class="b3-text-field fn__flex-1" autocomplete="off" autocorrect="off" spellcheck="false">
        <span class="fn__space"></span>
        <select class="b3-select" id="recentDocsSort">
            <option value="viewedAt">${window.siyuan.languages.recentViewed}</option>
            <option value="updated">${window.siyuan.languages.recentModified}</option>
            <option value="openAt">${window.siyuan.languages.recentOpened}</option>
            <option value="closedAt">${window.siyuan.languages.recentClosed}</option>
        </select>
    </div>
    <ul class="b3-list b3-list--mobile fn__flex-1"></ul>
</div>`,
            bindEvent(element: HTMLElement) {
                const listElement = element.querySelector("ul");
                const searchElement = element.querySelector("input");
                const sortSelect = element.querySelector("#recentDocsSort") as HTMLSelectElement;
                sortSelect.value = sortBy;
                searchElement.addEventListener("compositionend", () => {
                    renderRecentDocs(recentDocs, listElement, searchElement.value);
                });
                searchElement.addEventListener("input", (event: InputEvent) => {
                    if (!event.isComposing) {
                        renderRecentDocs(recentDocs, listElement, searchElement.value);
                    }
                });
                let sortRequestId = 0;
                sortSelect.addEventListener("change", () => {
                    const newSortBy = sortSelect.value as TRecentDocsSort;
                    const requestId = ++sortRequestId;
                    fetchPost("/api/storage/getRecentDocs", {sortBy: newSortBy}, (newResponse) => {
                        if (requestId !== sortRequestId) {
                            return;
                        }
                        recentDocs = newResponse.data as IRecentDoc[];
                        renderRecentDocs(recentDocs, listElement, searchElement.value);
                    });
                    window.siyuan.storage[Constants.LOCAL_RECENT_DOCS].type = newSortBy;
                    setStorageVal(Constants.LOCAL_RECENT_DOCS, window.siyuan.storage[Constants.LOCAL_RECENT_DOCS]);
                });
                listElement.addEventListener("click", (event) => {
                    const liElement = hasClosestByClassName(event.target as HTMLElement, "b3-list-item");
                    if (liElement) {
                        openMobileFileById(app, liElement.dataset.nodeId, [Constants.CB_GET_SCROLL]);
                    }
                });
                renderRecentDocs(recentDocs, listElement);
            }
        });
    });
};
