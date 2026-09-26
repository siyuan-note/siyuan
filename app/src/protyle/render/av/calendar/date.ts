export const calendarDay = (value: number | Date) => {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
};

export const addCalendarDays = (value: number, days: number) => {
    const date = new Date(value);
    date.setDate(date.getDate() + days);
    return date.getTime();
};

export const calendarDayDistance = (from: number, to: number) => {
    const dayUTC = (value: number) => {
        const local = new Date(value);
        const utc = new Date(0);
        utc.setUTCFullYear(local.getFullYear(), local.getMonth(), local.getDate());
        return utc.getTime();
    };
    return Math.round((dayUTC(to) - dayUTC(from)) / 86400000);
};

const calendarDate = (year: number, month: number, day: number) => {
    const date = new Date(0);
    date.setFullYear(year, month, day);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
};

export const getISOWeek = (value: number) => {
    const date = new Date(value);
    const thursday = addCalendarDays(calendarDay(value), 4 - (date.getDay() || 7));
    const year = new Date(thursday).getFullYear();
    const januaryFourth = calendarDate(year, 0, 4);
    const firstThursday = addCalendarDays(januaryFourth, 4 - (new Date(januaryFourth).getDay() || 7));
    return {year, week: 1 + calendarDayDistance(firstThursday, thursday) / 7};
};

// 非周一开头的显示行以其中的星期四确定 ISO 周号。
export const getISOWeekForCalendarRow = (start: number) =>
    getISOWeek(addCalendarDays(start, (4 - new Date(start).getDay() + 7) % 7));

export const getISOWeeksInYear = (year: number) => getISOWeek(calendarDate(year, 11, 28)).week;

export const getISOWeekThursday = (year: number, week: number) => {
    if (!Number.isInteger(year) || year < 1 || year > 9999 || !Number.isInteger(week) || week < 1 ||
        week > getISOWeeksInYear(year)) {
        return;
    }
    const januaryFourth = calendarDate(year, 0, 4);
    const firstThursday = addCalendarDays(januaryFourth, 4 - (new Date(januaryFourth).getDay() || 7));
    return addCalendarDays(firstThursday, (week - 1) * 7);
};

export const getCalendarRange = (anchor: number, mode: "month" | "week", weekStart: number): IAVCalendarRange => {
    const date = new Date(calendarDay(anchor));
    if (mode === "month") {
        date.setDate(1);
    }
    const start = addCalendarDays(date.getTime(), -((date.getDay() - weekStart + 7) % 7));
    let end = addCalendarDays(start, 7);
    if (mode === "month") {
        // 月范围只包含与当月相交的完整周，结束端点为最后一周之后的起始日。
        date.setMonth(date.getMonth() + 1, 1);
        end = addCalendarDays(date.getTime(), (weekStart - date.getDay() + 7) % 7);
    }
    return {start, end,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"};
};

export interface ICalendarInterval {
    start: number;
    end: number;
    invalid: boolean;
}

// 全天结束日期包含当天，带时间的结束端点不包含自身；缺失端点不补造时长。
export const getCalendarInterval = (value: IAVCellValue): ICalendarInterval | undefined => {
    const date = value?.type === "date" ? value.date : value?.type === "created" ? value.created :
        value?.type === "updated" ? value.updated : undefined;
    if (!date) {
        return;
    }
    const hasStart = date.isNotEmpty && Number.isFinite(date.content);
    const hasEnd = value.type === "date" && date.hasEndDate && date.isNotEmpty2 && Number.isFinite(date.content2);
    if (!hasStart && !hasEnd) {
        return;
    }
    let start = hasStart ? date.content : date.content2;
    const invalid = !!(hasStart && hasEnd && date.content2 < start);
    let end = hasStart && hasEnd && !invalid ? date.content2 : start;
    if (value.type === "date" && date.isNotTime) {
        start = calendarDay(start);
        end = addCalendarDays(calendarDay(end), 1);
    }
    return {start, end, invalid};
};

export const moveCalendarDate = (date: IAVCellDateValue, days: number): IAVCellDateValue => ({
    ...date,
    content: date.isNotEmpty ? addCalendarDays(date.content, days) : date.content,
    content2: date.hasEndDate && date.isNotEmpty2 ? addCalendarDays(date.content2, days) : date.content2,
});

// 拖动端点仅修改该端点的日期，保留时间部分并阻止倒置区间。
export const resizeCalendarDate = (date: IAVCellDateValue, endpoint: "start" | "end", day: number) => {
    if (!date.isNotEmpty || !Number.isFinite(date.content)) {
        return;
    }
    const base = endpoint === "end" && date.hasEndDate && date.isNotEmpty2 ? date.content2 : date.content;
    let next = addCalendarDays(base, calendarDayDistance(base, day));
    if (endpoint === "end" && !date.isNotTime && date.hasEndDate && date.isNotEmpty2 &&
        calendarDay(date.content2) === date.content2) {
        // 午夜结束端点对应前一天末尾的手柄。
        next = addCalendarDays(next, 1);
    }
    const result = {...date, hasEndDate: true, isNotEmpty2: true,
        content: endpoint === "start" ? next : date.content,
        content2: endpoint === "end" ? next : date.hasEndDate && date.isNotEmpty2 ? date.content2 : date.content};
    if (result.content2 < result.content || !date.isNotTime && result.content2 === result.content) {
        return;
    }
    return result;
};

export interface ICalendarEvent extends ICalendarInterval {
    row: IAVRow;
    date: IAVCell;
    rowIndex?: number;
}

export interface ICalendarSegment {
    event: ICalendarEvent;
    column: number;
    span: number;
    lane: number;
    starts: boolean;
    ends: boolean;
}

export const packCalendarWeek = (events: ICalendarEvent[], start: number): ICalendarSegment[] => {
    const end = addCalendarDays(start, 7);
    const lanes: number[] = [];
    const segments: ICalendarSegment[] = [];
    events.forEach(event => {
        if (event.start >= end || (event.end > event.start ? event.end <= start : event.start < start)) {
            return;
        }
        const first = calendarDayDistance(start, event.start);
        const last = calendarDayDistance(start, Math.max(event.start, event.end - 1));
        const column = Math.max(0, first);
        const span = Math.min(6, last) - column + 1;
        const mask = ((1 << span) - 1) << column;
        let lane = lanes.findIndex(occupied => (occupied & mask) === 0);
        if (lane < 0) {
            lane = lanes.length;
            lanes.push(0);
        }
        lanes[lane] |= mask;
        segments.push({event, column, span, lane, starts: first >= 0, ends: last <= 6});
    });
    return segments;
};
