import {BAZAAR_PACKAGE_CONFIG} from "./packageConfig";

const genSortOptionsHTML = (sortValue: string) => `<option ${sortValue === "0" ? "selected" : ""} value="0">${window.siyuan.languages.sortByUpdateTimeDesc}</option>
<option ${sortValue === "1" ? "selected" : ""} value="1">${window.siyuan.languages.sortByUpdateTimeAsc}</option>
<option ${sortValue === "2" ? "selected" : ""} value="2">${window.siyuan.languages.sortByDownloadsDesc}</option>
<option ${sortValue === "3" ? "selected" : ""} value="3">${window.siyuan.languages.sortByDownloadsAsc}</option>
<option ${sortValue === "4" ? "selected" : ""} value="4">${window.siyuan.languages.sortByRatingDesc}</option>
<option ${sortValue === "5" ? "selected" : ""} value="5">${window.siyuan.languages.sortByRatingAsc}</option>`;

const genThemeModeSelectHTML = () => `<div class="fn__space"></div>
<select id="bazaarSelect" class="b3-select">
    <option selected value="2">${window.siyuan.languages.all}</option>
    <option value="0">${window.siyuan.languages.themeLight}</option>
    <option value="1">${window.siyuan.languages.themeDark}</option>
</select>`;

export const genBazaarPackagePanelHTML = (bazaarType: TBazaarType, sortValue: string, loadingHTML: string) => {
    const config = BAZAAR_PACKAGE_CONFIG[bazaarType];
    return `<div class="config-bazaar__panel fn__none" data-type="${config.tabType}">
    <div class="fn__flex config-bazaar__title">
        <svg class="svg ft__on-surface fn__flex-center"><use xlink:href="#iconSort"></use></svg>
        <div class="fn__space"></div>
        <select class="b3-select">
            ${genSortOptionsHTML(sortValue)}
        </select>
        ${bazaarType === "themes" ? genThemeModeSelectHTML() : ""}
        <div class="fn__space"></div>
        <div class="fn__flex config-bazaar__filter-row">
            <input class="b3-text-field" placeholder="${window.siyuan.languages.enterKey} ${window.siyuan.languages.search}">
            <div class="counter counter--bg fn__flex-center ariaLabel" data-position="north" aria-label="${window.siyuan.languages.total}"></div>
        </div>
    </div>
    <div id="${config.panelID}" class="config-bazaar__content">
        ${loadingHTML}
    </div>
</div>`;
};
