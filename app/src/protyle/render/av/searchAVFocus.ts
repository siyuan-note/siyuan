interface ISearchAVMatchItem {
    matched?: boolean;
    children?: ISearchAVMatchItem[];
}

interface ISearchAVFocus {
    resultIndex: number;
    viewIndex?: number;
}

export const getSearchAVFocus = (results: ISearchAVMatchItem[], keyword: string): ISearchAVFocus | undefined => {
    if (results.length === 0) {
        return;
    }
    if (keyword.trim() === "") {
        return {resultIndex: 0};
    }
    for (let resultIndex = 0; resultIndex < results.length; resultIndex++) {
        const item = results[resultIndex];
        if (item.matched) {
            return {resultIndex};
        }
        const viewIndex = item.children?.findIndex((view) => view.matched) ?? -1;
        if (viewIndex > -1) {
            return {resultIndex, viewIndex};
        }
    }
    return {resultIndex: 0};
};
