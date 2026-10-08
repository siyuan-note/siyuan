import type {AVFilterOperator, AVKeyCapability, AVKeyGroup, AVKeyType} from "../../../types/av";
import {AV_CALC_FILTER_NUMBER_OPERATORS, AV_FILTER_CAPABILITIES, AV_KEY_CAPABILITIES, AV_KEY_TYPES} from "./capabilities.generated";

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

export const hasAVKeyGroup = (type: string | undefined | null, group: AVKeyGroup) =>
    getAVKeyCapability(type)?.groups?.includes(group) === true;

export const isAVRichTextType = (type: string | undefined | null) => hasAVKeyGroup(type, "richText");

export const isAVLinkType = (type: string | undefined | null) =>
    hasAVKeyGroup(type, "link");

export const hasAVScalarContent = (type: string | undefined | null) =>
    hasAVKeyGroup(type, "scalarContent");

export const hasAVAttributePlaceholder = (type: string | undefined | null) =>
    hasAVKeyGroup(type, "attributePlaceholder");

export const usesAVRollupCellRenderer = (type: string | undefined | null) =>
    hasAVKeyGroup(type, "rollupCell");

export const isAVNewItemTemplateType = (type: string | undefined | null) =>
    hasAVKeyGroup(type, "newItemTemplate");

export const getAVOfferedFilterOperators = (type: string, isRollup = false): readonly AVFilterOperator[] => {
    const profile = getAVKeyCapability(type)?.filterProfile;
    const capability = profile && AV_FILTER_CAPABILITIES[profile];
    return capability ? (isRollup && capability.offeredRollup || capability.offered) : [];
};

export const isAVNumericFilterCalcOperator = (operator: string | undefined) =>
    AV_CALC_FILTER_NUMBER_OPERATORS.some(item => item === operator);

export const getAVDefaultFilterOperator = (type: string, isRollup = false): AVFilterOperator | undefined => {
    if (type === "relation" && isRollup) {
        return "Contains";
    }
    return getAVKeyCapability(type)?.defaultOperator || undefined;
};

export const AV_DATE_TYPES = AV_KEY_TYPES.filter(isAVDateType);
