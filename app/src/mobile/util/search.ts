import {closePanel} from "./closePanel";
import {openMobileFileById} from "../editor";
import {Constants} from "../../constants";
import {fetchPost} from "../../util/fetch";
import {getIconByType} from "../../editor/getIcon";
import {preventScroll} from "../../protyle/scroll/preventScroll";
import {setStorageVal} from "../../protyle/util/compatibility";
import {openModel} from "./model";

const onRecentBlocks = (data: IBlock[], matchedRootCount?:number, matchedBlockCount?:number) => {
    let resultHTML = "";
    if (matchedBlockCount) {
        resultHTML = '<div class="b3-list-item ft__smaller ft__on-surface">' + window.siyuan.languages.findInDoc.replace("${x}", matchedRootCount).replace("${y}", matchedBlockCount) + "</div>";
    }
    data.forEach((item: IBlock) => {
        resultHTML += `<div class="b3-list-item b3-list-item--two" data-url="${item.box}" data-path="${item.path}" data-id="${item.id}">
<div class="b3-list-item__first">
    <svg class="b3-list-item__graphic"><use xlink:href="#${getIconByType(item.type)}"></use></svg>
    <span class="b3-list-item__text">${item.content}</span>
</div>
<div class="b3-list-item__meta">${Lute.EscapeHTMLStr(item.hPath)}</div>
</div>`;
    });
    document.querySelector("#searchPanel").innerHTML = resultHTML;
};


let toolbarSearchTimeout = 0;
export const toolbarSearchEvent = () => {
    clearTimeout(toolbarSearchTimeout);
    toolbarSearchTimeout = window.setTimeout(() => {
        const inputElement = document.getElementById("toolbarSearch") as HTMLInputElement;
        if (inputElement.value === "") {
            fetchPost("/api/block/getRecentUpdatedBlocks", {}, (response) => {
                onRecentBlocks(response.data);
            });
        } else {
            fetchPost("/api/search/fullTextSearchBlock", {query: inputElement.value,}, (response) => {
                onRecentBlocks(response.data.blocks, response.data.matchedRootCount,response.data.matchedBlockCount);
            });
        }
        window.siyuan.storage[Constants.LOCAL_SEARCHKEY] = inputElement.value;
        setStorageVal(Constants.LOCAL_SEARCHKEY, window.siyuan.storage[Constants.LOCAL_SEARCHKEY]);
    }, Constants.TIMEOUT_SEARCH);
};

const initToolbarSearch = () => {
    const inputElement = document.getElementById("toolbarSearch") as HTMLInputElement;
    inputElement.focus();
    inputElement.value = window.siyuan.storage[Constants.LOCAL_SEARCHKEY] || "";
    inputElement.addEventListener("compositionend", (event: InputEvent) => {
        if (event && event.isComposing) {
            return;
        }
        toolbarSearchEvent();
    });
    inputElement.addEventListener("input", (event: InputEvent) => {
        if (event && event.isComposing) {
            return;
        }
        toolbarSearchEvent();
    });
};

export const popSearch = () => {
    openModel({
        title: '<input id="toolbarSearch" style="background-color: var(--b3-theme-surface);border: 0;" class="b3-text-field fn__block">',
        icon:"iconSearch",
        html: '<div id="searchPanel"></div>',
        bindEvent(modelMainElement: HTMLElement) {
            initToolbarSearch();
            const searchElement = document.getElementById("searchPanel");
            // 不能使用 getEventName() https://ld246.com/article/1638887457149
            searchElement.addEventListener("click", (event) => {
                let target = event.target as HTMLElement;
                while (target && !target.isEqualNode(searchElement)) {
                    if (target.classList.contains("b3-list-item")) {
                        const id = target.getAttribute("data-id");
                        if (window.siyuan.mobile.editor.protyle) {
                            preventScroll(window.siyuan.mobile.editor.protyle);
                        }
                        fetchPost("/api/block/checkBlockFold", {id}, (foldResponse) => {
                            openMobileFileById(id,foldResponse.data ? [Constants.CB_GET_ALL, Constants.CB_GET_HL] : [Constants.CB_GET_HL, Constants.CB_GET_CONTEXT]);
                        });
                        closePanel();
                        event.preventDefault();
                        event.stopPropagation();
                        break;
                    }
                    target = target.parentElement;
                }
            }, false);
            toolbarSearchEvent();
        }
    })
};
