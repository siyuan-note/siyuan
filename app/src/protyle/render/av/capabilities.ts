import type {AVFilterOperator, AVKeyCapability, AVKeyGroup, AVKeyType} from "../../../types/av";
import {AV_CALC_FILTER_NUMBER_OPERATORS, AV_FILTER_CAPABILITIES, AV_KEY_CAPABILITIES, AV_KEY_TYPES} from "./capabilities.generated";

export const isAVKeyType = (type: string): type is AVKeyType =>
    Object.prototype.hasOwnProperty.call(AV_KEY_CAPABILITIES, type);

export const getAVKeyCapability = (type: string | undefined | null): AVKeyCapability | undefined =>
    typeof type === "string" && isAVKeyType(type) ? AV_KEY_CAPABILITIES[type] : undefined;

// 渲染按单元格反复判断字段类型，逐次读取能力表对象比直接比较字符串慢一个数量级。
// 这里在加载时把能力表转成索引，谓词只需要一次集合查找。
const typesOfValueKind = (kind: string): ReadonlySet<string> =>
    new Set(AV_KEY_TYPES.filter(type => AV_KEY_CAPABILITIES[type].valueKind === kind));

const dateLikeTypes: ReadonlySet<string> = new Set(AV_KEY_TYPES.filter(type => {
    const kind = AV_KEY_CAPABILITIES[type].valueKind;
    return kind === "date" || kind === "timestamp";
}));
const timestampTypes = typesOfValueKind("timestamp");
const optionTypes = typesOfValueKind("options");
const textTypes = typesOfValueKind("text");
const readonlyTypes: ReadonlySet<string> = new Set(AV_KEY_TYPES.filter(type => AV_KEY_CAPABILITIES[type].editable === false));
const groupMembers = new Map<AVKeyGroup, Set<string>>();
for (const type of AV_KEY_TYPES) {
    for (const group of AV_KEY_CAPABILITIES[type].groups || []) {
        const members = groupMembers.get(group) || new Set<string>();
        members.add(type);
        groupMembers.set(group, members);
    }
}

export const hasAVCapability = (type: string | undefined | null,
                               capability: "editable" | "filterable" | "sortable" | "groupable") =>
    getAVKeyCapability(type)?.[capability] === true;

export const getAVTypesByCapability = (capability: "editable" | "filterable" | "sortable" | "groupable") =>
    AV_KEY_TYPES.filter(type => hasAVCapability(type, capability));

export const isAVDateType = (type: string | undefined | null): boolean =>
    typeof type === "string" && dateLikeTypes.has(type);

export const isAVTimestampType = (type: string | undefined | null): boolean =>
    typeof type === "string" && timestampTypes.has(type);

export const isAVSelectType = (type: string | undefined | null): boolean =>
    typeof type === "string" && optionTypes.has(type);

export const isAVTextType = (type: string | undefined | null): boolean =>
    typeof type === "string" && textTypes.has(type);

export const isAVReadonlyType = (type: string | undefined | null): boolean =>
    typeof type === "string" && readonlyTypes.has(type);

export const hasAVKeyGroup = (type: string | undefined | null, group: AVKeyGroup): boolean => {
    const members = groupMembers.get(group);
    return !!members && typeof type === "string" && members.has(type);
};

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
