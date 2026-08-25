export interface MobileMenuSearchCandidate {
    hidden: boolean;
    label: string;
    settingMatches?: boolean;
}

/** 判断主菜单项是否匹配当前搜索；设置项使用完整设置索引的扫描结果 */
export const isMobileMenuSearchMatch = (
    keywords: string,
    candidate: MobileMenuSearchCandidate,
): boolean => {
    if (candidate.hidden) {
        return false;
    }
    if (!keywords) {
        return true;
    }
    if (typeof candidate.settingMatches === "boolean") {
        return candidate.settingMatches;
    }
    return candidate.label.includes(keywords);
};
