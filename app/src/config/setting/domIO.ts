import {getAtPath} from "../util/dotPath";

/** 解析并钳制 number / range 数值 */
export const normalizeNumberInputValue = (el: HTMLInputElement): number => {
    const step = el.getAttribute("step")?.trim().toLowerCase() ?? "";
    const useFloat = step === "any" || step.includes(".");
    const parseNum = (s: string) => (useFloat ? parseFloat(s) : parseInt(s, 10));
    let number = useFloat ? parseFloat(el.value) : parseInt(el.value, 10);
    if (Number.isNaN(number)) {
        const raw = getAtPath(window.siyuan.config, el.id);
        number = typeof raw === "number" && !Number.isNaN(raw) ? raw : 0;
    }
    const minRaw = el.getAttribute("min") ?? "";
    const maxRaw = el.getAttribute("max") ?? "";
    const min = minRaw === "" ? NaN : parseNum(minRaw);
    const max = maxRaw === "" ? NaN : parseNum(maxRaw);
    if (!Number.isNaN(min)) {
        number = Math.max(min, number);
    }
    if (!Number.isNaN(max)) {
        number = Math.min(max, number);
    }
    return number;
};

/** 按 min / max / step 生成可选值列表（与 range 下拉选项一致） */
export const buildRangeValues = (min: number, max: number, step: number): number[] => {
    const values: number[] = [];
    if (!Number.isInteger(step)) {
        for (let v = min; v <= max + step * 0.001; v += step) {
            values.push(Math.round(v * 1000) / 1000);
        }
        return values;
    }
    for (let v = min; v <= max; v += step) {
        values.push(v);
    }
    return values;
};

/** 将数值对齐到最近的合法档位 */
export const snapRangeValue = (value: number, min: number, max: number, step: number): number => {
    const values = buildRangeValues(min, max, step);
    if (!values.length) {
        return min;
    }
    const v = Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min;
    return values.reduce((best, n) => (Math.abs(n - v) < Math.abs(best - v) ? n : best), values[0]);
};

/** 同步 range 行内滑块与移动端下拉的显示值；非 range 行返回 undefined */
export const syncRangeRowValue = (el: HTMLElement): number | undefined => {
    const wrap = el?.closest(".config-wrap--range");
    if (!wrap) {
        return undefined;
    }
    const rangeEl = wrap.querySelector<HTMLInputElement>('input[type="range"]');
    const selectEl = wrap.querySelector<HTMLSelectElement>(".config-range__mobile");
    if (!rangeEl || !selectEl) {
        return undefined;
    }
    const min = parseFloat(rangeEl.min);
    const max = parseFloat(rangeEl.max);
    const step = parseFloat(rangeEl.step);
    const raw = el === selectEl ? parseInt(selectEl.value, 10) : normalizeNumberInputValue(rangeEl);
    const snapped = snapRangeValue(Number.isNaN(raw) ? min : raw, min, max, step);
    const valueStr = String(snapped);
    rangeEl.value = valueStr;
    selectEl.value = valueStr;
    return snapped;
};
