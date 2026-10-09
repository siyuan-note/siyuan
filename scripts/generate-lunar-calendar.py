"""从香港天文台逐年对照表生成前后端共用的离线农历数据。"""

from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
import json
from pathlib import Path
import re
import tempfile
import urllib.request


SOURCE = "https://www.hko.gov.hk/en/gts/time/calendar/text/files/T{}e.txt"
FIRST_YEAR = 1901
LAST_YEAR = 2100
EPOCH = date(1970, 1, 1)
CACHE = Path(tempfile.gettempdir()) / "siyuan-lunar-calendar-source"
CACHE.mkdir(exist_ok=True)


def read_year(year):
    cached = CACHE / (str(year) + ".txt")
    if not cached.exists():
        request = urllib.request.Request(SOURCE.format(year), headers={"User-Agent": "SiYuan-Coding-Agent"})
        with urllib.request.urlopen(request, timeout=60) as response:
            cached.write_bytes(response.read())
    rows = []
    # 旧年份文件使用传统编码；表中日期、月份及星期均为 ASCII。
    for line in cached.read_text(encoding="latin-1").splitlines():
        match = re.match(r"^(\d{4})/(\d{1,2})/(\d{1,2})\s+(.+?)\s{2,}", line)
        if match:
            solar = date(*map(int, match.group(1, 2, 3)))
            rows.append((solar, match.group(4)))
    # 2069 年文本省略了 12 月 30 日；只补齐相邻公历日与农历日同时连续的月内缺行。
    complete = []
    for solar, lunar in rows:
        if complete:
            previous, previous_lunar = complete[-1]
            gap = (solar - previous).days
            if gap > 1:
                if not previous_lunar.isdigit() or not lunar.isdigit() or int(lunar) - int(previous_lunar) != gap:
                    raise ValueError("Unverifiable source gap: " + str(solar))
                for offset in range(1, gap):
                    complete.append((previous + timedelta(days=offset), str(int(previous_lunar) + offset)))
        complete.append((solar, lunar))
    rows = complete
    expected = (date(year + 1, 1, 1) - date(year, 1, 1)).days
    if len(rows) != expected or any((rows[i][0] - rows[i - 1][0]).days != 1 for i in range(1, len(rows))):
        raise ValueError("Incomplete source year: " + str(year) + "; rows=" + str(len(rows)) + "; path=" + str(cached))
    return rows


def main():
    months = []
    lunar_year = FIRST_YEAR - 1
    previous_month = 0
    with ThreadPoolExecutor(max_workers=6) as pool:
        for rows in pool.map(read_year, range(FIRST_YEAR, LAST_YEAR + 1)):
            for solar, lunar in rows:
                match = re.match(r"(\d+)(?:st|nd|rd|th) Lunar Month", lunar, re.IGNORECASE)
                if not match:
                    continue
                month = int(match.group(1))
                leap = month == previous_month
                if month == 1 and not leap:
                    lunar_year += 1
                previous_month = month
                if lunar_year < FIRST_YEAR:
                    continue
                start = (solar - EPOCH).days
                if months:
                    months[-1][3] = start - months[-1][2]
                    if months[-1][3] not in (29, 30):
                        raise ValueError("Invalid lunar month: " + str(months[-1]))
                months.append([lunar_year, -month if leap else month, start, 0])
    # 最后一个月只开放官方对照表已经覆盖的日期，不推算表外数据。
    end = (date(LAST_YEAR + 1, 1, 1) - EPOCH).days
    months[-1][3] = end - months[-1][2]
    if months[0][:2] != [FIRST_YEAR, 1] or months[-1][0] != LAST_YEAR:
        raise ValueError("Unexpected calendar coverage: " + str(months[0]) + " to " + str(months[-1]))
    output = Path(__file__).resolve().parents[1] / "kernel" / "av" / "lunar_calendar_data.json"
    data = {"source": SOURCE, "firstYear": FIRST_YEAR, "lastYear": LAST_YEAR, "months": months}
    # 每个农历月一行，便于审查来源更新与覆盖边界。
    text = json.dumps(data, ensure_ascii=False, indent=2)
    text = re.sub(r"\[\n\s+(\d+),\n\s+(-?\d+),\n\s+(-?\d+),\n\s+(\d+)\n\s+\]", r"[\1, \2, \3, \4]", text)
    output.write_text(text + "\n", encoding="utf-8")
    print("Generated", len(months), "months; boundaries:", months[0], months[-1])


if __name__ == "__main__":
    main()
