import data = require("../../../../../kernel/av/lunar_calendar_data.json");

const dayMilliseconds = 86400000;
const months = data.months;
export const lunarFirstYear = data.firstYear;
export const lunarLastYear = data.lastYear;

export interface ILunarDate {
    year: number;
    month: number;
    day: number;
}

// 月份为负数表示闰月；时间戳按现有日期字段的本地日历日解释。
export const solarToLunar = (content: number): ILunarDate | undefined => {
    const solar = new Date(content);
    if (solar.getFullYear() < lunarFirstYear || solar.getFullYear() > lunarLastYear || !Number.isFinite(content)) {
        return undefined;
    }
    const day = Date.UTC(solar.getFullYear(), solar.getMonth(), solar.getDate()) / dayMilliseconds;
    let low = 0;
    let high = months.length;
    while (low < high) {
        const middle = (low + high) >>> 1;
        if (months[middle][2] <= day) {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    const month = months[low - 1];
    return month && day >= month[2] && day < month[2] + month[3] ?
        {year: month[0], month: month[1], day: day - month[2] + 1} : undefined;
};

export const getLunarMonths = (year: number) => months.filter(month => month[0] === year);

const getLunarCivilDate = (lunar: ILunarDate): Date | undefined => {
    const month = months.find(month => month[0] === lunar.year && month[1] === lunar.month);
    if (!month || !Number.isInteger(lunar.day) || lunar.day < 1 || lunar.day > month[3]) {
        return undefined;
    }
    return new Date((month[2] + lunar.day - 1) * dayMilliseconds);
};

export const lunarToSolar = (lunar: ILunarDate, hours = 0, minutes = 0): number | undefined => {
    const civil = getLunarCivilDate(lunar);
    if (!civil || !Number.isInteger(hours) || hours < 0 || hours > 23 ||
        !Number.isInteger(minutes) || minutes < 0 || minutes > 59) {
        return undefined;
    }
    const result = new Date(civil.getUTCFullYear(), civil.getUTCMonth(), civil.getUTCDate(), hours, minutes);
    // 夏令时造成不存在的本地时间时返回错误，不把输入静默调整为其它时间。
    if (result.getFullYear() !== civil.getUTCFullYear() || result.getMonth() !== civil.getUTCMonth() ||
        result.getDate() !== civil.getUTCDate() || result.getHours() !== hours || result.getMinutes() !== minutes) {
        return undefined;
    }
    return result.valueOf();
};

export const getLunarMonthLabel = (month: number) => {
    const label = window.siyuan.languages._attrView.lunarMonths.split("|")[Math.abs(month) - 1];
    return month < 0 ? window.siyuan.languages._attrView.lunarLeapMonth.replace("${month}", label) : label;
};

export const getLunarDayLabel = (day: number) => window.siyuan.languages._attrView.lunarDays.split("|")[day - 1];

export const formatLunarDate = (lunar: ILunarDate) => window.siyuan.languages._attrView.lunarDateTemplate
    .replaceAll("${year}", lunar.year.toString())
    .replaceAll("${month}", getLunarMonthLabel(lunar.month))
    .replaceAll("${day}", getLunarDayLabel(lunar.day));

export const parseLunarDate = (content: string): ILunarDate | undefined => {
    const template = typeof window === "undefined" ? undefined : window.siyuan?.languages?._attrView?.lunarDateTemplate;
    if (!template || !content.startsWith(template.split(/\$\{year}|\$\{month}|\$\{day}/)[0])) {
        return undefined;
    }
    const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const names = Array.from({length: 12}, (_, index) => [getLunarMonthLabel(index + 1), getLunarMonthLabel(-index - 1)]).flat();
    const days: string[] = window.siyuan.languages._attrView.lunarDays.split("|");
    const captures: string[] = [];
    const pattern = template.split(/(\$\{year}|\$\{month}|\$\{day})/).map((token: string) => {
        if (token === "${year}") {
            captures.push("year");
            return "(\\d{4})";
        }
        if (token === "${month}" || token === "${day}") {
            captures.push(token === "${month}" ? "month" : "day");
            return `(${(token === "${month}" ? names : days).map(escape).sort((a, b) => b.length - a.length).join("|")})`;
        }
        return escape(token);
    }).join("");
    const match = content.match(new RegExp(`^${pattern}$`));
    if (!match) {
        return undefined;
    }
    const parts: Record<string, string> = {};
    captures.forEach((key, index) => parts[key] = match[index + 1]);
    const index = names.indexOf(parts.month);
    const lunar = {year: Number(parts.year), month: (Math.floor(index / 2) + 1) * (index % 2 ? -1 : 1), day: days.indexOf(parts.day) + 1};
    return getLunarCivilDate(lunar) ? lunar : undefined;
};
