// isFilterGroup 判断筛选节点是否为分组，并兼容序列化时省略空 filters 的分组。
export const isFilterGroup = (filter: IAVFilter): boolean => {
    return Boolean(filter.filters || filter.combination);
};

// countFilterLeaves 递归统计筛选树中的真实叶子数量，分组节点不计入。
export const countFilterLeaves = (filters: IAVFilter[]): number => {
    return filters.reduce((count, filter) => {
        if (isFilterGroup(filter)) {
            return count + countFilterLeaves(filter.filters || []);
        }
        return count + 1;
    }, 0);
};
