import {fetchPost} from "../../util/fetch";
import {Dialog} from "../../dialog";

export const openFontSelector = (currentFont: string, recentFonts: string[], callback: (font: string) => void) => {
    let searchValue = "";
    let allFonts: string[] = [];
    let filteredFonts: string[] = [];
    let selectedIndex = -1;

    const renderFontList = (container: HTMLElement, fonts: string[], startIndex: number = 0) => {
        container.innerHTML = "";
        fonts.forEach((font, index) => {
            const item = document.createElement("div");
            item.className = "b3-list-item" + (font === currentFont ? " b3-list-item--focus" : "");
            item.setAttribute("data-index", (startIndex + index).toString());
            item.innerHTML = `<span class="b3-list-item__text" style="font-family:'${font}',var(--b3-font-family)">${font}</span>`;
            item.addEventListener("click", () => {
                dialog.destroy();
                callback(font);
            });
            container.appendChild(item);
        });
    };

    const dialog = new Dialog({
        title: window.siyuan.languages.font,
        content: `<div class="fn__flex-column" style="height: 100%">
    <div class="b3-form__icon" style="padding: 8px 16px;">
        <svg class="b3-form__icon-icon"><use xlink:href="#iconSearch"></use></svg>
        <input class="b3-text-field fn__block b3-form__icon-input" id="fontSearch" placeholder="${window.siyuan.languages.search}" style="padding-right: 0">
    </div>
    <div class="fn__hr--b" style="margin: 0"></div>
    <div class="fn__flex-1" style="overflow: hidden">
        <div class="fn__flex-column" style="height: 100%; overflow: hidden">
            <div id="recentFontsContainer" class="fn__none" style="flex: 0 0 auto; max-height: 30%; overflow: auto; padding: 8px 0;">
                <div class="fn__hr--b" style="margin: 0 16px 8px"></div>
                <div class="b3-list-item--readonly" style="padding: 4px 16px; opacity: 0.6; cursor: default">
                    <svg style="width: 16px; height: 16px; margin-right: 4px"><use xlink:href="#iconHistory"></use></svg>
                    <span class="b3-list-item__text">${window.siyuan.languages.recentItems || "最近使用"}</span>
                </div>
                <div id="recentFontsList" style="padding: 0 8px;"></div>
            </div>
            <div id="allFontsContainer" style="flex: 1; overflow: auto; padding: 8px 0;">
                <div class="fn__hr--b" style="margin: 0 16px 8px"></div>
                <div class="b3-list-item--readonly" style="padding: 4px 16px; opacity: 0.6; cursor: default">
                    <span class="b3-list-item__text">${window.siyuan.languages.allItems || "全部字体"} (<span id="fontCount">0</span>)</span>
                </div>
                <div id="allFontsList" style="padding: 0 8px;"></div>
            </div>
        </div>
    </div>
</div>`,
        width: "520px",
        height: "480px",
    });

    const searchInput = dialog.element.querySelector("#fontSearch") as HTMLInputElement;
    const recentFontsContainer = dialog.element.querySelector("#recentFontsContainer") as HTMLElement;
    const recentFontsList = dialog.element.querySelector("#recentFontsList") as HTMLElement;
    const allFontsList = dialog.element.querySelector("#allFontsList") as HTMLElement;
    const allFontsContainer = dialog.element.querySelector("#allFontsContainer") as HTMLElement;
    const fontCount = dialog.element.querySelector("#fontCount") as HTMLElement;

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
                item.className = "b3-list-item" + (font === currentFont ? " b3-list-item--focus" : "");
                item.innerHTML = `<span class="b3-list-item__text" style="font-family:'${font}',var(--b3-font-family)">${font}</span>`;
                item.addEventListener("click", () => {
                    dialog.destroy();
                    callback(font);
                });
                recentFontsList.appendChild(item);
            });
        } else {
            recentFontsContainer.classList.add("fn__none");
        }
    };

    searchInput.addEventListener("input", (e) => {
        searchValue = (e.target as HTMLInputElement).value;
        filterFonts();
    });

    searchInput.addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            selectedIndex = Math.min(selectedIndex + 1, filteredFonts.length - 1);
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            selectedIndex = Math.max(selectedIndex - 1, 0);
        } else if (e.key === "Enter" && selectedIndex >= 0) {
            e.preventDefault();
            const selectedFont = filteredFonts[selectedIndex];
            dialog.destroy();
            callback(selectedFont);
        }
    });

    fetchPost("/api/system/getSysFonts", {}, (response) => {
        allFonts = response.data;
        filteredFonts = [...allFonts];
        fontCount.textContent = allFonts.length.toString();
        showRecentFonts();
        renderFontList(allFontsList, filteredFonts);
        searchInput.focus();
    });
};