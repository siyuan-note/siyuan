import {getListMindmapNodeShape, LIST_MINDMAP_NODE_SHAPES} from "./appearance";
import {getListMindmapConnectorMenuItem} from "./connectorMenu";
import {getListMindmapConnectorStyle} from "./connectors";
import type {ListMindmapModel, ListMindmapNodeStyle} from "./model";

export const getListMindmapNodeStyleMenuItems = (model: ListMindmapModel, ids: string[],
    select: (ids: string[], patch: Partial<ListMindmapNodeStyle>) => void, labels: Record<string, string>): IMenu[] => {
    const connectorIds = ids.filter(id => model.nodes.get(id)?.parentId);
    const connectors = connectorIds.map(id => getListMindmapConnectorStyle(model.metadata.nodes[id]?.connectorStyle));
    const shapes = ids.map(id => getListMindmapNodeShape(model.metadata.nodes[id]?.shape));
    const shapeLabels = {
        underline: labels.underline,
        rectangle: labels.listMindmapShapeRectangle,
        capsule: labels.listMindmapShapeCapsule,
    };
    const items: IMenu[] = [{
        id: "nodeShape", iconHTML: "", label: labels.listMindmapNodeShape,
        submenu: [
            {id: "inherit", iconHTML: "", label: labels.default, checked: shapes.every(shape => shape === undefined),
                click: () => select(ids, {shape: undefined})},
            ...LIST_MINDMAP_NODE_SHAPES.map(shape => ({
                id: shape, iconHTML: "", label: shapeLabels[shape], checked: shapes.every(value => value === shape),
                click: () => select(ids, {shape}),
            })),
        ],
    }];
    if (connectorIds.length) {
        const current = connectors.every(style => style === connectors[0]) ? connectors[0] : undefined;
        items.unshift(getListMindmapConnectorMenuItem(current,
            connectorStyle => select(connectorIds, {connectorStyle}), labels, "current", {
                checked: connectors.every(style => style === undefined),
                click: () => select(connectorIds, {connectorStyle: undefined}),
            }));
    }
    return items;
};
