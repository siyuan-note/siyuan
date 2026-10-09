// 此文件由内核字段能力声明生成，请运行 pnpm run api:generate 更新。

import type {AVKeyType, AVKeyCapability, AVFilterProfile, AVFilterCapability, AVCalcOperator} from "../../../types/av";

export const AV_KEY_TYPES: readonly AVKeyType[] = ["block","text","number","date","select","mSelect","url","email","phone","mAsset","template","created","updated","checkbox","relation","rollup","lineNumber","location"];

export const AV_KEY_CAPABILITIES: Readonly<Record<AVKeyType, AVKeyCapability>> = {
    "block": {"groups":["richText","link","scalarContent"],"filterProfile":"text","valueKind":"text","editable":true,"filterable":true,"sortable":true,"groupable":true,"defaultOperator":"Contains"},
    "text": {"groups":["richText","scalarContent","attributePlaceholder","newItemTemplate"],"filterProfile":"text","valueKind":"text","editable":true,"filterable":true,"sortable":true,"groupable":true,"defaultOperator":"Contains"},
    "number": {"groups":["scalarContent","attributePlaceholder","newItemTemplate"],"filterProfile":"number","valueKind":"number","editable":true,"filterable":true,"sortable":true,"groupable":true,"defaultOperator":"="},
    "date": {"groups":["attributePlaceholder","newItemTemplate"],"filterProfile":"date","valueKind":"date","editable":true,"filterable":true,"sortable":true,"groupable":true,"defaultOperator":"="},
    "select": {"groups":["rollupCell","newItemTemplate"],"filterProfile":"select","valueKind":"options","editable":true,"filterable":true,"sortable":true,"groupable":true,"defaultOperator":"="},
    "mSelect": {"groups":["rollupCell","newItemTemplate"],"filterProfile":"mSelect","valueKind":"options","editable":true,"filterable":true,"sortable":true,"groupable":true,"defaultOperator":"Contains"},
    "url": {"groups":["link","scalarContent","attributePlaceholder","newItemTemplate"],"filterProfile":"text","valueKind":"text","editable":true,"filterable":true,"sortable":true,"groupable":true,"defaultOperator":"Contains"},
    "email": {"groups":["richText","link","scalarContent","attributePlaceholder","newItemTemplate"],"filterProfile":"text","valueKind":"text","editable":true,"filterable":true,"sortable":true,"groupable":true,"defaultOperator":"Contains"},
    "phone": {"groups":["richText","link","scalarContent","attributePlaceholder","newItemTemplate"],"filterProfile":"text","valueKind":"text","editable":true,"filterable":true,"sortable":true,"groupable":true,"defaultOperator":"Contains"},
    "mAsset": {"groups":["scalarContent","rollupCell","newItemTemplate","renderDependentFilter"],"filterProfile":"text","valueKind":"assets","editable":true,"filterable":true,"sortable":true,"groupable":true,"defaultOperator":"Contains"},
    "template": {"groups":["richText","scalarContent","attributePlaceholder","rollupCell","noFilterDefault","renderDependentFilter","renderAutoFill","rollupAlwaysRender"],"filterProfile":"template","valueKind":"text","editable":false,"filterable":true,"sortable":true,"groupable":true,"defaultOperator":"Contains"},
    "created": {"groups":["noFilterDefault","renderDependentFilter","skipRowCopy","renderAutoFill","rollupForeignRender"],"filterProfile":"date","valueKind":"timestamp","editable":false,"filterable":true,"sortable":true,"groupable":true,"defaultOperator":"="},
    "updated": {"groups":["noFilterDefault","renderDependentFilter","skipRowCopy","renderAutoFill","rollupForeignRender"],"filterProfile":"date","valueKind":"timestamp","editable":false,"filterable":true,"sortable":true,"groupable":true,"defaultOperator":"="},
    "checkbox": {"groups":["newItemTemplate"],"filterProfile":"checkbox","valueKind":"checkbox","editable":true,"filterable":true,"sortable":true,"groupable":true,"defaultOperator":"="},
    "relation": {"groups":["rollupCell","newItemTemplate","rollupForeignRender"],"filterProfile":"relation","valueKind":"relation","editable":true,"filterable":true,"sortable":true,"groupable":true,"defaultOperator":"Contains any item"},
    "rollup": {"groups":["noFilterDefault","renderDependentFilter","skipRowCopy"],"filterProfile":"rollup","valueKind":"rollup","editable":false,"filterable":true,"sortable":true,"groupable":false,"defaultOperator":"Contains"},
    "lineNumber": {"groups":["none"],"filterProfile":"none","valueKind":"lineNumber","editable":false,"filterable":false,"sortable":false,"groupable":false,"defaultOperator":""},
    "location": {"groups":["attributePlaceholder","rollupCell","newItemTemplate","noFilterDefault"],"filterProfile":"text","valueKind":"location","editable":true,"filterable":true,"sortable":true,"groupable":false,"defaultOperator":"Contains"},
};

export const AV_FILTER_CAPABILITIES: Readonly<Record<AVFilterProfile, AVFilterCapability>> = {
    "checkbox": {"accepted":["=","!=","Is true","Is false"],"offered":["=","!="]},
    "date": {"accepted":["=","\u003e","\u003c","\u003e=","\u003c=","Is between","Is empty","Is not empty"],"offered":["=","\u003e","\u003c","\u003e=","\u003c=","Is between","Is empty","Is not empty"]},
    "mSelect": {"accepted":["Contains","Does not contains","Is empty","Is not empty"],"offered":["Contains","Does not contains","Is empty","Is not empty"]},
    "none": {"accepted":[],"offered":[]},
    "number": {"accepted":["=","!=","\u003e","\u003c","\u003e=","\u003c=","Is empty","Is not empty"],"offered":["=","!=","\u003e","\u003c","\u003e=","\u003c=","Is empty","Is not empty"]},
    "relation": {"accepted":["Contains any item","Does not contain any item","Contains","Does not contains","Is empty","Is not empty"],"offered":["Contains any item","Does not contain any item","Contains","Does not contains","Is empty","Is not empty"],"offeredRollup":["Contains","Does not contains","Is empty","Is not empty"]},
    "rollup": {"accepted":["=","!=","\u003e","\u003e=","\u003c","\u003c=","Contains","Does not contains","Contains any item","Does not contain any item","Is empty","Is not empty","Starts with","Ends with","Is between"],"offered":[]},
    "select": {"accepted":["=","!=","Is empty","Is not empty"],"offered":["=","!=","Is empty","Is not empty"]},
    "template": {"accepted":["=","!=","Contains","Does not contains","Starts with","Ends with","Is empty","Is not empty","\u003e","\u003c","\u003e=","\u003c="],"offered":["=","!=","Contains","Does not contains","Starts with","Ends with","Is empty","Is not empty","\u003e","\u003c","\u003e=","\u003c="]},
    "text": {"accepted":["=","!=","Contains","Does not contains","Starts with","Ends with","Is empty","Is not empty"],"offered":["=","!=","Contains","Does not contains","Starts with","Ends with","Is empty","Is not empty"]},
};

export const AV_CALC_FILTER_NUMBER_OPERATORS: readonly AVCalcOperator[] = ["Average","Checked","Count all","Count empty","Count not empty","Count unique values","Count values","Max","Median","Min","Percent checked","Percent empty","Percent not empty","Percent unchecked","Percent unique values","Sum","Unchecked"];
