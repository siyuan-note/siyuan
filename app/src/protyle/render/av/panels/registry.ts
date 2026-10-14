import {assetPanel} from "./asset";
import {configPanel} from "./config";
import {contextFilterPanel} from "./contextFilter";
import {datePanel} from "./date";
import {editPanel} from "./edit";
import {filtersPanel} from "./filters";
import {propertiesPanel} from "./properties";
import {relationPanel} from "./relation";
import {rollupPanel} from "./rollup";
import {selectPanel} from "./select";
import {sortsPanel} from "./sorts";
import {switcherPanel} from "./switcher";
import type {IAVPanelAction, IAVPanelContext, IAVPanelDescriptor, TAVPanelActionHandler, TAVPanelType} from "./types";

// 功能模块之间存在编辑器依赖，面板描述与动作索引在实际打开时读取，避免循环导入期间读取未初始化的导出。
const providers: Record<TAVPanelType, () => IAVPanelDescriptor> = {
    select: () => selectPanel,
    properties: () => propertiesPanel,
    config: () => configPanel,
    sorts: () => sortsPanel,
    filters: () => filtersPanel,
    contextFilter: () => contextFilterPanel,
    edit: () => editPanel,
    date: () => datePanel,
    asset: () => assetPanel,
    switcher: () => switcherPanel,
    relation: () => relationPanel,
    rollup: () => rollupPanel,
};

export const getAVPanelDescriptor = (type: TAVPanelType) => providers[type]();

let actions: Map<string, TAVPanelActionHandler>;

const getActions = () => {
    if (!actions) {
        actions = new Map();
        for (const provider of Object.values(providers)) {
            for (const [type, handler] of Object.entries(provider().actions || {})) {
                if (actions.has(type)) {
                    throw new Error(`Duplicate AV panel action: ${type}`);
                }
                actions.set(type, handler);
            }
        }
    }
    return actions;
};

export const getAVPanelActionTypes = () => Array.from(getActions().keys());

// 子面板导航不改变打开选项中的初始类型，动作需要按自己的标识分派。
export const dispatchAVPanelAction = (context: IAVPanelContext, action: IAVPanelAction) => {
    const handler = getActions().get(action.type);
    return handler ? handler(context, action) : "continue";
};
