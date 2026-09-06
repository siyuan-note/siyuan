export const flashcardV2ReviewDay = (now: number) => {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return {reviewDayStart: start.getTime(), reviewDayEnd: end.getTime()};
};
