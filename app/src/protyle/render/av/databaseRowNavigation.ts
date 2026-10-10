import {fetchSyncPost} from "../../../util/fetch";
import {escapeAttr} from "../../../util/escape";
import {isAVRenderData} from "./renderData";
import {getAVData} from "./virtualScroll";
import type {IDatabaseRowOpenData} from "./openDatabaseRow";

export interface IDatabaseRowNavigation {
    viewID: string;
    query: string;
    groupID?: string;
    calendarRange?: IAVCalendarRange;
}

export const getDatabaseRowNavigation = (source: Partial<IProtyle>, data: IDatabaseRowOpenData) => {
    if (source.options?.history?.created || source.options?.history?.snapshot) {
        return;
    }
    const block = source.wysiwyg?.element.querySelector<HTMLElement>(`[data-node-id="${data.databaseBlockID}"]`);
    const av = block && getAVData(block);
    if (!av || av.id !== data.avID) {
        return;
    }
    return {
        viewID: av.viewID,
        query: block.querySelector('[data-type="av-search"]')?.textContent.trim() || "",
        groupID: block.querySelector(`[data-id="${data.itemID}"]`)?.closest<HTMLElement>(".av__body")?.dataset.groupId,
        calendarRange: (av.view as IAVTable).calendarRange,
    };
};

const getItems = (view: IAVView): Array<IAVRow | IAVGalleryItem> =>
    (view as IAVTable).rows || (view as IAVGallery).cards || [];

const getCount = (view: IAVView) => (view as IAVTable).rowCount ?? (view as IAVGallery).cardCount ?? 0;

export const getDatabaseRowNeighbors = async (data: IDatabaseRowOpenData) => {
    const navigation = data.navigation;
    if (!navigation) {
        return [];
    }
    const request = {
        id: data.avID, blockID: data.databaseBlockID, viewID: navigation.viewID,
        query: navigation.query, calendarRange: navigation.calendarRange, createIfNotExist: false,
        page: 1, pageSize: 1,
    };
    // 定位窗口包含当前条目的前后行，避免只在已渲染的分页或虚拟滚动范围内切换。
    const response = await fetchSyncPost("/api/av/renderAttributeView", {
        ...request, targetItemID: data.itemID, targetGroupID: navigation.groupID,
    });
    if (response.code !== 0 || !isAVRenderData(response.data) || response.data.target?.status !== "visible") {
        return [];
    }
    const av: IAV = response.data;
    const groups = av.view.groups?.length ? av.view.groups.filter(group => !group.groupHidden && getCount(group) > 0) : [av.view];
    const groupIndex = av.view.groups?.length ? groups.findIndex(group => group.id === av.target.groupID) : 0;
    if (groupIndex < 0) {
        return [];
    }
    const items = getItems(groups[groupIndex]);
    const index = items.findIndex(item => item.id === data.itemID);
    if (index < 0) {
        return [];
    }
    return Promise.all([-1, 1].map(async direction => {
        let groupID = av.target.groupID;
        let item = items[index + direction];
        if (!item) {
            const group = groups[groupIndex + direction];
            if (!group) {
                return undefined;
            }
            groupID = group.id;
            if (direction > 0) {
                item = getItems(group)[0];
            } else {
                // 前一分组只取末行，不加载整个分组。
                const previous = await fetchSyncPost("/api/av/renderAttributeView", {
                    ...request, groupPaging: {[groupID]: {page: getCount(group), pageSize: 1}},
                });
                if (previous.code === 0 && isAVRenderData(previous.data)) {
                    const previousGroup = previous.data.view.groups?.find(candidate => candidate.id === groupID);
                    item = previousGroup && getItems(previousGroup)[0];
                }
            }
        }
        const primary = item && ("cells" in item ? item.cells : item.values)
            .find(cell => cell.valueType === "block" || cell.value?.type === "block");
        if (!primary?.value) {
            return undefined;
        }
        return {
            avID: data.avID, databaseBlockID: data.databaseBlockID, notebookID: data.notebookID,
            itemID: item.id, valueID: primary.id || primary.value.id,
            title: primary.value.block?.content || "", boundBlockID: primary.value.block?.id,
            isDetached: primary.value.isDetached === true || !primary.value.block?.id,
            navigation: {...navigation, groupID},
        } satisfies IDatabaseRowOpenData;
    }));
};

export const mountDatabaseRowNavigation = (container: Element, data: IDatabaseRowOpenData,
                                           open: (data: IDatabaseRowOpenData) => Promise<boolean>) => {
    container.querySelector(":scope > [data-database-row-navigation]")?.remove();
    if (!data.navigation) {
        return;
    }
    const toolbar = document.createElement("div");
    toolbar.className = "block__icons";
    toolbar.setAttribute("data-database-row-navigation", data.itemID);
    toolbar.innerHTML = ["previous", "next"].map((name, index) =>
        `<button type="button" disabled class="block__icon block__icon--show block__icon--touch ariaLabel" data-position="8south" aria-label="${escapeAttr(window.siyuan.languages[name])}"><svg><use xlink:href="#${index ? "iconDown" : "iconUp"}"></use></svg></button>`)
        .join('<span class="fn__space"></span>');
    container.prepend(toolbar);
    const buttons = Array.from(toolbar.querySelectorAll("button"));
    let busy = false;
    const update = async () => {
        try {
            const neighbors = await getDatabaseRowNeighbors(data);
            if (toolbar.isConnected) {
                buttons.forEach((button, index) => { button.disabled = !neighbors[index]; });
            }
        } catch (error) {
            console.warn("Failed to load database row navigation:", error);
        }
    };
    buttons.forEach((button, index) => button.addEventListener("click", async () => {
        if (busy) {
            return;
        }
        busy = true;
        buttons.forEach(item => { item.disabled = true; });
        try {
            // 点击时重新定位，避免筛选、排序或删除后打开过期的相邻条目。
            const neighbors = await getDatabaseRowNeighbors(data);
            if (toolbar.isConnected && neighbors[index]) {
                await open(neighbors[index]);
            }
        } catch (error) {
            console.warn("Failed to navigate database rows:", error);
        } finally {
            busy = false;
            if (toolbar.isConnected) {
                void update();
            }
        }
    }));
    void update();
};
