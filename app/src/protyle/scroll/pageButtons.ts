import {Constants} from "../../constants";
import {setStorageVal} from "../util/compatibility";

export const PAGE_SCROLL_BUTTONS_CHANGED_EVENT = "siyuan-page-scroll-buttons-changed";

export const isPageScrollButtonsEnabled = () =>
    window.siyuan.storage[Constants.LOCAL_PAGE_SCROLL_BUTTONS] === true;

export const onPageScrollButtonsStorageChanged = (key: string) => {
    if (key !== Constants.LOCAL_PAGE_SCROLL_BUTTONS) {
        return;
    }
    document.querySelectorAll(".protyle-scroll__page").forEach(element => {
        element.dispatchEvent(new Event(PAGE_SCROLL_BUTTONS_CHANGED_EVENT));
    });
    document.querySelectorAll<HTMLInputElement>('input[id="pageScrollButtons"]').forEach(input => {
        input.checked = isPageScrollButtonsEnabled();
    });
};

export const setPageScrollButtonsEnabled = (enabled: boolean) => {
    if (window.siyuan.config.readonly || window.siyuan.isPublish) {
        return;
    }
    window.siyuan.storage[Constants.LOCAL_PAGE_SCROLL_BUTTONS] = enabled;
    void setStorageVal(Constants.LOCAL_PAGE_SCROLL_BUTTONS, enabled);
    onPageScrollButtonsStorageChanged(Constants.LOCAL_PAGE_SCROLL_BUTTONS);
};
