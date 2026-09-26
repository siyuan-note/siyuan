import type {SearchAssetMatchInput} from "../types/api";
import {Dialog} from "../dialog";
import {fetchSyncPost} from "../util/fetch";
import {isMobile} from "../util/functions";
import {getAssetExtension, getAssetName} from "../util/pathName";
import {upDownHint} from "../util/upDownHint";
import {renderAssetsPreview} from "./renderAssets";

export interface AssetPickerOptions {
    exts?: string[];
    match?: SearchAssetMatchInput;
}

export interface AssetPickerResult {
    path: string;
}

const PAGE_SIZE = 32;

export const openAssetPicker = (options: AssetPickerOptions = {}): Promise<AssetPickerResult | null> => {
    return new Promise((resolve, reject) => {
        let result: AssetPickerResult | null = null;
        let failure: Error | null = null;
        let closed = false;
        let requestID = 0;
        let controller: AbortController;
        const dialog = new Dialog({
            title: window.siyuan.languages.assets,
            content: `<div class="asset-picker${isMobile() ? " asset-picker--mobile" : ""}">
    <div class="asset-picker__search"><input class="b3-text-field fn__block" type="search" spellcheck="false"></div>
    <div class="asset-picker__body">
        <div class="asset-picker__list b3-list b3-list--background"></div>
        <div class="asset-picker__preview b3-typography"></div>
    </div>
    <div class="b3-dialog__action asset-picker__action">
        <button class="b3-button b3-button--text asset-picker__more fn__none" type="button"></button>
        <span class="fn__space"></span>
        <button class="b3-button b3-button--cancel asset-picker__cancel" type="button"></button>
        <button class="b3-button b3-button--text asset-picker__select" type="button" disabled></button>
    </div>
</div>`,
            width: "min(860px, 92vw)",
            height: "min(640px, 82vh)",
            destroyCallback: () => {
                closed = true;
                controller?.abort();
                if (failure) {
                    reject(failure);
                } else {
                    resolve(result);
                }
            }
        });
        const input = dialog.element.querySelector<HTMLInputElement>(".asset-picker__search input");
        const list = dialog.element.querySelector<HTMLElement>(".asset-picker__list");
        const preview = dialog.element.querySelector<HTMLElement>(".asset-picker__preview");
        const more = dialog.element.querySelector<HTMLButtonElement>(".asset-picker__more");
        const cancel = dialog.element.querySelector<HTMLButtonElement>(".asset-picker__cancel");
        const select = dialog.element.querySelector<HTMLButtonElement>(".asset-picker__select");
        const stopSearch = () => {
            closed = true;
            controller?.abort();
        };
        input.placeholder = window.siyuan.languages.keyword;
        input.setAttribute("aria-label", window.siyuan.languages.keyword);
        more.textContent = window.siyuan.languages.loadMore;
        cancel.textContent = window.siyuan.languages.cancel;
        select.textContent = window.siyuan.languages.select;
        list.setAttribute("role", "listbox");
        list.setAttribute("aria-label", window.siyuan.languages.assets);

        const currentItem = () => list.querySelector<HTMLElement>(".b3-list-item--focus");
        const focusItem = (item: HTMLElement) => {
            const previous = currentItem();
            previous?.classList.remove("b3-list-item--focus");
            previous?.setAttribute("aria-selected", "false");
            item.classList.add("b3-list-item--focus");
            item.setAttribute("aria-selected", "true");
            preview.innerHTML = renderAssetsPreview(item.dataset.path);
            select.disabled = false;
        };
        const confirm = () => {
            const item = currentItem();
            if (item) {
                result = {path: item.dataset.path};
                stopSearch();
                dialog.destroy();
            }
        };
        const search = async (page: number) => {
            if (closed) {
                return;
            }
            controller?.abort();
            controller = new AbortController();
            const currentRequest = ++requestID;
            const keyword = input.value;
            more.disabled = true;
            if (page === 1) {
                list.replaceChildren();
                preview.textContent = window.siyuan.languages.loading;
                select.disabled = true;
                more.classList.add("fn__none");
            }
            try {
                const response = await fetchSyncPost("/api/search/searchAsset", {
                    k: keyword,
                    exts: options.exts || [],
                    match: options.match,
                    page,
                    pageSize: PAGE_SIZE
                }, undefined, false, controller.signal);
                if (closed || currentRequest !== requestID) {
                    return;
                }
                if (response.code !== 0 || !Array.isArray(response.data)) {
                    throw new Error(response.msg || String(response.code));
                }
                response.data.forEach(asset => {
                    if (!asset) {
                        return;
                    }
                    const item = document.createElement("button");
                    item.type = "button";
                    item.className = "b3-list-item asset-picker__item";
                    item.setAttribute("role", "option");
                    item.setAttribute("aria-selected", "false");
                    item.dataset.path = asset.path;
                    const label = document.createElement("span");
                    label.className = "b3-list-item__text";
                    label.textContent = getAssetName(asset.path) + getAssetExtension(asset.path);
                    item.append(label);
                    list.append(item);
                });
                if (page === 1) {
                    const first = list.querySelector<HTMLElement>(".asset-picker__item");
                    if (first) {
                        focusItem(first);
                    } else {
                        preview.textContent = window.siyuan.languages.emptyContent;
                    }
                }
                more.classList.toggle("fn__none", response.data.length < PAGE_SIZE);
                more.disabled = false;
            } catch (error) {
                if (closed || currentRequest !== requestID || (error as Error).name === "AbortError") {
                    return;
                }
                failure = error instanceof Error ? error : new Error(String(error));
                stopSearch();
                dialog.destroy();
            }
        };

        let page = 1;
        const restartSearch = () => {
            page = 1;
            void search(page);
        };
        input.addEventListener("input", (event: InputEvent) => {
            if (!event.isComposing) {
                restartSearch();
            }
        });
        input.addEventListener("compositionend", restartSearch);
        input.addEventListener("keydown", (event: KeyboardEvent) => {
            const item = upDownHint(list, event);
            if (item) {
                list.querySelectorAll<HTMLElement>("[aria-selected='true']").forEach(selected => {
                    selected.setAttribute("aria-selected", "false");
                });
                item.setAttribute("aria-selected", "true");
                preview.innerHTML = renderAssetsPreview(item.dataset.path);
            }
        });
        dialog.element.addEventListener("keydown", (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                stopSearch();
                dialog.destroy();
                event.preventDefault();
                event.stopPropagation();
            }
        }, true);
        dialog.element.querySelectorAll(".b3-dialog__scrim, .b3-dialog__close").forEach(element => {
            element.addEventListener("click", stopSearch);
        });
        dialog.bindInput(input, confirm);
        list.addEventListener("click", (event) => {
            const item = (event.target as HTMLElement).closest<HTMLElement>(".asset-picker__item");
            if (item) {
                focusItem(item);
            }
        });
        list.addEventListener("dblclick", confirm);
        more.addEventListener("click", () => {
            page++;
            void search(page);
        });
        cancel.addEventListener("click", () => {
            stopSearch();
            dialog.destroy();
        });
        select.addEventListener("click", confirm);
        restartSearch();
    });
};
