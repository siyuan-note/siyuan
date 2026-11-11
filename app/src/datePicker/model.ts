export type TDatePickerType = "date" | "datetime-local" | "time";
export interface ICivilDate {year: number; month: number; day: number}
export interface IDateConstraints {
    type: TDatePickerType;
    min?: string;
    max?: string;
    step?: string;
    required?: boolean;
    stepBase?: string;
}
export type TDateValidity = "valid" | "required" | "format" | "min" | "max" | "step";
const DAY = 86400000;
const pad = (value: number, length = 2) => String(value).padStart(length, "0");
export const isDatePickerType = (type: string): type is TDatePickerType =>
    type === "date" || type === "datetime-local" || type === "time";
export const daysInMonth = (year: number, month: number) =>
    month === 2 ? (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28) :
        [4, 6, 9, 11].includes(month) ? 30 : 31;
export const formatDate = (date: ICivilDate) => `${pad(date.year, 4)}-${pad(date.month)}-${pad(date.day)}`;
export const parseDate = (value: string): ICivilDate | undefined => {
    const match = /^(\d{4,})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) { return; }
    const [year, month, day] = match.slice(1).map(Number);
    if (year < 1 || year > 275760 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) { return; }
    if (year === 275760 && (month > 9 || (month === 9 && day > 13))) { return; }
    return {year, month, day};
};
export const dateToDays = ({year, month, day}: ICivilDate) => {
    const previous = year - 1;
    let days = previous * 365 + Math.floor(previous / 4) - Math.floor(previous / 100) + Math.floor(previous / 400);
    for (let i = 1; i < month; i++) { days += daysInMonth(year, i); }
    return days + day - 719163;
};
export const daysToDate = (days: number): ICivilDate => {
    let year = Math.max(1, Math.min(275760, Math.floor((days + 719162) / 365.2425) + 1));
    while (year > 1 && dateToDays({year, month: 1, day: 1}) > days) { year--; }
    while (year < 275760 && dateToDays({year: year + 1, month: 1, day: 1}) <= days) { year++; }
    let remaining = days - dateToDays({year, month: 1, day: 1});
    let month = 1;
    while (month < 12 && remaining >= daysInMonth(year, month)) { remaining -= daysInMonth(year, month++); }
    return {year, month, day: remaining + 1};
};
export const addDays = (date: ICivilDate, amount: number) => daysToDate(Math.max(dateToDays({year: 1, month: 1, day: 1}),
    Math.min(dateToDays({year: 275760, month: 9, day: 13}), dateToDays(date) + amount)));
export const addMonths = (date: ICivilDate, amount: number): ICivilDate => {
    const serial = Math.max(12, Math.min(275760 * 12 + 8, date.year * 12 + date.month - 1 + amount));
    const year = Math.floor(serial / 12);
    const month = serial % 12 + 1;
    return {year, month, day: Math.min(date.day, daysInMonth(year, month), year === 275760 && month === 9 ? 13 : 31)};
};
export const parseTime = (value: string): number | undefined => {
    const match = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value);
    if (!match) { return; }
    const [hour, minute, second] = [Number(match[1]), Number(match[2]), Number(match[3] || 0)];
    if (hour > 23 || minute > 59 || second > 59) { return; }
    return ((hour * 60 + minute) * 60 + second) * 1000 + Number((match[4] || "").padEnd(3, "0"));
};
export const formatTime = (value: number) => {
    const hour = Math.floor(value / 3600000);
    const minute = Math.floor(value / 60000) % 60;
    const second = Math.floor(value / 1000) % 60;
    const fraction = value % 1000;
    return `${pad(hour)}:${pad(minute)}` + (second || fraction ? `:${pad(second)}` : "") +
        (fraction ? "." + pad(fraction, 3).replace(/0+$/, "") : "");
};
export const valueToNumber = (value: string, type: TDatePickerType): number | undefined => {
    if (type === "time") { return parseTime(value); }
    const parts = value.split("T");
    if (parts.length !== (type === "date" ? 1 : 2)) { return; }
    const date = parseDate(parts[0]);
    const time = type === "date" ? 0 : parseTime(parts[1]);
    if (!date || time === undefined) { return; }
    const number = dateToDays(date) * DAY + time;
    if (number > 8640000000000000) { return; }
    return number;
};
const stepSize = (options: IDateConstraints) => {
    if (options.step?.toLowerCase() === "any") { return 0; }
    const valid = /^(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(options.step || "") &&
        Number.isFinite(Number(options.step)) && /[1-9]/.test(options.step.split(/[eE]/)[0]);
    const raw = valid ? options.step : options.type === "date" ? "1" : "60";
    const [mantissa, exponent = "0"] = raw.split(/[eE]/);
    const [integer, fraction = ""] = mantissa.split(".");
    const digits = (integer + fraction).replace(/^0+/, "");
    const point = digits.length + Number(exponent) + (options.type === "date" ? 0 : 3) - fraction.length;
    // 直接按十进制数位取整，避免 0.5005 * 1000 的二进制误差把 501 毫秒变成 500 毫秒。
    const units = point <= 0 ? 1 : point >= digits.length ? Number(`${digits}e${point - digits.length}`) :
        Number(digits.substring(0, point)) + (digits[point] >= "5" ? 1 : 0);
    return Math.min(Number.MAX_VALUE, Math.max(1, units) * (options.type === "date" ? DAY : 1));
};
const constraintNumber = (value: string, type: TDatePickerType) =>
    valueToNumber(type === "datetime-local" ? (value || "").replace(" ", "T") : value || "", type);
const stepBase = (options: IDateConstraints) => constraintNumber(options.min, options.type) ??
    constraintNumber(options.stepBase, options.type) ?? 0;
export const validateDateValue = (value: string, options: IDateConstraints): TDateValidity => {
    if (value === "") { return options.required ? "required" : "valid"; }
    const number = valueToNumber(value, options.type);
    if (number === undefined) { return "format"; }
    const min = constraintNumber(options.min, options.type);
    const max = constraintNumber(options.max, options.type);
    if (options.type === "time" && min !== undefined && max !== undefined && min > max) {
        if (number < min && number > max) { return "min"; }
    } else {
        if (min !== undefined && number < min) { return "min"; }
        if (max !== undefined && number > max) { return "max"; }
    }
    const step = stepSize(options);
    if (step && (number - stepBase(options)) % step !== 0) { return "step"; }
    return "valid";
};
export const candidateForDay = (date: ICivilDate, options: IDateConstraints, time = "00:00"): string | undefined => {
    const day = formatDate(date);
    if (options.type === "date") { return validateDateValue(day, options) === "valid" ? day : undefined; }
    const preferred = `${day}T${time}`;
    if (validateDateValue(preferred, options) === "valid") { return preferred; }
    const start = dateToDays(date) * DAY;
    const min = Math.max(start, constraintNumber(options.min, options.type) ?? start);
    const max = Math.min(start + DAY - 1, constraintNumber(options.max, options.type) ?? start + DAY - 1);
    const step = stepSize(options);
    const base = stepBase(options);
    const number = step ? base + Math.ceil((min - base) / step) * step : min;
    if (number > max || number < start) { return; }
    const value = `${day}T${formatTime(Math.round(number - start))}`;
    return validateDateValue(value, options) === "valid" ? value : undefined;
};
export const weekday = (date: ICivilDate) => ((dateToDays(date) + 4) % 7 + 7) % 7;
export const localToday = (now = new Date()): ICivilDate => ({year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate()});
