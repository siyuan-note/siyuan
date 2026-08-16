type IGroupResponseData = {
    view?: Partial<IAVView>;
    group?: IAVGroup;
    groups?: IAVView[];
};

export const mergeGroupResponseView = <T extends IAVView>(currentView: T, responseData: IGroupResponseData): T => {
    const responseView = responseData?.view || {
        ...(responseData?.group ? {group: responseData.group} : {}),
        ...(responseData?.groups ? {groups: responseData.groups} : {}),
    };
    if (Object.keys(responseView).length === 0) {
        return currentView;
    }
    const responseMetadata: Record<string, unknown> = {};
    Object.entries(responseView).forEach(([key, value]) => {
        if (!["rows", "cards", "columns", "fields"].includes(key)) {
            responseMetadata[key] = value;
        }
    });
    // groups 是本次重新生成的完整列表或瘦身元数据，不能混入旧分组的行，否则切换分组字段后会短暂使用过期成员。
    return {...currentView, ...responseMetadata} as T;
};
