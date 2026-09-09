interface IBacklinkMentionQuery {
    id: string;
    k: string;
    mk: string;
    sort: string;
    mSort: string;
    notebook?: string;
}

// 来源筛选不影响提及结果，查询条件和索引版本相同时复用当前面板的结果。
export const getBacklinkMentionQueryKey = (query: IBacklinkMentionQuery) => JSON.stringify([
    query.id, query.k, query.mk, query.sort, query.mSort, query.notebook || "",
]);

export class BacklinkMentionCache<T> {
    private entry?: {key: string, version: number, value: T};

    public get(key: string, version: number) {
        return this.entry?.key === key && this.entry.version === version ? this.entry.value : undefined;
    }

    public set(key: string, version: number, value: T) {
        this.entry = {key, version, value};
    }

    public clear() {
        this.entry = undefined;
    }
}
