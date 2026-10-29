import {fileConfigApi} from "../../config/tabs/fileRuntime";
import {fetchPost} from "../../util/fetch";
import {getFileTreeIconHTML} from "../../emoji/fileTreeIcon";
import {Constants} from "../../constants";
import {escapeHtml} from "../../util/escape";
import {hasClosestByClassName} from "../../protyle/util/hasClosest";
import {openModel} from "./model";
import {openMobileFileById} from "../editor";
import type {App} from "../../index";
import {bindClearRecentDocs, clearRecentDocsButtonHTML} from "../../business/clearRecentDocs";

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
${getFileTreeIconHTML(item.icon, "file", "b3-list-item__graphic", true)}
<span class="b3-list-item__text">${escapeHtml(item.title)}</span>
</li>`;
        }
    });
    element.innerHTML = html;
};

export const getRecentDocs = (app: App) => {
    const sortBy = window.siyuan.config.fileTree.recentDocsSort as TRecentDocsSort;
    fetchPost("/api/storage/getRecentDocs", {sortBy}, (response) => {
        let recentDocs = response.data as IRecentDoc[];
        let active = true;
        openModel({
            title: window.siyuan.languages.recentDocs,
            icon: "iconRecentDocs",
            destroyCallback: () => { active = false; },
            html: `<div class="fn__flex-column" style="height: 100%">
    <div class="toolbar toolbar--border" style="padding: 8px">
        <input placeholder="${window.siyuan.languages.searchPlaceholder}" class="b3-text-field fn__flex-1" autocomplete="off" autocorrect="off" spellcheck="false">
        <span class="fn__space"></span>
        <select class="b3-select" id="recentDocsSort">
            <option value="viewedAt">${window.siyuan.languages.recentViewed}</option>
            <option value="created">${window.siyuan.languages.recentCreated}</option>
            <option value="updated">${window.siyuan.languages.recentModified}</option>
            <option value="openAt">${window.siyuan.languages.recentOpened}</option>
            <option value="closedAt">${window.siyuan.languages.recentClosed}</option>
        </select>
        <span class="fn__space"></span>
        ${clearRecentDocsButtonHTML()}
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
                const isActive = () => active && listElement.isConnected;
                const loadRecentDocs = () => {
                    const newSortBy = sortSelect.value as TRecentDocsSort;
                    const requestId = ++sortRequestId;
                    fetchPost("/api/storage/getRecentDocs", {sortBy: newSortBy}, (newResponse) => {
                        if (requestId !== sortRequestId || !isActive()) {
                            return;
                        }
                        recentDocs = newResponse.data as IRecentDoc[];
                        renderRecentDocs(recentDocs, listElement, searchElement.value);
                    });
                };
                const updateClearButton = bindClearRecentDocs(element.querySelector('[data-action="clear-recent-docs"]'),
                    () => sortSelect.value, isActive, () => {
                        if (!["created", "updated"].includes(sortSelect.value)) {
                            recentDocs = [];
                            renderRecentDocs(recentDocs, listElement, searchElement.value);
                        }
                        loadRecentDocs();
                    });
                sortSelect.addEventListener("change", () => {
                    const newSortBy = sortSelect.value as TRecentDocsSort;
                    updateClearButton();
                    loadRecentDocs();
                    if (!window.siyuan.config.readonly && !window.siyuan.isPublish) {
                        void fileConfigApi.patch("recentDocsSort", newSortBy);
                    }
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
