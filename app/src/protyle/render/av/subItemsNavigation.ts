import {Constants} from "../../../constants";
import {avRender} from "./render";
import {loadMoreSubItems, setSubItemsViewportAnchor, toggleSubItems} from "./subItemsState";
import {getBacklinkScrollElement} from "./backlinkScroll";
import {locateRequests} from "./locateState";

export const navigateSubItems = (target: Element, blockElement: HTMLElement, protyle: IProtyle) => {
    const type = target.getAttribute("data-type");
    if (!["av-sub-items-root-page", "av-sub-items-toggle", "av-sub-items-more"].includes(type)) {
        return false;
    }
    const body = target.closest<HTMLElement>(".av__body");
    if (!body) return false;
    const groupID = body.dataset.groupId || "";
    const row = target.closest<HTMLElement>(".av__row[data-id]");
    const rowID = row?.dataset.id;
    const top = row?.getBoundingClientRect().top;
    locateRequests.delete(blockElement);
    const scroller = getBacklinkScrollElement(blockElement) || protyle.contentElement;
    if (type === "av-sub-items-root-page") {
        body.dataset.rootPage = target.getAttribute("data-page");
    } else if (rowID) {
        setSubItemsViewportAnchor(blockElement, rowID, groupID, row.getBoundingClientRect().height);
        if (type === "av-sub-items-toggle") {
            toggleSubItems(blockElement, protyle, groupID, rowID, target.getAttribute("aria-expanded") !== "true");
        } else {
            loadMoreSubItems(blockElement, protyle, groupID, rowID,
                Number(target.getAttribute("data-page")), Number(target.getAttribute("data-page-size")));
        }
    } else {
        return false;
    }
    // 页窗口和展开序列变更后旧索引、占位高度不能复用，按新行序列重新建立虚拟窗口。
    blockElement.removeAttribute(Constants.ATTRIBUTE_V_SCROLL);
    blockElement.removeAttribute("data-render");
    void avRender(blockElement, protyle, () => {
        const currentBody = blockElement.querySelector<HTMLElement>(`.av__body[data-group-id="${groupID}"]`);
        if (rowID) {
            const currentRow = currentBody?.querySelector<HTMLElement>(`.av__row[data-id="${rowID}"]`);
            if (currentRow && scroller) {
                scroller.scrollTop += currentRow.getBoundingClientRect().top - top;
            }
            currentRow?.querySelector<HTMLElement>('[data-type="av-sub-items-toggle"]')?.focus({preventScroll: true});
        } else {
            currentBody?.querySelector<HTMLElement>('[data-type="av-sub-items-root-page"]')?.focus({preventScroll: true});
            currentBody?.querySelector<HTMLElement>(".av__row[data-id]")?.scrollIntoView({block: "nearest"});
        }
    });
    return true;
};
