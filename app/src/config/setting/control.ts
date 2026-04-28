import {bindPasswordIconaToggle} from "../render/fragments";
import {getAtPath} from "../util/dotPath";
import {normalizeNumberInputValue, snapRangeValue, syncRangeRowValue} from "./domIO";

type SelectOption = {
    value: number | string;
    label?: string;
};

type ControlBase = {
    id: string;
    /** mount 时从 config 读取初值（含自定义逻辑） */
    readConfig(): unknown;
    /** change 时从 DOM 解析提交值 */
    readValue(el: HTMLElement): unknown;
    afterMount?: (root: HTMLElement) => void | Promise<void>;
};

type BooleanControl = ControlBase & {kind: "switch"};
type NumberControl = ControlBase & {
    kind: "number";
    min?: number;
    max?: number;
    step?: string;
    unit?: string;
};
type RangeControl = ControlBase & {
    kind: "range";
    min: number;
    max: number;
    step: number;
};
type SelectControl = ControlBase & {
    kind: "select";
    options: SelectOption[];
};
export type StringControl = ControlBase & {kind: "text"};
type TextBlockControl = ControlBase & {
    kind: "textBlock";
    mode: "input-text" | "input-password" | "textarea";
};

export type SettingControl =
    | BooleanControl
    | NumberControl
    | RangeControl
    | SelectControl
    | StringControl
    | TextBlockControl;

const readConfigAt = (id: string): unknown => getAtPath(window.siyuan.config, id);

const coerceNumber = (raw: unknown, fallback: number): number =>
    typeof raw === "number" && !Number.isNaN(raw) ? raw : fallback;

const coerceString = (raw: unknown, fallback: string): string =>
    typeof raw === "string" ? raw : fallback;

const clampNumber = (n: number, min?: number, max?: number): number => {
    let result = n;
    if (min !== undefined) {
        result = Math.max(min, result);
    }
    if (max !== undefined) {
        result = Math.min(max, result);
    }
    return result;
};

const coerceSelectValue = (
    raw: unknown,
    options: SelectOption[],
): number | string => {
    const firstVal = options[0]?.value;
    if (options.length > 0 && typeof firstVal === "number") {
        return coerceNumber(raw, firstVal);
    }
    return coerceString(raw, typeof firstVal === "string" ? firstVal : "");
};

const isNumericSelect = (options: SelectOption[]): boolean =>
    options.length > 0 && typeof options[0].value === "number";

const readSelectValue = (el: HTMLElement, options: SelectOption[]): number | string => {
    const select = el as HTMLSelectElement;
    return isNumericSelect(options) ? parseInt(select.value, 10) : select.value;
};

export const controlBoolean = (
    id: string,
    options?: {readConfig?: () => boolean},
): BooleanControl => ({
    kind: "switch",
    id,
    readConfig: () => options?.readConfig?.() ?? Boolean(readConfigAt(id)),
    readValue: (el) => (el as HTMLInputElement).checked,
});

export const controlNumber = (
    id: string,
    options?: {
        min?: number;
        max?: number;
        step?: string;
        unit?: string;
        fallback?: number;
        readConfig?: () => number;
    },
): NumberControl => {
    const {min, max, step, unit, fallback = 0, readConfig} = options ?? {};
    return {
        kind: "number",
        id,
        min,
        max,
        step,
        unit,
        readConfig: () => {
            const n = readConfig?.() ?? coerceNumber(readConfigAt(id), fallback);
            return clampNumber(n, min, max);
        },
        readValue: (el) => {
            const input = el as HTMLInputElement;
            const value = clampNumber(normalizeNumberInputValue(input), min, max);
            const valueStr = String(value);
            if (input.value !== valueStr) {
                input.value = valueStr;
            }
            return value;
        },
    };
};

export const controlRange = (
    id: string,
    options: {min: number; max: number; step: number; readConfig?: () => number},
): RangeControl => {
    const {min, max, step, readConfig} = options;
    const readConfigSnapped = () => {
        const raw = readConfig?.() ?? coerceNumber(readConfigAt(id), min);
        return snapRangeValue(raw, min, max, step);
    };
    return {
        kind: "range",
        id,
        min,
        max,
        step,
        readConfig: readConfigSnapped,
        readValue: (el) => {
            const synced = syncRangeRowValue(el);
            if (synced !== undefined) {
                return synced;
            }
            const n = normalizeNumberInputValue(el as HTMLInputElement);
            return snapRangeValue(Number.isNaN(n) ? min : n, min, max, step);
        },
    };
};

export const controlSelect = (
    id: string,
    options: {options: SelectOption[]; readConfig?: () => number | string},
): SelectControl => ({
    kind: "select",
    id,
    options: options.options,
    readConfig: () => options.readConfig?.() ?? coerceSelectValue(readConfigAt(id), options.options),
    readValue: (el) => readSelectValue(el, options.options),
});

export const controlString = (
    id: string,
    options?: {readConfig?: () => string; fallback?: string},
): StringControl => {
    const fallback = options?.fallback ?? "";
    return {
        kind: "text",
        id,
        readConfig: () => options?.readConfig?.() ?? coerceString(readConfigAt(id), fallback),
        readValue: (el) => (el as HTMLInputElement | HTMLTextAreaElement).value,
    };
};

export const controlTextBlock = (
    id: string,
    options: {
        mode: "input-text" | "input-password" | "textarea";
        readConfig?: () => string;
        fallback?: string;
    },
): TextBlockControl => {
    const fallback = options.fallback ?? "";
    return {
        kind: "textBlock",
        id,
        mode: options.mode,
        readConfig: () => options.readConfig?.() ?? coerceString(readConfigAt(id), fallback),
        readValue: (el) => (el as HTMLInputElement | HTMLTextAreaElement).value,
        afterMount: options.mode === "input-password"
            ? (root) => bindPasswordIconaToggle(root, id)
            : undefined,
    };
};
