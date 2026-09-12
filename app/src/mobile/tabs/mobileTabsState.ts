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
 * 钉住的页签仅通过菜单主动关闭
 *
 * @param pinned 页签是否钉住
 * @returns 是否显示关闭按钮
 */
export const canCloseTab = (pinned: boolean) => {
    return !pinned;
};

// 切换钉住状态时，将页签放到钉住与未钉住分组的交界处。
export const toggleTabPin = <T extends IMobileTabStateLike>(tabs: readonly T[], tabID: string): T[] => {
    const tab = tabs.find((item) => item.id === tabID);
    if (!tab) {
        return [...tabs];
    }
    const remaining = orderTabsForOverview(tabs.filter((item) => item.id !== tabID));
    remaining.splice(remaining.filter((item) => !!item.pin).length, 0, {...tab, pin: !tab.pin});
    return remaining;
};

// 拖拽仅调整同一钉住分组内的顺序，不改变钉住状态和访问时间。
export const moveTab = <T extends IMobileTabStateLike>(tabs: readonly T[], tabID: string,
                                                     targetID: string, after: boolean): T[] => {
    const ordered = orderTabsForOverview(tabs);
    const tab = ordered.find((item) => item.id === tabID);
    const target = ordered.find((item) => item.id === targetID);
    if (!tab || !target || tab === target || !!tab.pin !== !!target.pin) {
        return ordered;
    }
    const remaining = ordered.filter((item) => item.id !== tabID);
    remaining.splice(remaining.findIndex((item) => item.id === targetID) + (after ? 1 : 0), 0, tab);
    return remaining;
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
