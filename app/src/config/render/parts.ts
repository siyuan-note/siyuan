import type {SettingControl} from "../setting/control";

/** 组合式行：文案与控件部件（引擎统一渲染 / 检索） */
export type RowPart =
    | {
        kind: "title";
        text: string;
    }
    | {
        kind: "desc";
        text: string;
    }
    | SettingControl;

export const isSettingControl = (part: RowPart): part is SettingControl =>
    "readConfig" in part && "readValue" in part;

/** `config-query` 网格内单条开关 */
type SwitchQuerySwitchItem = Extract<SettingControl, {kind: "switch"}> & {
    label: string;
    icon?: string;
};

/** `config-query` 网格内单条数字框 */
type SwitchQueryNumberItem = Extract<SettingControl, {kind: "number"}> & {
    label: string;
};

export type SwitchQueryItem = SwitchQuerySwitchItem | SwitchQueryNumberItem;

/** stack 左列 */
export type StackLeft =
    | {kind: "title"; text: string}
    | {kind: "desc"; text: string}
    | Extract<SettingControl, {kind: "textBlock"}>;

/** stack 右列控件 */
export type StackRight =
    | {kind: "button"; id: string; label: string; icon: string}
    | Extract<SettingControl, {kind: "switch" | "number" | "select"}>;

export type StackLine = {
    left: StackLeft;
    right?: StackRight;
};
