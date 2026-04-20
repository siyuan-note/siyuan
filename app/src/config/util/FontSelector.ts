import {fetchPost} from "../../util/fetch";
import {Dialog} from "../../dialog";

export const openFontSelector = (currentFont: string, recentFonts: string[], callback: (font: string) => void) => {
    let searchValue = "";
    let allFonts: string[] = [];
    let filteredFonts: string[] = [];
    let selectedIndex = -1;

    const highlightText = (text: string, search: string): string => {
        if (!search) return text;
        const lowerText = text.toLowerCase();
        const lowerSearch = search.toLowerCase();
        const index = lowerText.indexOf(lowerSearch);
        if (index === -1) return text;
        return text.substring(0, index) +
            "<mark style='background-color: var(--b3-theme-primary-lightest); color: inherit;'>" +
            text.substring(index, index + search.length) +
            "</mark>" +
            text.substring(index + search.length);
    };

    const renderFontList = (container: HTMLElement, fonts: string[], startIndex: number = 0) => {
        container.innerHTML = "";
        if (fonts.length === 0) {
            container.innerHTML = `<div class="b3-list-item--readonly fn__flex-center" style="padding: 24px; opacity: 0.6; cursor: default">
                <span>${window.siyuan.languages.empty || "无结果"}</span>
            </div>`;
            return;
        }
        fonts.forEach((font, index) => {
            const item = document.createElement("div");
            const isSelected = font === currentFont;
            const isHighlighted = index === selectedIndex;
            item.className = "b3-list-item" + (isSelected ? " b3-list-item--focus" : "") + (isHighlighted ? " b3-list-item--current" : "");
            item.setAttribute("data-index", (startIndex + index).toString());
            item.innerHTML = `<span class="b3-list-item__text" style="font-family:'${font}',var(--b3-font-family)">${highlightText(font, searchValue)}</span>
                ${isSelected ? '<svg style="width: 16px; height: 16px; margin-left: auto; color: var(--b3-theme-primary);"><use xlink:href="#iconCheck"></use></svg>' : ""}`;
            item.addEventListener("click", () => {
                dialog.destroy();
                callback(font);
            });
            item.addEventListener("mouseenter", () => {
                selectedIndex = startIndex + index;
                updateSelection();
            });
            container.appendChild(item);
        });
    };

    const updateSelection = () => {
        const items = allFontsList.querySelectorAll(".b3-list-item");
        items.forEach((item, index) => {
            item.classList.toggle("b3-list-item--current", index === selectedIndex);
        });
        if (selectedIndex >= 0 && selectedIndex < items.length) {
            items[selectedIndex].scrollIntoView({block: "nearest", behavior: "smooth"});
        }
    };

    const dialog = new Dialog({
        title: window.siyuan.languages.font,
        content: `<div class="fn__flex-column" style="height: 100%">
    <div class="b3-form__icon" style="padding: 8px 16px; position: relative;">
        <svg class="b3-form__icon-icon"><use xlink:href="#iconSearch"></use></svg>
        <input class="b3-text-field fn__block b3-form__icon-input" id="fontSearch" placeholder="${window.siyuan.languages.search}" style="padding-right: 32px">
        <svg id="clearSearch" class="b3-form__icon-icon fn__pointer" style="position: absolute; right: 16px; top: 50%; transform: translateY(-50%); opacity: 0.5; display: none;"><use xlink:href="#iconCloseRound"></use></svg>
    </div>
    <div class="fn__hr--b" style="margin: 0"></div>
    <div class="fn__flex-1" style="overflow: hidden">
        <div class="fn__flex-column" style="height: 100%; overflow: hidden">
            <div id="recentFontsContainer" class="fn__none" style="flex: 0 0 auto; max-height: 30%; overflow: auto; padding: 8px 0;">
                <div class="b3-list-item--readonly" style="padding: 8px 16px 4px; opacity: 0.7; cursor: default; display: flex; align-items: center; gap: 4px;">
                    <svg style="width: 14px; height: 14px; color: var(--b3-theme-primary);"><use xlink:href="#iconStar"></use></svg>
                    <span class="b3-list-item__text">${window.siyuan.languages.recentItems || "最近使用"}</span>
                    <span id="recentCount" style="opacity: 0.5; font-size: 12px;"></span>
                </div>
                <div id="recentFontsList" style="padding: 0 8px;"></div>
            </div>
            <div id="allFontsContainer" style="flex: 1; overflow: auto; padding: 8px 0;">
                <div class="b3-list-item--readonly" style="padding: 8px 16px 4px; opacity: 0.7; cursor: default; display: flex; align-items: center; gap: 4px;">
                    <svg style="width: 14px; height: 14px;"><use xlink:href="#iconFont"></use></svg>
                    <span class="b3-list-item__text">${window.siyuan.languages.allItems || "全部字体"} (<span id="fontCount">0</span>)</span>
                </div>
                <div id="allFontsList" style="padding: 0 8px;"></div>
            </div>
            <div id="loadingState" class="fn__flex-center" style="flex: 1; opacity: 0.6;">
                <span>${window.siyuan.languages.loading || "加载中..."}</span>
            </div>
        </div>
    </div>
</div>`,
        width: "520px",
        height: "480px",
    });

    const searchInput = dialog.element.querySelector("#fontSearch") as HTMLInputElement;
    const clearSearchBtn = dialog.element.querySelector("#clearSearch") as HTMLElement;
    const recentFontsContainer = dialog.element.querySelector("#recentFontsContainer") as HTMLElement;
    const recentFontsList = dialog.element.querySelector("#recentFontsList") as HTMLElement;
    const recentCount = dialog.element.querySelector("#recentCount") as HTMLElement;
    const allFontsList = dialog.element.querySelector("#allFontsList") as HTMLElement;
    const allFontsContainer = dialog.element.querySelector("#allFontsContainer") as HTMLElement;
    const fontCount = dialog.element.querySelector("#fontCount") as HTMLElement;
    const loadingState = dialog.element.querySelector("#loadingState") as HTMLElement;

    const filterFonts = () => {
        filteredFonts = searchValue ? allFonts.filter(f => f.toLowerCase().includes(searchValue.toLowerCase())) : allFonts;
        selectedIndex = -1;
        renderFontList(allFontsList, filteredFonts);
        fontCount.textContent = filteredFonts.length.toString();
    };

    const showRecentFonts = () => {
        if (recentFonts.length > 0) {
            recentFontsContainer.classList.remove("fn__none");
            recentCount.textContent = `(${recentFonts.length})`;
            recentFontsList.innerHTML = "";
            recentFonts.forEach((font) => {
                const item = document.createElement("div");
                const isSelected = font === currentFont;
                item.className = "b3-list-item" + (isSelected ? " b3-list-item--focus" : "");
                item.innerHTML = `<span class="b3-list-item__text" style="font-family:'${font}',var(--b3-font-family)">${font}</span>
                    ${isSelected ? '<svg style="width: 16px; height: 16px; margin-left: auto; color: var(--b3-theme-primary);"><use xlink:href="#iconCheck"></use></svg>' : ""}`;
                item.addEventListener("click", () => {
                    dialog.destroy();
                    callback(font);
                });
                item.addEventListener("mouseenter", () => {
                    recentFontsList.querySelectorAll(".b3-list-item").forEach(el => el.classList.remove("b3-list-item--current"));
                    item.classList.add("b3-list-item--current");
                });
                recentFontsList.appendChild(item);
            });
        } else {
            recentFontsContainer.classList.add("fn__none");
        }
    };

    searchInput.addEventListener("input", (e) => {
        searchValue = (e.target as HTMLInputElement).value;
        clearSearchBtn.style.display = searchValue ? "block" : "none";
        filterFonts();
    });

    clearSearchBtn.addEventListener("click", () => {
        searchInput.value = "";
        searchValue = "";
        clearSearchBtn.style.display = "none";
        filterFonts();
        searchInput.focus();
    });

    searchInput.addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            const maxIndex = filteredFonts.length - 1;
            if (selectedIndex < maxIndex) {
                selectedIndex++;
                updateSelection();
            } else if (selectedIndex === -1) {
                selectedIndex = 0;
                updateSelection();
            }
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            if (selectedIndex > 0) {
                selectedIndex--;
                updateSelection();
            }
        } else if (e.key === "Enter" && selectedIndex >= 0 && selectedIndex < filteredFonts.length) {
            e.preventDefault();
            const selectedFont = filteredFonts[selectedIndex];
            dialog.destroy();
            callback(selectedFont);
        } else if (e.key === "Escape") {
            dialog.destroy();
        }
    });

    allFontsContainer.addEventListener("scroll", () => {
        const containerRect = allFontsContainer.getBoundingClientRect();
        const items = allFontsList.querySelectorAll(".b3-list-item");
        items.forEach((item, index) => {
            const itemRect = item.getBoundingClientRect();
            if (itemRect.top >= containerRect.top && itemRect.bottom <= containerRect.bottom) {
                selectedIndex = index;
            }
        });
    });

    fetchPost("/api/system/getSysFonts", {}, (response) => {
        loadingState.classList.add("fn__none");
        allFonts = response.data;
        filteredFonts = [...allFonts];
        fontCount.textContent = allFonts.length.toString();
        showRecentFonts();
        renderFontList(allFontsList, filteredFonts);
        searchInput.focus();
    });
};