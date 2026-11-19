import {getMindmapRelationPathStyle, getMindmapRelationStrokeStyle, MINDMAP_RELATION_PATHS,
    MINDMAP_RELATION_STROKES} from "./relationGeometry";
import type {ListMindmapRelation} from "./model";

export const getMindmapRelationMenuItems = (relation: ListMindmapRelation,
    select: (patch: Partial<ListMindmapRelation>) => void, labels: Record<string, string>): IMenu[] => {
    const paths = {auto: labels.listMindmapRelationAuto, straight: labels.listMindmapRelationStraight,
        bezier: labels.listMindmapRelationBezier, rounded: labels.listMindmapConnectorRounded};
    const strokes = {solid: labels.listMindmapRelationSolid, dashed: labels.listMindmapRelationDashed,
        "long-dashed": labels.listMindmapRelationLongDashed, dotted: labels.listMindmapRelationDotted};
    return [{id: "relationPath", iconHTML: "", label: labels.listMindmapRelationPath,
        submenu: MINDMAP_RELATION_PATHS.map(pathStyle => ({id: pathStyle, iconHTML: "", label: paths[pathStyle],
            checked: getMindmapRelationPathStyle(relation) === pathStyle, click: () => select({pathStyle})}))},
    {id: "relationStroke", iconHTML: "", label: labels.listMindmapRelationStroke,
        submenu: MINDMAP_RELATION_STROKES.map(strokeStyle => ({id: strokeStyle, iconHTML: "", label: strokes[strokeStyle],
            checked: getMindmapRelationStrokeStyle(relation) === strokeStyle, click: () => select({strokeStyle})}))}];
};
