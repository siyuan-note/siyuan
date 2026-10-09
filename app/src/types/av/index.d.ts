// 此文件由内核字段能力声明生成，请运行 pnpm run api:generate 更新。

export type AVKeyType = "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber";
export type AVFilterOperator = "=" | "!=" | ">" | ">=" | "<" | "<=" | "Contains" | "Does not contains" | "Contains any item" | "Does not contain any item" | "Is empty" | "Is not empty" | "Starts with" | "Ends with" | "Is between" | "Is true" | "Is false";

export type AVKeyGroup = "none" | "richText" | "link" | "scalarContent" | "attributePlaceholder" | "rollupCell" | "newItemTemplate" | "noFilterDefault" | "renderDependentFilter" | "skipRowCopy" | "renderAutoFill" | "rollupAlwaysRender" | "rollupForeignRender";
export type AVFilterProfile = "checkbox" | "date" | "mSelect" | "none" | "number" | "relation" | "rollup" | "select" | "template" | "text";
export type AVCalcOperator = "" | "Average" | "Checked" | "Count all" | "Count empty" | "Count not empty" | "Count unique values" | "Count values" | "Earliest" | "Latest" | "Max" | "Median" | "Min" | "Percent checked" | "Percent empty" | "Percent not empty" | "Percent unchecked" | "Percent unique values" | "Range" | "Sum" | "Template" | "Unchecked" | "Unique values";

/** 接受集合与界面呈现集合独立，呈现集合保留选项顺序 */
export interface AVFilterCapability {
    readonly accepted: readonly AVFilterOperator[];
    readonly offered: readonly AVFilterOperator[];
    readonly offeredRollup?: readonly AVFilterOperator[];
}

/** 字段基础能力仅用于类型分派，不属于 AV 持久化格式 */
export interface AVKeyCapability {
    /** 派生用途由内核声明，none 表示明确不属于任何用途分组 */
    readonly groups?: readonly AVKeyGroup[];
    /** 用于选择接受与呈现的算子集合，保留旧调用方构造基础能力对象的兼容性 */
    readonly filterProfile?: AVFilterProfile;
    readonly valueKind: "assets" | "checkbox" | "date" | "lineNumber" | "number" | "options" | "relation" | "rollup" | "text" | "timestamp";
    readonly editable: boolean;
    readonly filterable: boolean;
    readonly sortable: boolean;
    /** 资源字段分组还需要显示模板 */
    readonly groupable: boolean;
    /** 行号为空，关联的汇总取值使用 Contains */
    readonly defaultOperator: AVFilterOperator | "";
}
