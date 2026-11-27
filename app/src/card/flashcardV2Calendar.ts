export const flashcardV2ReviewDay = (now: number) => {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return {reviewDayStart: start.getTime(), reviewDayEnd: end.getTime()};
};

export const flashcardV2LocalDateTime = (value: number) => {
    const date = new Date(value);
    return new Date(value - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

// 按本地日历改期，跨夏令时时保持本地时分。
export const flashcardV2DueAfterDays = (now: number, days: number) => {
    const date = new Date(now);
    date.setDate(date.getDate() + days);
    date.setSeconds(0, 0);
    return date.getTime();
};
