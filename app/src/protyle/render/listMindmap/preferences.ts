import {setStorageVal} from "../../util/compatibility";
import {LIST_MINDMAP_CONNECTOR_STYLES} from "./connectors";
import type {ListMindmapConnectorStyle} from "./connectors";

export const LIST_MINDMAP_DEFAULT_CONNECTOR_STYLE_KEY = "siyuan-list-mindmap-default-connector-style";

export const getDefaultListMindmapConnectorStyle = (): ListMindmapConnectorStyle => {
    const value = window.siyuan?.storage?.[LIST_MINDMAP_DEFAULT_CONNECTOR_STYLE_KEY];
    return LIST_MINDMAP_CONNECTOR_STYLES.includes(value) ? value : "bezier";
};

export const setDefaultListMindmapConnectorStyle = (style: ListMindmapConnectorStyle) => {
    if (window.siyuan.config.readonly || window.siyuan.isPublish ||
        !LIST_MINDMAP_CONNECTOR_STYLES.includes(style) || getDefaultListMindmapConnectorStyle() === style) {
        return;
    }
    window.siyuan.storage[LIST_MINDMAP_DEFAULT_CONNECTOR_STYLE_KEY] = style;
    setStorageVal(LIST_MINDMAP_DEFAULT_CONNECTOR_STYLE_KEY, style);
};
