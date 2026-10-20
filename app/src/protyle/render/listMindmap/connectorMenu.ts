import {LIST_MINDMAP_CONNECTOR_STYLES} from "./connectors";
import type {ListMindmapConnectorStyle} from "./connectors";

export const getListMindmapConnectorMenuItem = (current: ListMindmapConnectorStyle,
                                               select: (style: ListMindmapConnectorStyle) => void,
                                               labels: Record<string, string>, scope: "current" | "default" = "current"): IMenu => {
    const names = {
        spline: labels.listMindmapConnectorSpline,
        orthogonal: labels.listMindmapConnectorOrthogonal,
        bezier: labels.listMindmapConnectorBezier,
        rounded: labels.listMindmapConnectorRounded,
    };
    return {
        id: scope === "default" ? "defaultConnectorStyle" : "connectorStyle", iconHTML: "",
        label: scope === "default" ? labels.listMindmapDefaultConnectorStyle : labels.listMindmapConnectorStyle,
        submenu: LIST_MINDMAP_CONNECTOR_STYLES.map(style => ({
            id: style, iconHTML: "", label: names[style], checked: current === style,
            click: () => select(style),
        })),
    };
};
