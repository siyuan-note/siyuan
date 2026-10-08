// 此文件由内核字段能力声明生成，请运行 pnpm run api:generate 更新。

export type AVKeyType = "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber";
export type AVFilterOperator = "=" | "!=" | ">" | ">=" | "<" | "<=" | "Contains" | "Does not contains" | "Contains any item" | "Does not contain any item" | "Is empty" | "Is not empty" | "Starts with" | "Ends with" | "Is between" | "Is true" | "Is false";

/** 字段基础能力仅用于类型分派，不属于 AV 持久化格式 */
export interface AVKeyCapability {
    readonly valueKind: "assets" | "checkbox" | "date" | "lineNumber" | "number" | "options" | "relation" | "rollup" | "text" | "timestamp";
    readonly editable: boolean;
    readonly filterable: boolean;
    readonly sortable: boolean;
    /** 资源字段分组还需要显示模板 */
    readonly groupable: boolean;
    /** 行号为空，关联的汇总取值使用 Contains */
    readonly defaultOperator: AVFilterOperator | "";
}
