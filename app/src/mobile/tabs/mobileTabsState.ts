/**
 * 移动端页签的钉住排序与超限淘汰规则，保持与桌面端 Wnd.removeOverCounter() 一致的语义：
 * 钉住的页签不参与自动淘汰，移除未钉住的页签后仍然超限时允许超出上限。
 */

interface IMobileTabStateLike {
    id: string;
    pin?: boolean;
    activeAt: number;
}

/**
 * 概览列表的显示顺序：钉住的页签在前，各自保持原有相对顺序
 *
 * @param tabs 页签列表
 * @returns 排序后的新数组，不修改入参
 */
export const orderTabsForOverview = <T extends IMobileTabStateLike>(tabs: readonly T[]): T[] => {
    return [
        ...tabs.filter((tab) => !!tab.pin),
        ...tabs.filter((tab) => !tab.pin),
    ];
};

/**
 * 判断页签的关闭按钮是否可用
 *
 * 在“在当前页签打开文件”模式下钉住的页签不显示关闭按钮，避免误关后在当前页签载入其他文档
 *
 * @param pinned 页签是否钉住
 * @param openFilesUseCurrentTab 是否在当前页签打开文件
 * @returns 是否显示关闭按钮
 */
export const canCloseTab = (pinned: boolean, openFilesUseCurrentTab: boolean) => {
    return !pinned || !openFilesUseCurrentTab;
};

/**
 * 挑选应被移除的页签：最久未激活的未钉住页签，当前激活的页签不参与淘汰
 *
 * @param tabs 页签列表
 * @param activeTabID 当前激活的页签 ID
 * @returns 待移除的页签 ID，没有可移除的页签时返回 undefined
 */
export const pickEvictedTabID = (tabs: readonly IMobileTabStateLike[], activeTabID?: string): string | undefined => {
    const candidates = tabs.filter((tab) => !tab.pin && tab.id !== activeTabID);
    if (candidates.length === 0) {
        return;
    }
    let oldest = candidates[0];
    for (let index = 1; index < candidates.length; index++) {
        if (candidates[index].activeAt < oldest.activeAt) {
            oldest = candidates[index];
        }
    }
    return oldest.id;
};

/**
 * 按页签上限截断列表
 *
 * @param tabs 页签列表
 * @param activeTabID 当前激活的页签 ID
 * @param maxTabs 页签上限
 * @param onRemove 移除页签时的回调
 * @returns 未超过上限的页签列表
 */
export const trimTabsToLimit = <T extends IMobileTabStateLike>(tabs: readonly T[], activeTabID: string | undefined,
                                                              maxTabs: number,
                                                              onRemove?: (tab: T) => void): T[] => {
    const remaining = [...tabs];
    while (remaining.length > maxTabs) {
        const evictedID = pickEvictedTabID(remaining, activeTabID);
        if (typeof evictedID === "undefined") {
            // 只剩钉住页签时保留全部页签，允许超出上限
            break;
        }
        const index = remaining.findIndex((tab) => tab.id === evictedID);
        if (index < 0) {
            break;
        }
        const evicted = remaining.splice(index, 1)[0];
        onRemove?.(evicted);
    }
    return remaining;
};
