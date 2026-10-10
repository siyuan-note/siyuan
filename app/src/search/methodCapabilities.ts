export const getSearchMethodCapabilities = (method: number, group: number) => ({
    filter: method !== 2,
    path: method !== 2,
    replace: method !== 2 && method !== 4,
    group: method !== 4,
    sort: method !== 4 && (method !== 2 || group === 1),
});

// SQL 分组后的时间和内容排序由内核整理，相关度仅适用于关键字和查询语法。
export const isSearchSortAvailable = (method: number, group: number, sort: number): boolean => {
    if (!getSearchMethodCapabilities(method, group).sort) {
        return false;
    }
    if (sort === 5) {
        return group === 1;
    }
    return sort !== 6 && sort !== 7 || method === 0 || method === 1;
};

export const setSearchControlAvailability = (element: Element | null, enabled: boolean,
                                           label: string, methodUnavailable = false) => {
    if (!element) {
        return;
    }
    element.toggleAttribute("disabled", !enabled);
    element.setAttribute("aria-disabled", String(!enabled));
    const tip = methodUnavailable ? `${label} - ${window.siyuan.languages.searchControlUnavailable}` : label;
    element.classList.add("ariaLabel");
    element.setAttribute("aria-label", tip);
    element.removeAttribute("title");
};

export const updateSearchMethodControls = (element: Element, config: Config.IUILayoutTabSearchConfig,
                                          mobile = false) => {
    const capabilities = getSearchMethodCapabilities(config.method, config.group);
    const language = window.siyuan.languages;
    const input = mobile ? document.querySelector("#toolbarSearch") : element.querySelector("#searchInput");
    input?.classList.toggle("search__input--sql", config.method === 2);
    if (mobile && input) {
        input.closest(".toolbar__search")?.classList.toggle("toolbar__search--sql", config.method === 2);
        input.closest(".toolbar__text")?.classList.toggle("toolbar__text--search-sql", config.method === 2);
    }
    const pathAvailable = capabilities.path;
    const includeAvailable = (config.idPath || []).some(path => path.split("/").length > 1);
    const controls: Array<[string, boolean, string, boolean]> = mobile ? [
        ['[data-type="path"]', pathAvailable, language.specifyPath, !pathAvailable],
        ['[data-type="include"]', pathAvailable && includeAvailable, language.includeChildDoc, !pathAvailable],
        ['[data-type="currentPath"]', Boolean(pathAvailable &&
            document.querySelector("#empty")?.classList.contains("fn__none")), language.filterCurrentDocument, !pathAvailable],
        ['[data-type="toggle-replace"]', capabilities.replace, language.replace, !capabilities.replace],
        ['#searchPath [data-type="remove-path"]', pathAvailable, language.remove, !pathAvailable],
    ] : [
        ["#searchFilter", capabilities.filter, language.searchType, !capabilities.filter],
        ["#searchPath", pathAvailable, language.specifyPath, !pathAvailable],
        ["#searchPathInput .search__rmpath", pathAvailable, language.remove, !pathAvailable],
        ["#searchInclude", pathAvailable && includeAvailable, language.includeChildDoc, !pathAvailable],
        ["#searchReplace", capabilities.replace, language.replace, !capabilities.replace],
    ];
    controls.forEach(([selector, enabled, label, unavailable]) => {
        setSearchControlAvailability(element.querySelector(selector), enabled, label, unavailable);
    });
    const replaceVisible = Boolean(config.hasReplace && capabilities.replace && !window.siyuan.isPublish);
    const replaceRow = mobile ? element.querySelector(".toolbar") : element.querySelectorAll(".search__header")[1];
    replaceRow?.classList.toggle("fn__none", !replaceVisible);
    if (mobile) {
        element.querySelector('[data-type="toggle-replace"]')?.classList.toggle("toolbar__icon--active", replaceVisible);
        element.querySelector('[data-type="expand"]')?.classList.toggle("fn__none", config.group !== 1 || !capabilities.group);
        element.querySelector('[data-type="contract"]')?.classList.toggle("fn__none", config.group !== 1 || !capabilities.group);
    } else {
        element.querySelector("#searchExpand")?.parentElement.classList.toggle("fn__none", config.group !== 1 || !capabilities.group);
    }
};
