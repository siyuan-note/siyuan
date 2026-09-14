export type RepoSource = "local" | "cloud";
export interface RepoTagSelection {
    source: RepoSource;
    tag: string;
    id: string;
}

export const repoSelectionKey = (item: RepoTagSelection) => JSON.stringify([item.source, item.tag, item.id]);

export const removeSelectedRepoTags = async (
    items: RepoTagSelection[],
    remove: (item: RepoTagSelection) => Promise<boolean>,
    list: (source: RepoSource) => Promise<{tag: string}[]>,
) => {
    for (const item of items) {
        try {
            await remove(item);
        } catch {
            // 单项失败后继续处理其余标记，保留失败项供重试。
        }
    }
    const removed = new Set<string>();
    for (const source of ["local", "cloud"] as const) {
        const candidates = items.filter(item => item.source === source);
        if (candidates.length === 0) {
            continue;
        }
        try {
            const remaining = new Set((await list(source)).map(item => item.tag));
            candidates.forEach(item => {
                if (!remaining.has(item.tag)) {
                    removed.add(repoSelectionKey(item));
                }
            });
        } catch {
            // 无法核实删除结果时保留选择，不把未知状态当作成功。
        }
    }
    return removed;
};
