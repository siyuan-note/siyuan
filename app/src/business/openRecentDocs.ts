import {fetchPost, fetchSyncPost} from "../util/fetch";
import {unicode2Emoji} from "../emoji";
import {Constants} from "../constants";
import {escapeHtml} from "../util/escape";
import {isWindow} from "../util/functions";
import {setStorageVal, updateHotkeyTip} from "../protyle/util/compatibility";
import {getAllDocks} from "../layout/getAll";
import {Dialog} from "../dialog";
import {focusByRange} from "../protyle/util/selection";
import {hasClosestByClassName} from "../protyle/util/hasClosest";
import {hideElements} from "../protyle/ui/hideElements";

const getHTML = async (data: {
    rootID: string,
    icon: string,
    title: string,
    viewedAt?: number,
    closedAt?: number,
    openAt?: number,
    updated?: number
}[], element: Element, key?: string, sortBy: TRecentDocsSort = "viewedAt") => {
    let tabHtml = "";
    let index = 0;

    // 根据排序字段对数据进行排序
    const sortedData = [...data].sort((a, b) => {
        const aValue = a[sortBy] || 0;
        const bValue = b[sortBy] || 0;
        return bValue - aValue; // 降序排序
    });

    sortedData.forEach((item) => {
        if (!key || item.title.toLowerCase().includes(key.toLowerCase())) {
            tabHtml += `<li data-index="${index}" data-node-id="${item.rootID}" class="b3-list-item${index === 0 ? " b3-list-item--focus" : ""}">
${unicode2Emoji(item.icon || window.siyuan.storage[Constants.LOCAL_IMAGES].file, "b3-list-item__graphic", true)}
<span class="b3-list-item__text">${escapeHtml(item.title)}</span>
</li>`;
            index++;
        }
    });
    let switchPath = "";
    if (tabHtml) {
        const pathResponse = await fetchSyncPost("/api/filetree/getFullHPathByID", {
            id: data[0].rootID
        });
        switchPath = escapeHtml(pathResponse.data);
    }
    let dockHtml = "";
    if (!isWindow()) {
        dockHtml = '<ul class="b3-list b3-list--background" style="overflow: auto;width: 200px;">';
        if (!key || window.siyuan.languages.riffCard.toLowerCase().includes(key.toLowerCase())) {
            dockHtml += `<li data-type="riffCard" data-index="0" class="b3-list-item${!switchPath ? " b3-list-item--focus" : ""}">
    <svg class="b3-list-item__graphic"><use xlink:href="#iconRiffCard"></use></svg>
    <span class="b3-list-item__text">${window.siyuan.languages.riffCard}</span>
    <span class="b3-list-item__meta">${updateHotkeyTip(window.siyuan.config.keymap.general.riffCard.custom)}</span>
</li>`;
            if (!switchPath) {
                switchPath = window.siyuan.languages.riffCard;
            }
        }
        let docIndex = 1;
        getAllDocks().forEach((item) => {
            if (!key || item.title.toLowerCase().includes(key.toLowerCase())) {
                dockHtml += `<li data-type="${item.type}" data-index="${docIndex}" class="b3-list-item${!switchPath ? " b3-list-item--focus" : ""}">
    <svg class="b3-list-item__graphic"><use xlink:href="#${item.icon}"></use></svg>
    <span class="b3-list-item__text">${item.title}</span>
    <span class="b3-list-item__meta">${updateHotkeyTip(item.hotkey || "")}</span>
</li>`;
                docIndex++;
                if (!switchPath) {
                    switchPath = window.siyuan.languages.riffCard;
                }
            }
        });
        dockHtml = dockHtml + "</ul>";
    }

    const pathElement = element.querySelector(".switch-doc__path");
    pathElement.innerHTML = switchPath;
    pathElement.previousElementSibling.innerHTML = `<div class="fn__flex fn__flex-1" style="overflow:auto;">
        ${dockHtml}
        <ul style="${isWindow() ? "border-left:0;" : ""}min-width:360px;" class="b3-list b3-list--background fn__flex-1">${tabHtml}</ul>
    </div>`;
};

export const openRecentDocs = () => {
    const openRecentDocsDialog = window.siyuan.dialogs.find(item => {
        if (item.element.getAttribute("data-key") === Constants.DIALOG_RECENTDOCS) {
            return true;
        }
    });
    if (openRecentDocsDialog) {
        hideElements(["dialog"]);
        return;
    }
    fetchPost("/api/storage/getRecentDocs", {sortBy: "viewedAt"}, (response) => {
        let range: Range;
        if (getSelection().rangeCount > 0) {
            range = getSelection().getRangeAt(0);
        }
        const dialog = new Dialog({
            positionId: Constants.DIALOG_RECENTDOCS,
            title: `<div class="fn__flex">
<div class="fn__flex-center">${window.siyuan.languages.recentDocs}</div>
<div class="fn__flex-1"></div>
<div class="b3-form__icon fn__size200">
    <svg class="b3-form__icon-icon"><use xlink:href="#iconSearch"></use></svg>
    <input placeholder="${window.siyuan.languages.search}" class="b3-text-field fn__block b3-form__icon-input">
</div>
<span class="fn__space"></span>
<div class="fn__flex-center">
    <select class="b3-select" id="recentDocsSort">
        <option value="viewedAt"${window.siyuan.storage[Constants.LOCAL_RECENT_DOCS].type === "viewedAt" ? " selected" : ""}>${window.siyuan.languages.recentViewed}</option>
        <option value="updated"${window.siyuan.storage[Constants.LOCAL_RECENT_DOCS].type === "updated" ? " selected" : ""}>${window.siyuan.languages.recentModified}</option>
        <option value="openAt"${window.siyuan.storage[Constants.LOCAL_RECENT_DOCS].type === "openAt" ? " selected" : ""}>${window.siyuan.languages.recentOpened}</option>
        <option value="closedAt"${window.siyuan.storage[Constants.LOCAL_RECENT_DOCS].type === "closedAt" ? " selected" : ""}>${window.siyuan.languages.recentClosed}</option>
    </select>
</div>
</div>`,
            content: `<div class="fn__flex-column switch-doc">
    <div class="fn__flex fn__flex-1" style="overflow:auto;"></div>
    <div class="switch-doc__path"></div>
</div>`,
            height: "80vh",
            destroyCallback: () => {
                if (range && range.getBoundingClientRect().height !== 0) {
                    focusByRange(range);
                }
            }
        });
        const searchElement = dialog.element.querySelector("input");
        searchElement.focus();
        searchElement.addEventListener("compositionend", () => {
            getHTML(response.data, dialog.element, searchElement.value, sortSelect.value as TRecentDocsSort);
        });
        searchElement.addEventListener("input", (event: InputEvent) => {
            if (event.isComposing) {
                return;
            }
            getHTML(response.data, dialog.element, searchElement.value, sortSelect.value as TRecentDocsSort);
        });
        dialog.element.setAttribute("data-key", Constants.DIALOG_RECENTDOCS);
        dialog.element.addEventListener("click", (event) => {
            const liElement = hasClosestByClassName(event.target as HTMLElement, "b3-list-item");
            if (liElement) {
                dialog.element.querySelector(".b3-list-item--focus").classList.remove("b3-list-item--focus");
                liElement.classList.add("b3-list-item--focus");
                window.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter"}));
                event.stopPropagation();
                event.preventDefault();
            }
        });

        // 添加排序下拉框事件监听
        const sortSelect = dialog.element.querySelector("#recentDocsSort") as HTMLSelectElement;
        sortSelect.addEventListener("change", () => {
            // 重新调用API获取排序后的数据
            if (sortSelect.value === "updated") {
                // 使用SQL查询获取最近修改的文档
                const data = {
                    stmt: "SELECT * FROM blocks WHERE type = 'd' ORDER BY updated DESC LIMIT 33"
                };
                fetchSyncPost("/api/query/sql", data).then((sqlResponse) => {
                    if (sqlResponse.data && sqlResponse.data.length > 0) {
                        // 转换SQL查询结果格式
                        const recentModifiedDocs = sqlResponse.data.map((block: any) => {
                            // 从ial中解析icon
                            let icon = "";
                            if (block.ial) {
                                const iconMatch = block.ial.match(/icon="([^"]*)"/);
                                if (iconMatch) {
                                    icon = iconMatch[1];
                                }
                            }
                            return {
                                rootID: block.id,
                                icon,
                                title: block.content,
                                updated: block.updated
                            };
                        });
                        getHTML(recentModifiedDocs, dialog.element, searchElement.value, "updated");
                    }
                });
            } else {
                fetchPost("/api/storage/getRecentDocs", {sortBy: sortSelect.value}, (newResponse) => {
                    getHTML(newResponse.data, dialog.element, searchElement.value, sortSelect.value as TRecentDocsSort);
                });
            }
            window.siyuan.storage[Constants.LOCAL_RECENT_DOCS].type = sortSelect.value;
            setStorageVal(Constants.LOCAL_RECENT_DOCS, window.siyuan.storage[Constants.LOCAL_RECENT_DOCS]);
        });

        getHTML(response.data, dialog.element);
    });
};
