const pad = (value: number) => value.toString().padStart(2, "0");

const getMonths = (): string[] => window.siyuan.languages._attrView.dateMonths.split("|");

export const getDefaultDateFormat = (type: TAVCol): TAVDateFormat =>
    ["date", "created", "updated"].includes(type) ? "full" : "";

export const formatDateDisplay = (content: number, format: TAVDateFormat = "", isNotTime = true) => {
    const date = new Date(content);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    let formatted: string;
    if (format === "full") {
        formatted = window.siyuan.languages._attrView.dateFormatFullTemplate
            .replaceAll("${year}", year.toString())
            .replaceAll("${month}", getMonths()[month - 1] || date.toLocaleString(undefined, {month: "long"}))
            .replaceAll("${day}", day.toString());
    } else if (format === "month-day-year") {
        formatted = `${pad(month)}/${pad(day)}/${year}`;
    } else if (format === "day-month-year") {
        formatted = `${pad(day)}/${pad(month)}/${year}`;
    } else if (format === "year-month-day") {
        formatted = `${year}/${pad(month)}/${pad(day)}`;
    } else {
        formatted = `${year}-${pad(month)}-${pad(day)}`;
    }
    if (!isNotTime) {
        formatted += ` ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }
    return formatted;
};

export const formatDateValue = (value: IAVCellDateValue, format: TAVDateFormat = "") => {
    if (!value?.isNotEmpty || !value.content) {
        return "";
    }
    let formatted = formatDateDisplay(value.content, format, value.isNotTime);
    if (value.hasEndDate && value.isNotEmpty2 && value.content2) {
        formatted += ` → ${formatDateDisplay(value.content2, format, value.isNotTime)}`;
    }
    return formatted;
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const parseFullDate = (value: string) => {
    const tokens = window.siyuan.languages._attrView.dateFormatFullTemplate.split(/(\$\{year}|\$\{month}|\$\{day})/);
    const captures: string[] = [];
    const months = getMonths();
    const pattern = tokens.map((token: string) => {
        if (token === "${year}") {
            captures.push("year");
            return "(\\d{4})";
        }
        if (token === "${month}") {
            captures.push("month");
            return `(${months.map(escapeRegExp).sort((a, b) => b.length - a.length).join("|")})`;
        }
        if (token === "${day}") {
            captures.push("day");
            return "(\\d{1,2})";
        }
        return escapeRegExp(token);
    }).join("");
    const match = value.match(new RegExp(`^${pattern}$`, "i"));
    if (!match) {
        return;
    }
    const parts: Record<string, string> = {};
    captures.forEach((capture, index) => {
        parts[capture] = match[index + 1];
    });
    return {
        year: Number(parts.year),
        month: months.findIndex((month) => month.toLocaleLowerCase() === parts.month.toLocaleLowerCase()) + 1,
        day: Number(parts.day),
    };
};

const parseDateEndpoint = (value: string, format: TAVDateFormat) => {
    const trimmed = value.trim();
    const timeMatch = trimmed.match(/\s+(\d{1,2}):(\d{2})$/);
    const hour = timeMatch ? Number(timeMatch[1]) : 0;
    const minute = timeMatch ? Number(timeMatch[2]) : 0;
    const dateText = timeMatch ? trimmed.substring(0, timeMatch.index).trim() : trimmed;
    let year: number;
    let month: number;
    let day: number;
    if (format === "full") {
        const parts = parseFullDate(dateText);
        if (!parts) {
            return;
        }
        ({year, month, day} = parts);
    } else {
        let match: RegExpMatchArray;
        if (format === "month-day-year") {
            match = dateText.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
            if (match) {
                month = Number(match[1]);
                day = Number(match[2]);
                year = Number(match[3]);
            }
        } else if (format === "day-month-year") {
            match = dateText.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
            if (match) {
                day = Number(match[1]);
                month = Number(match[2]);
                year = Number(match[3]);
            }
        } else if (format === "year-month-day") {
            match = dateText.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
            if (match) {
                year = Number(match[1]);
                month = Number(match[2]);
                day = Number(match[3]);
            }
        } else {
            match = dateText.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
            if (match) {
                year = Number(match[1]);
                month = Number(match[2]);
                day = Number(match[3]);
            }
        }
        if (!match) {
            return;
        }
    }
    if (hour > 23 || minute > 59 || month < 1 || month > 12 || day < 1 || day > 31) {
        return;
    }
    const parsed = new Date(0);
    parsed.setFullYear(year, month - 1, day);
    parsed.setHours(hour, minute, 0, 0);
    if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day ||
        parsed.getHours() !== hour || parsed.getMinutes() !== minute) {
        return;
    }
    return {content: parsed.valueOf(), isNotTime: !timeMatch};
};

export const parseDateValue = (value: string, format: TAVDateFormat = ""): IAVCellDateValue => {
    const endpoints = value.split(/\s*→\s*|\s+[~-]\s+/);
    if (endpoints.length > 2) {
        return {content: null, isNotEmpty: false, content2: null, isNotEmpty2: false, hasEndDate: false, isNotTime: true};
    }
    const start = parseDateEndpoint(endpoints[0], format);
    const end = endpoints.length === 2 ? parseDateEndpoint(endpoints[1], format) : undefined;
    if (!start || (endpoints.length === 2 && !end)) {
        return {content: null, isNotEmpty: false, content2: null, isNotEmpty2: false, hasEndDate: false, isNotTime: true};
    }
    return {
        content: start.content,
        isNotEmpty: true,
        content2: end?.content || 0,
        isNotEmpty2: !!end,
        hasEndDate: !!end,
        isNotTime: start.isNotTime && (!end || end.isNotTime),
        formattedContent: "",
    };
};

export const getLabelByDateFormat = (format: TAVDateFormat = "") => {
    if (format === "full") {
        return window.siyuan.languages._attrView.fullDate;
    }
    if (format === "month-day-year") {
        return "MM/DD/YYYY";
    }
    if (format === "day-month-year") {
        return "DD/MM/YYYY";
    }
    if (format === "year-month-day") {
        return "YYYY/MM/DD";
    }
    return "YYYY-MM-DD";
};
