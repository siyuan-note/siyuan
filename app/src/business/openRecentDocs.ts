import {fetchPost} from "../util/fetch";
import {unicode2Emoji} from "../emoji";
import {Constants} from "../constants";
import {escapeHtml} from "../util/escape";
import {isWindow} from "../util/functions";
import {updateHotkeyTip} from "../protyle/util/compatibility";
import {getAllDocks} from "../layout/getAll";
import {Dialog} from "../dialog";
import {focusByRange} from "../protyle/util/selection";
import {hasClosestByClassName} from "../protyle/util/hasClosest";

export const openRecentDocs = () => {
    fetchPost("/api/storage/getRecentDocs", {}, (response) => {
        let range: Range;
        if (getSelection().rangeCount > 0) {
            range = getSelection().getRangeAt(0);
        }
        let tabHtml = "";
        response.data.forEach((item: any, index: number) => {
            tabHtml += `<li data-index="${index}" data-node-id="${item.rootID}" class="b3-list-item${index === 0 ? " b3-list-item--focus" : ""}">
${unicode2Emoji(item.icon || Constants.SIYUAN_IMAGE_FILE, false, "b3-list-item__graphic", true)}
<span class="b3-list-item__text">${escapeHtml(item.title)}</span>
</li>`;
        });
        let dockHtml = "";
        if (!isWindow()) {
            dockHtml = `<ul class="b3-list b3-list--background" style="max-height: calc(70vh - 35px);overflow: auto;width: 200px;">
<li data-type="riffCard" data-index="0" class="b3-list-item${!tabHtml ? " b3-list-item--focus" : ""}">
    <svg class="b3-list-item__graphic"><use xlink:href="#iconRiffCard"></use></svg>
    <span class="b3-list-item__text">${window.siyuan.languages.riffCard}</span>
    <span class="b3-list-item__meta">${updateHotkeyTip(window.siyuan.config.keymap.general.riffCard.custom)}</span>
</li>`;
            getAllDocks().forEach((item, index) => {
                dockHtml += `<li data-type="${item.type}" data-index="${index + 1}" class="b3-list-item">
    <svg class="b3-list-item__graphic"><use xlink:href="#${item.icon}"></use></svg>
    <span class="b3-list-item__text">${window.siyuan.languages[item.hotkeyLangId]}</span>
    <span class="b3-list-item__meta">${updateHotkeyTip(window.siyuan.config.keymap.general[item.hotkeyLangId].custom)}</span>
</li>`;
            });
            dockHtml = dockHtml + "</ul>";
        }
        const dialog = new Dialog({
            title: window.siyuan.languages.recentDocs,
            content: `<div class="fn__flex-column switch-doc">
    <div class="fn__hr"><input style="opacity: 0;height: 1px;box-sizing: border-box"></div>
    <div class="fn__flex">${dockHtml}
        <ul${!isWindow() ? "" : ' style="border-left:0"'} class="b3-list b3-list--background fn__flex-1">${tabHtml}</ul>
    </div>
    <div class="switch-doc__path"></div>
</div>`,
            destroyCallback: () => {
                if (range && range.getBoundingClientRect().height !== 0) {
                    focusByRange(range);
                }
            }
        });
        if (response.data.length > 0) {
            fetchPost("/api/filetree/getFullHPathByID", {
                id: response.data[0].rootID
            }, (response) => {
                dialog.element.querySelector(".switch-doc__path").innerHTML = escapeHtml(response.data);
            });
        } else {
            dialog.element.querySelector(".switch-doc__path").innerHTML = dialog.element.querySelector(".b3-list-item--focus").textContent;
        }
        dialog.element.querySelector("input").focus();
        dialog.element.setAttribute("data-key", window.siyuan.config.keymap.general.recentDocs.custom);
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
    });
};
