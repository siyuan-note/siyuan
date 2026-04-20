import {fetchPost} from "../../util/fetch";
import {Dialog} from "../../dialog";
import {escapeHtml} from "../../util/escape";

export const openFontSelector = (currentFont: string, recentFonts: string[], callback: (font: string) => void) => {
    recentFonts = recentFonts || [];
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
            "<mark>" + text.substring(index, index + search.length) +
            "</mark>" + text.substring(index + search.length);
    };

    const escapeAndHighlight = (text: string, search: string): string => {
        const escaped = escapeHtml(text);
        if (!search) return escaped;
        const lowerEscaped = escaped.toLowerCase();
        const lowerSearch = search.toLowerCase();
        const index = lowerEscaped.indexOf(lowerSearch);
        if (index === -1) return escaped;
        return escaped.substring(0, index) +
            "<mark>" + escaped.substring(index, index + lowerSearch.length) +
            "</mark>" + escaped.substring(index + lowerSearch.length);
    };

    const renderFontList = (container: HTMLElement, fonts: string[], startIndex: number = 0) => {
        container.innerHTML = "";
        if (fonts.length === 0 && !searchValue) {
            container.innerHTML = `<div class="font-selector__empty">
                <span>${window.siyuan.languages.emptyContent}</span>
            </div>`;
            return;
        }

        // Default font option (reset to empty string)
        const isDefaultHighlighted = selectedIndex === -1 && (!searchValue || window.siyuan.languages.default.toLowerCase().includes(searchValue.toLowerCase()));
        const isDefaultSelected = currentFont === "";
        const defaultItem = document.createElement("div");
        defaultItem.className = "font-selector__item" +
            (isDefaultSelected ? " font-selector__item--selected" : "") +
            (isDefaultHighlighted && !isDefaultSelected ? " font-selector__item--hovered" : "");
        defaultItem.setAttribute("data-index", "-1");
        defaultItem.innerHTML = `<span class="font-selector__font-name" style="font-family:var(--b3-font-family)">${highlightText(window.siyuan.languages.default, searchValue)}</span>`;
        defaultItem.addEventListener("click", () => {
            dialog.destroy();
            callback("");
        });
        defaultItem.addEventListener("mouseenter", () => {
            selectedIndex = -1;
            updateSelection(container, -1);
        });
        container.appendChild(defaultItem);

        fonts.forEach((font, index) => {
            const item = document.createElement("div");
            const isSelected = font === currentFont;
            const isHighlighted = index === selectedIndex;
            item.className = "font-selector__item" +
                (isSelected ? " font-selector__item--selected" : "") +
                (isHighlighted && !isSelected ? " font-selector__item--hovered" : "");
            item.setAttribute("data-index", (startIndex + index).toString());
            item.innerHTML = `<span class="font-selector__font-name" style="font-family:${CSS.escape(font)},var(--b3-font-family)">${escapeAndHighlight(font, searchValue)}</span>`;
            item.addEventListener("click", () => {
                dialog.destroy();
                callback(font);
            });
            item.addEventListener("mouseenter", () => {
                selectedIndex = startIndex + index;
                updateSelection(container, startIndex);
            });
            container.appendChild(item);
        });
    };

    const updateSelection = (container: HTMLElement, startIndex: number) => {
        const items = container.querySelectorAll(".font-selector__item");
        items.forEach((item, index) => {
            const itemIndex = startIndex + index;
            const isCurrentSelected = itemIndex === selectedIndex;
            if (isCurrentSelected) {
                item.classList.add("font-selector__item--hovered");
            } else {
                item.classList.remove("font-selector__item--hovered");
            }
        });
        if (selectedIndex >= 0 && selectedIndex >= startIndex && selectedIndex < startIndex + items.length) {
            const targetItem = items[selectedIndex - startIndex];
            if (targetItem) {
                targetItem.scrollIntoView({block: "nearest", behavior: "smooth"});
            }
        }
    };

    const dialog = new Dialog({
        title: window.siyuan.languages.font,
        content: `<div class="font-selector">
            <div class="font-selector__search">
                <div class="font-selector__search-wrapper">
                    <svg class="font-selector__search-icon"><use xlink:href="#iconSearch"></use></svg>
                    <input class="font-selector__search-input" id="fontSearch" placeholder="${window.siyuan.languages.search}" autocomplete="off" spellcheck="false">
                    <button class="font-selector__clear-btn" id="clearSearch">
                        <svg><use xlink:href="#iconCloseRound"></use></svg>
                    </button>
                </div>
            </div>
            <div class="font-selector__recent" id="recentFontsContainer">
                <div class="font-selector__section-header">
                    <svg class="font-selector__section-icon"><use xlink:href="#iconStar"></use></svg>
                    <span class="font-selector__section-title">${window.siyuan.languages.recentDocs}</span>
                </div>
                <div class="font-selector__recent-list" id="recentFontsList"></div>
            </div>
            <div class="font-selector__divider"></div>
            <div class="font-selector__all" id="allFontsContainer">
                <div class="font-selector__section-header">
                    <svg class="font-selector__section-icon"><use xlink:href="#iconFont"></use></svg>
                    <span class="font-selector__section-title">${window.siyuan.languages.all}</span>
                    <span class="font-selector__count" id="fontCount">0</span>
                </div>
                <div class="font-selector__list" id="allFontsList"></div>
            </div>
            <div class="font-selector__loading" id="loadingState">
                <div class="font-selector__loading-dot"></div>
                <div class="font-selector__loading-dot"></div>
                <div class="font-selector__loading-dot"></div>
            </div>
        </div>`,
        width: "480px",
        height: "600px",
    });

    const searchInput = dialog.element.querySelector("#fontSearch") as HTMLInputElement;
    const clearSearchBtn = dialog.element.querySelector("#clearSearch") as HTMLElement;
    const recentFontsContainer = dialog.element.querySelector("#recentFontsContainer") as HTMLElement;
    const recentFontsList = dialog.element.querySelector("#recentFontsList") as HTMLElement;
    const allFontsList = dialog.element.querySelector("#allFontsList") as HTMLElement;
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
            recentFontsList.innerHTML = "";
            recentFonts.forEach((font) => {
                const item = document.createElement("div");
                const isSelected = font === currentFont;
                item.className = "font-selector__recent-item" + (isSelected ? " font-selector__item--selected" : "");
                item.innerHTML = `<span class="font-selector__font-name" style="font-family:${CSS.escape(font)},var(--b3-font-family)">${escapeHtml(font)}</span>`;
                item.addEventListener("click", () => {
                    dialog.destroy();
                    callback(font);
                });
                item.addEventListener("mouseenter", () => {
                    recentFontsList.querySelectorAll(".font-selector__recent-item").forEach(el => el.classList.remove("font-selector__item--hovered"));
                    if (!item.classList.contains("font-selector__item--selected")) {
                        item.classList.add("font-selector__item--hovered");
                    }
                });
                recentFontsList.appendChild(item);
            });
        } else {
            recentFontsContainer.classList.add("fn__none");
        }
    };

    searchInput.addEventListener("input", (e) => {
        searchValue = (e.target as HTMLInputElement).value;
        clearSearchBtn.classList.toggle("font-selector__clear-btn--visible", searchValue.length > 0);
        filterFonts();
    });

    clearSearchBtn.addEventListener("click", () => {
        searchInput.value = "";
        searchValue = "";
        clearSearchBtn.classList.remove("font-selector__clear-btn--visible");
        filterFonts();
        searchInput.focus();
    });

    searchInput.addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            const maxIndex = filteredFonts.length - 1;
            if (selectedIndex === -1) {
                selectedIndex = 0;
                updateSelection(allFontsList, 0);
            } else if (selectedIndex < maxIndex) {
                selectedIndex++;
                updateSelection(allFontsList, 0);
            } else if (selectedIndex === maxIndex) {
                selectedIndex = -1;
                updateSelection(allFontsList, -1);
            }
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            if (selectedIndex === -1) {
                selectedIndex = filteredFonts.length - 1;
                updateSelection(allFontsList, 0);
            } else if (selectedIndex > 0) {
                selectedIndex--;
                updateSelection(allFontsList, 0);
            } else if (selectedIndex === 0) {
                selectedIndex = -1;
                updateSelection(allFontsList, -1);
            }
        } else if (e.key === "Enter") {
            e.preventDefault();
            if (selectedIndex === -1) {
                dialog.destroy();
                callback("");
            } else if (selectedIndex >= 0 && selectedIndex < filteredFonts.length) {
                const selectedFont = filteredFonts[selectedIndex];
                dialog.destroy();
                callback(selectedFont);
            }
        } else if (e.key === "Escape") {
            dialog.destroy();
        }
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
