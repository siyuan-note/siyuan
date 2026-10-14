export type TSlashUsage = Record<string, number>;

// 仅保存稳定入口标识与次数，不保存正文、搜索词或插件显示内容。
export const normalizeSlashUsage = (value: unknown): TSlashUsage => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }
    return Object.fromEntries(Object.entries(value).filter(([key, count]) =>
        key.length > 0 && key.length <= 1024 && Number.isSafeInteger(count) && (count as number) > 0));
};

export const rankFrequentSlashItems = <T>(items: T[], getKey: (item: T) => string, usage: TSlashUsage): T[] => {
    const seen = new Set<string>();
    return items.map((item, index) => ({item, index, key: getKey(item)})).filter(({key}) => {
        if (!key || seen.has(key) || !Object.prototype.hasOwnProperty.call(usage, key) || !(usage[key] > 0)) {
            return false;
        }
        seen.add(key);
        return true;
    }).sort((a, b) => usage[b.key] - usage[a.key] || a.index - b.index).slice(0, 5).map(({item}) => item);
};
