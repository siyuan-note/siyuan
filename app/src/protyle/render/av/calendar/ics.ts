import {ICalendarEventDraft} from "./model";

interface IICSProperty {
    name: string;
    params: { [key: string]: string };
    value: string;
}

interface IICSDateValue {
    date: Date;
    isAllDay: boolean;
}

export interface ICalendarICSImportEvent {
    uid: string;
    draft: ICalendarEventDraft;
}

const pad = (value: number) => value.toString().padStart(2, "0");
const formatDate = (value: Date) => `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
const formatTime = (value: Date) => `${pad(value.getHours())}:${pad(value.getMinutes())}`;

const unescapeICSText = (value = "") => value
    .replace(/\\[nN]/g, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");

const unfoldICSLines = (source: string) => {
    const lines = source.replace(/\r\n?/g, "\n").split("\n");
    const unfolded: string[] = [];
    lines.forEach(line => {
        if (/^[ \t]/.test(line) && unfolded.length > 0) {
            unfolded[unfolded.length - 1] += line.slice(1);
        } else {
            unfolded.push(line);
        }
    });
    return unfolded;
};

const findContentSeparator = (line: string) => {
    let quoted = false;
    for (let index = 0; index < line.length; index++) {
        if (line[index] === '"') {
            quoted = !quoted;
        } else if (line[index] === ":" && !quoted) {
            return index;
        }
    }
    return -1;
};

const splitPropertyParts = (value: string) => {
    const parts: string[] = [];
    let current = "";
    let quoted = false;
    for (const character of value) {
        if (character === '"') {
            quoted = !quoted;
            current += character;
        } else if (character === ";" && !quoted) {
            parts.push(current);
            current = "";
        } else {
            current += character;
        }
    }
    parts.push(current);
    return parts;
};

const parseProperty = (line: string): IICSProperty | undefined => {
    const separator = findContentSeparator(line);
    if (separator < 1) {
        return undefined;
    }
    const header = splitPropertyParts(line.slice(0, separator));
    const name = (header.shift() || "").trim().toUpperCase();
    if (!name) {
        return undefined;
    }
    const params: { [key: string]: string } = {};
    header.forEach(part => {
        const equals = part.indexOf("=");
        if (equals < 1) {
            return;
        }
        const key = part.slice(0, equals).trim().toUpperCase();
        const raw = part.slice(equals + 1).trim();
        params[key] = raw.replace(/^"|"$/g, "");
    });
    return {name, params, value: line.slice(separator + 1)};
};

const parseDateParts = (value: string) => {
    const match = value.trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?)?(Z)?$/i);
    if (!match) {
        return undefined;
    }
    const parts = {
        year: parseInt(match[1], 10),
        month: parseInt(match[2], 10),
        day: parseInt(match[3], 10),
        hour: parseInt(match[4] || "0", 10),
        minute: parseInt(match[5] || "0", 10),
        second: parseInt(match[6] || "0", 10),
        utc: Boolean(match[7]),
        hasTime: Boolean(match[4]),
    };
    if (parts.month < 1 || parts.month > 12 || parts.day < 1 || parts.day > 31 || parts.hour > 23 || parts.minute > 59 || parts.second > 59) {
        return undefined;
    }
    const calendarDate = new Date(parts.year, parts.month - 1, parts.day);
    if (calendarDate.getFullYear() !== parts.year || calendarDate.getMonth() !== parts.month - 1 || calendarDate.getDate() !== parts.day) {
        return undefined;
    }
    return parts;
};

const dateInTimeZone = (parts: ReturnType<typeof parseDateParts> & object, timeZone: string) => {
    const resolvedTimeZone = timezoneAliases[timeZone] || timeZone;
    let timestamp = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    try {
        const formatter = new Intl.DateTimeFormat("en-CA", {
            timeZone: resolvedTimeZone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hourCycle: "h23",
        });
        // Pass one applies the nominal zone offset, pass two corrects a DST
        // boundary, and pass three verifies that the wall-clock delta is zero.
        for (let attempt = 0; attempt < 3; attempt++) {
            const rendered = Object.fromEntries(formatter.formatToParts(new Date(timestamp))
                .filter(part => part.type !== "literal")
                .map(part => [part.type, parseInt(part.value, 10)]));
            const renderedAsUTC = Date.UTC(rendered.year, rendered.month - 1, rendered.day, rendered.hour, rendered.minute, rendered.second);
            const requestedAsUTC = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
            const delta = requestedAsUTC - renderedAsUTC;
            timestamp += delta;
            if (delta === 0) {
                break;
            }
        }
        return new Date(timestamp);
    } catch (_) {
        return new Date(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    }
};

const parseICSDate = (property?: IICSProperty): IICSDateValue | undefined => {
    if (!property) {
        return undefined;
    }
    const parts = parseDateParts(property.value);
    if (!parts) {
        return undefined;
    }
    const isAllDay = property.params.VALUE?.toUpperCase() === "DATE" || !parts.hasTime;
    if (isAllDay) {
        return {date: new Date(parts.year, parts.month - 1, parts.day), isAllDay: true};
    }
    if (parts.utc) {
        return {date: new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)), isAllDay: false};
    }
    if (property.params.TZID) {
        return {date: dateInTimeZone(parts, property.params.TZID), isAllDay: false};
    }
    return {date: new Date(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second), isAllDay: false};
};

const parseDurationMilliseconds = (value = "") => {
    const match = value.trim().toUpperCase().match(/^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
    if (!match) {
        return 0;
    }
    const weeks = parseInt(match[1] || "0", 10);
    const days = parseInt(match[2] || "0", 10);
    const hours = parseInt(match[3] || "0", 10);
    const minutes = parseInt(match[4] || "0", 10);
    const seconds = parseInt(match[5] || "0", 10);
    return (((weeks * 7 + days) * 24 + hours) * 60 * 60 + minutes * 60 + seconds) * 1000;
};

const normalizeRecurrenceRule = (value = "") => {
    const supported = new Set(["FREQ", "INTERVAL", "COUNT", "UNTIL", "BYDAY"]);
    const parts = value.trim().toUpperCase().split(";").filter(Boolean).filter(part => {
        const separator = part.indexOf("=");
        return separator > 0 && supported.has(part.slice(0, separator));
    });
    const frequency = parts.find(part => part.startsWith("FREQ="))?.slice(5);
    return ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(frequency || "") ? parts.join(";") : "";
};

const firstProperty = (properties: IICSProperty[], name: string) => properties.find(property => property.name === name);
const allProperties = (properties: IICSProperty[], name: string) => properties.filter(property => property.name === name);

// Exchange/Outlook commonly emits Windows timezone IDs. Thunderbird resolves
// these to the same rules as IANA zones before it constructs an item.
const timezoneAliases: {[key: string]: string} = {
    "AUS Central Standard Time": "Australia/Darwin",
    "Central Europe Standard Time": "Europe/Budapest",
    "Cuba Standard Time": "America/Havana",
    "Egypt Standard Time": "Africa/Cairo",
    "Pacific SA Standard Time": "America/Santiago",
    "Romance Standard Time": "Europe/Paris",
    "Sri Lanka Standard Time": "Asia/Colombo",
    "Taipei Standard Time": "Asia/Taipei",
    "Tonga Standard Time": "Pacific/Tongatapu",
    "W. Europe Standard Time": "Europe/Berlin",
};

/**
 * Browser File.text() assumes UTF-8. Calendar exports in the wild still use
 * legacy single-byte encodings, so decode the bytes explicitly before parsing.
 * Thunderbird's importer accepts these files, including the Latin-1 fixture in
 * calendar/test/unit/data/importLatin1.ics.
 */
export const decodeICSBytes = (bytes: ArrayBuffer | Uint8Array) => {
    const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (const encoding of ["utf-8", "windows-1252", "iso-8859-1"]) {
        try {
            return new TextDecoder(encoding, {fatal: true}).decode(input);
        } catch (_) {
            // Try the next compatible encoding.
        }
    }
    return new TextDecoder("utf-8").decode(input);
};

const buildImportEvent = (properties: IICSProperty[]): ICalendarICSImportEvent | undefined => {
    if (firstProperty(properties, "STATUS")?.value.trim().toUpperCase() === "CANCELLED") {
        return undefined;
    }
    const start = parseICSDate(firstProperty(properties, "DTSTART"));
    if (!start) {
        return undefined;
    }
    const endProperty = parseICSDate(firstProperty(properties, "DTEND"));
    let end = endProperty?.date;
    if (!end) {
        const duration = parseDurationMilliseconds(firstProperty(properties, "DURATION")?.value);
        end = duration ? new Date(start.date.getTime() + duration) :
            (start.isAllDay ? new Date(start.date.getFullYear(), start.date.getMonth(), start.date.getDate() + 1) : new Date(start.date.getTime() + 60 * 60 * 1000));
    }
    if (start.isAllDay) {
        const exclusiveEnd = end.getTime() > start.date.getTime() ? end : new Date(start.date.getFullYear(), start.date.getMonth(), start.date.getDate() + 1);
        end = new Date(exclusiveEnd.getFullYear(), exclusiveEnd.getMonth(), exclusiveEnd.getDate() - 1);
    } else if (end.getTime() <= start.date.getTime()) {
        end = new Date(start.date.getTime() + 60 * 60 * 1000);
    }
    const exceptionDates = allProperties(properties, "EXDATE").flatMap(property => property.value.split(",").map(value =>
        parseICSDate({...property, value})?.date
    )).filter((value): value is Date => Boolean(value)).map(formatDate);
    const summary = unescapeICSText(firstProperty(properties, "SUMMARY")?.value || "").trim();
    const uid = unescapeICSText(firstProperty(properties, "UID")?.value || "").trim();
    return {
        uid,
        draft: {
            title: summary,
            date: formatDate(start.date),
            endDate: formatDate(end),
            isAllDay: start.isAllDay,
            startTime: formatTime(start.date),
            endTime: formatTime(end),
            recurrenceRaw: normalizeRecurrenceRule(firstProperty(properties, "RRULE")?.value),
            recurrenceExceptionRaw: Array.from(new Set(exceptionDates)).join(","),
            location: unescapeICSText(firstProperty(properties, "LOCATION")?.value || ""),
            description: unescapeICSText(firstProperty(properties, "DESCRIPTION")?.value || ""),
        },
    };
};

export const parseICSCalendar = (source: string): ICalendarICSImportEvent[] => {
    const events: ICalendarICSImportEvent[] = [];
    let current: IICSProperty[] | undefined;
    unfoldICSLines(source).forEach(line => {
        const upper = line.trim().toUpperCase();
        if (upper === "BEGIN:VEVENT") {
            current = [];
            return;
        }
        if (upper === "END:VEVENT") {
            if (current) {
                const event = buildImportEvent(current);
                if (event) {
                    events.push(event);
                }
            }
            current = undefined;
            return;
        }
        if (current) {
            const property = parseProperty(line);
            if (property) {
                current.push(property);
            }
        }
    });
    const collator = new Intl.Collator(undefined, {numeric: true});
    return events.sort((a, b) => {
        const aStart = `${a.draft.date}T${a.draft.startTime || "00:00"}`;
        const bStart = `${b.draft.date}T${b.draft.startTime || "00:00"}`;
        return aStart.localeCompare(bStart) || collator.compare(a.draft.title, b.draft.title);
    });
};
