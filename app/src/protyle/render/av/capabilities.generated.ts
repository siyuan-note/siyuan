// 此文件由内核字段能力声明生成，请运行 pnpm run api:generate 更新。

import type {AVKeyType, AVKeyCapability} from "../../../types/av";

export const AV_KEY_TYPES: readonly AVKeyType[] = ["block","text","number","date","select","mSelect","url","email","phone","mAsset","template","created","updated","checkbox","relation","rollup","lineNumber"];

export const AV_KEY_CAPABILITIES: Readonly<Record<AVKeyType, AVKeyCapability>> = {
    "block": {"valueKind":"text","editable":true,"filterable":true,"sortable":true,"groupable":true,"defaultOperator":"Contains"},
    "text": {"valueKind":"text","editable":true,"filterable":true,"sortable":true,"groupable":true,"defaultOperator":"Contains"},
    "number": {"valueKind":"number","editable":true,"filterable":true,"sortable":true,"groupable":true,"defaultOperator":"="},
    "date": {"valueKind":"date","editable":true,"filterable":true,"sortable":true,"groupable":true,"defaultOperator":"="},
    "select": {"valueKind":"options","editable":true,"filterable":true,"sortable":true,"groupable":true,"defaultOperator":"="},
    "mSelect": {"valueKind":"options","editable":true,"filterable":true,"sortable":true,"groupable":true,"defaultOperator":"Contains"},
    "url": {"valueKind":"text","editable":true,"filterable":true,"sortable":true,"groupable":true,"defaultOperator":"Contains"},
    "email": {"valueKind":"text","editable":true,"filterable":true,"sortable":true,"groupable":true,"defaultOperator":"Contains"},
    "phone": {"valueKind":"text","editable":true,"filterable":true,"sortable":true,"groupable":true,"defaultOperator":"Contains"},
    "mAsset": {"valueKind":"assets","editable":true,"filterable":true,"sortable":true,"groupable":true,"defaultOperator":"Contains"},
    "template": {"valueKind":"text","editable":false,"filterable":true,"sortable":true,"groupable":true,"defaultOperator":"Contains"},
    "created": {"valueKind":"timestamp","editable":false,"filterable":true,"sortable":true,"groupable":true,"defaultOperator":"="},
    "updated": {"valueKind":"timestamp","editable":false,"filterable":true,"sortable":true,"groupable":true,"defaultOperator":"="},
    "checkbox": {"valueKind":"checkbox","editable":true,"filterable":true,"sortable":true,"groupable":true,"defaultOperator":"="},
    "relation": {"valueKind":"relation","editable":true,"filterable":true,"sortable":true,"groupable":true,"defaultOperator":"Contains any item"},
    "rollup": {"valueKind":"rollup","editable":false,"filterable":true,"sortable":true,"groupable":false,"defaultOperator":"Contains"},
    "lineNumber": {"valueKind":"lineNumber","editable":false,"filterable":false,"sortable":false,"groupable":false,"defaultOperator":""},
};
