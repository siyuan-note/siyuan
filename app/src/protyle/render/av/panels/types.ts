import type {RenderAttributeViewRequestInput} from "../../../../types/api";

export interface IOpenAVPanelOptions {
    protyle: IProtyle;
    blockElement: Element;
    type: "select" | "properties" | "config" | "sorts" | "filters" | "contextFilter" | "edit" | "date" | "asset" | "switcher" | "relation" | "rollup";
    colId?: string;
    editData?: {previousID: string; colData: IAVColumn};
    cellElements?: HTMLElement[];
    data?: IAV;
    cb?: (avPanelElement: Element) => void;
    destroyCallback?: () => void;
    keepMenuOpen?: boolean;
    filterOperation?: IAVFilterOperation;
    requireExplicitChange?: boolean;
}

export type TAVPanelType = IOpenAVPanelOptions["type"];

// 可变数据通过当前面板的访问器提供，异步事件不会持有过期的字段数组或关闭回调。
export interface IAVPanelContext {
    readonly options: IOpenAVPanelOptions;
    readonly avID: string;
    readonly blockID: string;
    readonly isCustomAttr: boolean;
    readonly fetchPayload: RenderAttributeViewRequestInput;
    readonly response: IWebSocketData;
    readonly avPanelElement: Element;
    readonly menuElement: HTMLElement;
    tabRect: DOMRect;
    readonly cellRect: DOMRect;
    readonly saveFilters: (newFilters: IAVFilter[], oldFilters: IAVFilter[]) => void;
    readonly renderData: (responseData: IAV) => Promise<void>;
    readonly openPanel: (options: IOpenAVPanelOptions) => void;
    readonly rerenderSwitcher: () => void;
    data: IAV;
    fields: IAVColumn[];
    html: string | undefined;
    closeCB?: () => void;
    relationDataRetryCount: number;
    suppressSelectClick: boolean;
}

export interface IAVPanelAction {
    readonly type: string;
    readonly target: HTMLElement;
    readonly event: MouseEvent;
}

export type TAVPanelActionResult = "handled" | "continue";
export type TAVPanelActionHandler = (context: IAVPanelContext, action: IAVPanelAction) =>
    TAVPanelActionResult | Promise<TAVPanelActionResult>;

export interface IAVPanelDescriptor {
    render: (context: IAVPanelContext) => boolean;
    bind?: (context: IAVPanelContext) => void;
    actions?: Readonly<Record<string, TAVPanelActionHandler>>;
}
