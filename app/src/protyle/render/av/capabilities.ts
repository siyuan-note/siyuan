import type {AVFilterOperator, AVKeyCapability, AVKeyType} from "../../../types/av";
import {AV_KEY_CAPABILITIES, AV_KEY_TYPES} from "./capabilities.generated";

export const isAVKeyType = (type: string): type is AVKeyType =>
    Object.prototype.hasOwnProperty.call(AV_KEY_CAPABILITIES, type);

export const getAVKeyCapability = (type: string | undefined | null): AVKeyCapability | undefined =>
    typeof type === "string" && isAVKeyType(type) ? AV_KEY_CAPABILITIES[type] : undefined;

export const hasAVCapability = (type: string | undefined | null,
                               capability: "editable" | "filterable" | "sortable" | "groupable") =>
    getAVKeyCapability(type)?.[capability] === true;

export const getAVTypesByCapability = (capability: "editable" | "filterable" | "sortable" | "groupable") =>
    AV_KEY_TYPES.filter(type => hasAVCapability(type, capability));

export const isAVDateType = (type: string | undefined | null) => {
    const kind = getAVKeyCapability(type)?.valueKind;
    return kind === "date" || kind === "timestamp";
};

export const isAVTimestampType = (type: string | undefined | null) =>
    getAVKeyCapability(type)?.valueKind === "timestamp";

export const isAVSelectType = (type: string | undefined | null) =>
    getAVKeyCapability(type)?.valueKind === "options";

export const isAVTextType = (type: string | undefined | null) =>
    getAVKeyCapability(type)?.valueKind === "text";

export const isAVReadonlyType = (type: string | undefined | null) =>
    getAVKeyCapability(type)?.editable === false;

export const isAVRichTextType = (type: string | undefined | null) => isAVTextType(type) && type !== "url";

export const isAVLinkType = (type: string | undefined | null) =>
    isAVTextType(type) && type !== "text" && type !== "template";

export const hasAVScalarContent = (type: string | undefined | null) =>
    isAVTextType(type) || type === "number" || type === "mAsset";

export const hasAVAttributePlaceholder = (type: string | undefined | null) =>
    isAVTextType(type) && type !== "block" || type === "number" || type === "date";

export const usesAVRollupCellRenderer = (type: string | undefined | null) =>
    isAVSelectType(type) || type === "template" || type === "mAsset" || type === "relation";

export const isAVNewItemTemplateType = (type: string | undefined | null) =>
    hasAVCapability(type, "editable") && type !== "block";

export const getAVDefaultFilterOperator = (type: string, isRollup = false): AVFilterOperator | undefined => {
    if (type === "relation" && isRollup) {
        return "Contains";
    }
    return getAVKeyCapability(type)?.defaultOperator || undefined;
};

export const AV_DATE_TYPES = AV_KEY_TYPES.filter(isAVDateType);
