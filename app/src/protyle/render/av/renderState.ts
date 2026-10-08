export interface IAVRenderItemID {
    groupId: string;
    fieldId: string;
}

export interface IAVCardRenderState {
    alignSelf: string;
    selectItemIds: IAVRenderItemID[];
    editIds: IAVRenderItemID[];
    isSearching: boolean;
    pageSizes: {[key: string]: string};
    query: string;
    oldOffset: number;
    left?: number;
    virtualData: {[key: string]: IAVVirtualData};
}

export interface IAVCardRenderOptions {
    protyle: IProtyle;
    blockElement: HTMLElement;
    cb?: (data: IAV) => void;
    data: IAV;
    renderAll: boolean;
    resetData: IAVCardRenderState;
}
