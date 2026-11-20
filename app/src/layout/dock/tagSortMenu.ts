import {TAG_SORT_CREATED_DESC, TAG_SORT_MANUAL} from "../../constants";
import {MenuItem} from "../../menus/Menu";

const tagSortModes = [
    [0, "fileNameASC"],
    [1, "fileNameDESC"],
    [4, "fileNameNatASC"],
    [5, "fileNameNatDESC"],
    [7, "refCountASC"],
    [8, "refCountDESC"],
    [TAG_SORT_CREATED_DESC, "tagRecentlyAdded"],
    [TAG_SORT_MANUAL, "customSort"],
] as const;

export const appendTagSortMenu = (update: () => void) => {
    tagSortModes.forEach(([sort, label]) => {
        window.siyuan.menus.menu.append(new MenuItem({
            checked: window.siyuan.config.tag.sort === sort,
            label: window.siyuan.languages[label],
            click: () => {
                window.siyuan.config.tag.sort = sort;
                update();
            },
        }).element);
    });
};
