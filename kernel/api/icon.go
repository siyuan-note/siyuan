// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package api

import (
	"fmt"
	"math"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type ColorScheme struct {
	Primary   string
	Secondary string
}

var colorSchemes = map[string]ColorScheme{
	"red":    {"#d13d51", "#ba2c3f"},
	"blue":   {"#3eb0ea", "#0097e6"},
	"yellow": {"#eec468", "#d89b18"},
	"green":  {"#52E0B8", "#19b37a"},
	"purple": {"#a36cda", "#8952d5"},
	"pink":   {"#f183aa", "#e05b8a"},
	"orange": {"#f3865e", "#ef5e2a"},
	"grey":   {"#576574", "#374a60"},
}

func getColorScheme(color string) ColorScheme {
	// 去除可能的空格
	color = strings.TrimSpace(color)

	// 检查是否是预定义的颜色
	if scheme, ok := colorSchemes[strings.ToLower(color)]; ok {
		return scheme
	}
	// 支持自定义颜色
	// 如果颜色值不以#开头，自动添加#
	if !strings.HasPrefix(color, "#") && len(color) > 0 {
		color = "#" + color
	}

	// 检查是否是十六进制颜色值
	hexColorPattern := `^#?([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$`
	if matched, _ := regexp.MatchString(hexColorPattern, color); matched {
		// 确保颜色值有#前缀
		if !strings.HasPrefix(color, "#") {
			color = "#" + color
		}

		// 如果是3位十六进制，转换为6位
		if len(color) == 4 {
			r := string(color[1])
			g := string(color[2])
			b := string(color[3])
			color = "#" + r + r + g + g + b + b
		}

		// 生成次要颜色（将主色调变深）
		secondary := darkenColor(color, 0.1)

		return ColorScheme{
			Primary:   color,
			Secondary: secondary,
		}
	}

	// 如果既不是预定义颜色也不是有效的十六进制值，返回默认颜色
	return colorSchemes["red"]
}

func darkenColor(hexColor string, factor float64) string {
	// 去掉#号
	hex := hexColor[1:]

	// 将十六进制转换为RGB
	r, _ := strconv.ParseInt(hex[0:2], 16, 64)
	g, _ := strconv.ParseInt(hex[2:4], 16, 64)
	b, _ := strconv.ParseInt(hex[4:6], 16, 64)

	// 使颜色变深
	r = int64(float64(r) * (1 - factor))
	g = int64(float64(g) * (1 - factor))
	b = int64(float64(b) * (1 - factor))

	// 确保值在0-255范围内
	r = int64(math.Max(0, float64(r)))
	g = int64(math.Max(0, float64(g)))
	b = int64(math.Max(0, float64(b)))

	// 转回十六进制
	return fmt.Sprintf("#%02X%02X%02X", r, g, b)
}

func getDynamicIcon(c *gin.Context) {
	// Add internal kernel API `/api/icon/getDynamicIcon` https://github.com/siyuan-note/siyuan/pull/12939

	iconType := c.Query("type")
	if "" == iconType {
		iconType = "1"
	}
	color := c.Query("color") // 不要预设默认值，不然type6返回星期就没法自动设置周末颜色了
	date := c.Query("date")
	lang := c.Query("lang")
	if "" == lang {
		lang = util.Lang
	}
	weekdayType := c.Query("weekdayType") // 设置星期几的格式，zh_CH {1：周日，2：周天， 3：星期日，4：星期天，}, en_US {1: Mon, 2: MON，3: Monday, 4. MONDAY,}
	if "" == weekdayType {
		weekdayType = "1"
	}

	dateInfo := getDateInfo(date, lang, weekdayType)
	var svg string
	switch iconType {
	case "1":
		// Type 1: 显示年月日星期
		svg = generateTypeOneSVG(color, lang, dateInfo)
	case "2":
		// Type 2: 显示年月日
		svg = generateTypeTwoSVG(color, lang, dateInfo)
	case "3":
		// Type 3: 显示年月
		svg = generateTypeThreeSVG(color, lang, dateInfo)
	case "4":
		// Type 4: 仅显示年
		svg = generateTypeFourSVG(color, lang, dateInfo)
	case "5":
		// Type 5: 显示周数
		svg = generateTypeFiveSVG(color, lang, dateInfo)
	case "6":
		// Type 6: 仅显示星期
		svg = generateTypeSixSVG(color, lang, weekdayType, dateInfo)
	case "7":
		// Type 7: 倒数日
		svg = generateTypeSevenSVG(color, lang, dateInfo)
	case "8":
		// Type 8: 文字图标
		content := c.Query("content")
		id := c.Query("id")
		svg = generateTypeEightSVG(color, content, id)
	default:
		// 默认为Type 1
		svg = generateTypeOneSVG(color, lang, dateInfo)
	}

	if !model.Conf.Editor.AllowSVGScript {
		svg = util.RemoveScriptsInSVG(svg)
	}

	c.Header("Content-Type", "image/svg+xml")
	c.Header("Cache-Control", "no-cache")
	c.Header("Pragma", "no-cache")
	c.String(http.StatusOK, svg)
}

func getDateInfo(dateStr string, lang string, weekdayType string) map[string]interface{} {
	// 设置默认值
	var date time.Time
	var err error
	if dateStr == "" {
		date = time.Now()
	} else {
		date, err = time.Parse("2006-01-02", dateStr)
		if err != nil {
			date = time.Now()
		}
	}
	// 获取年月日星期
	year := date.Year()
	month := date.Format("Jan")
	day := date.Day()
	var weekdayStr string
	var weekdays []string

	switch lang {
	case "zh_CN":
		month = date.Format("1月")
		switch weekdayType {
		case "1":
			weekdays = []string{"周日", "周一", "周二", "周三", "周四", "周五", "周六"}
		case "2":
			weekdays = []string{"周天", "周一", "周二", "周三", "周四", "周五", "周六"}
		case "3":
			weekdays = []string{"星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"}
		case "4":
			weekdays = []string{"星期天", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"}
		default:
			weekdays = []string{"周日", "周一", "周二", "周三", "周四", "周五", "周六"}
		}
		weekdayStr = weekdays[date.Weekday()]
	case "zh_CHT":
		month = date.Format("1月")
		switch weekdayType {
		case "1":
			weekdays = []string{"週日", "週一", "週二", "週三", "週四", "週五", "週六"}
		case "2":
			weekdays = []string{"週天", "週一", "週二", "週三", "週四", "週五", "週六"}
		case "3":
			weekdays = []string{"星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"}
		case "4":
			weekdays = []string{"星期天", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"}
		default:
			weekdays = []string{"週日", "週一", "週二", "週三", "週四", "週五", "週六"}
		}
		weekdayStr = weekdays[date.Weekday()]

	default:
		// 其他语言
		switch weekdayType {
		case "1":
			weekdayStr = date.Format("Mon")
		case "2":
			weekdayStr = date.Format("Mon")
			weekdayStr = strings.ToUpper(weekdayStr)
		case "3":
			weekdayStr = date.Format("Monday")
		case "4":
			weekdayStr = date.Format("Monday")
			weekdayStr = strings.ToUpper(weekdayStr)
		default:
			weekdayStr = date.Format("Mon")
		}
	}
	// Calculate week number and ISO year
	isoYear, weekNum := date.ISOWeek()
	weekNumStr := fmt.Sprintf("%dW", weekNum)

	switch lang {
	case "zh_CN":
		weekNumStr = fmt.Sprintf("%d周", weekNum)
	case "zh_CHT":
		weekNumStr = fmt.Sprintf("%d週", weekNum)
	}
	// 判断是否是周末
	isWeekend := date.Weekday() == time.Saturday || date.Weekday() == time.Sunday
	// Calculate days until today
	today := time.Now()
	today = time.Date(today.Year(), today.Month(), today.Day(), 0, 0, 0, 0, today.Location())
	date = time.Date(date.Year(), date.Month(), date.Day(), 0, 0, 0, 0, date.Location())
	// countDown := int(math.Floor(date.Sub(today).Hours() / 24)) // 注意最大返回106751天，go的时间戳最大值
	countDown := daysBetween(today, date)

	return map[string]interface{}{
		"year":      year,
		"isoYear":   isoYear,
		"month":     month,
		"day":       day,
		"date":      fmt.Sprintf("%02d-%02d", date.Month(), date.Day()),
		"weekday":   weekdayStr,
		"week":      weekNumStr,
		"countDown": countDown,
		"isWeekend": isWeekend,
	}
}

func daysBetween(date1, date2 time.Time) int {
	// 将两个日期都调整到UTC时间的0点
	date1 = time.Date(date1.Year(), date1.Month(), date1.Day(), 0, 0, 0, 0, time.UTC)
	date2 = time.Date(date2.Year(), date2.Month(), date2.Day(), 0, 0, 0, 0, time.UTC)

	// 确保date1不晚于date2
	swap := false
	if date1.After(date2) {
		date1, date2 = date2, date1
		swap = true
	}

	// 计算天数差
	days := 0
	for y := date1.Year(); y < date2.Year(); y++ {
		if isLeapYear(y) {
			days += 366
		} else {
			days += 365
		}
	}

	// 加上最后一年的天数
	days += int(date2.YearDay() - date1.YearDay())

	// 如果原始的date1晚于date2，返回负值
	if swap {
		return -days
	}
	return days
}

// 判断是否为闰年
func isLeapYear(year int) bool {
	return year%4 == 0 && (year%100 != 0 || year%400 == 0)
}

// Type 1: 显示年月日星期
func generateTypeOneSVG(color string, lang string, dateInfo map[string]interface{}) string {
	colorScheme := getColorScheme(color)

	return fmt.Sprintf(`
    <svg id="dynamic_icon_type1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
    <path d="M512,447.5c0,32-25,57-57,57H57c-32,0-57-25-57-57V120.5c0-31,25-57,57-57h398c32,0,57,26,57,57v327Z" style="fill: #ecf2f7;"/>
    <path d="M39,0h434c21.52,0,39,17.48,39,39v146H0V39C0,17.48,17.48,0,39,0Z" style="fill: %s;"/>
    <text transform="translate(22 146.5)" style="fill: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Noto Sans', 'Noto Sans CJK SC', 'Microsoft YaHei'; font-size: 100px;">%s</text>
    <text x="50%%" y="392.5" style="fill: #66757f; font-family: -apple-system, BlinkMacSystemFont, 'Noto Sans', 'Noto Sans CJK SC', 'Microsoft YaHei'; font-size: 240px; text-anchor: middle">%d</text>
    <text x="50%%" y="472.5" style="fill: #66757f; font-family: -apple-system, BlinkMacSystemFont, 'Noto Sans', 'Noto Sans CJK SC', 'Microsoft YaHei'; font-size: 64px; text-anchor: middle">%s</text>
    <text transform="translate(331.03 148.44)" style="fill: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Noto Sans', 'Noto Sans CJK SC', 'Microsoft YaHei'; font-size: 71.18px;">%d</text>
    </svg>
    `, colorScheme.Primary, dateInfo["month"], dateInfo["day"], dateInfo["weekday"], dateInfo["year"])
}

// Type 2: 显示年月日
func generateTypeTwoSVG(color string, lang string, dateInfo map[string]interface{}) string {
	colorScheme := getColorScheme(color)

	return fmt.Sprintf(`
    <svg id="dynamic_icon_type2" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
    <path d="M512,447.5c0,32-25,57-57,57H57c-32,0-57-25-57-57V120.5c0-31,25-57,57-57h398c32,0,57,26,57,57v327Z" style="fill: #ecf2f7;"/>
    <path d="M39,0h434c21.52,0,39,17.48,39,39v146H0V39C0,17.48,17.48,0,39,0Z" style="fill: %s;"/>
    <text transform="translate(22 146.5)" style="fill: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Noto Sans', 'Noto Sans CJK SC', 'Microsoft YaHei'; font-size: 100px;">%s</text>
    <text x="50%%" y="420.5"  style="fill: #66757f; font-family: -apple-system, BlinkMacSystemFont, 'Noto Sans', 'Noto Sans CJK SC', 'Microsoft YaHei'; font-size: 256px;text-anchor: middle">%d</text>
    <text transform="translate(331.03 148.44)" style="fill: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Noto Sans', 'Noto Sans CJK SC', 'Microsoft YaHei'; font-size: 71.18px;">%d</text>
    </svg>
    `, colorScheme.Primary, dateInfo["month"], dateInfo["day"], dateInfo["year"])
}

// Type 3: 显示年月
func generateTypeThreeSVG(color string, lang string, dateInfo map[string]interface{}) string {
	colorScheme := getColorScheme(color)

	return fmt.Sprintf(`
    <svg id="dynamic_icon_type3" xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 512 512">
        <path class="cls-6" d="M512,447.5c0,32-25,57-57,57H57c-32,0-57-25-57-57V120.5c0-31,25-57,57-57h398c32,0,57,26,57,57v327Z" style="fill: #ecf2f7;"/>
        <path class="cls-1" d="M39,0h434c21.5,0,39,17.5,39,39v146H0V39C0,17.5,17.5,0,39,0Z" style="fill: %s;"/>
        <g style="fill: %s;">
            <circle  cx="468.5" cy="135" r="14"/>
            <circle  cx="468.5" cy="93" r="14"/>
            <circle  cx="425.5" cy="135" r="14"/>
            <circle  cx="425.5" cy="93" r="14"/>
            <circle  cx="382.5" cy="135" r="14"/>
            <circle  cx="382.5" cy="93" r="14"/>
        </g>
        <text transform="translate(22 146.5)" style="fill: #fff;font-size: 120px; font-family: -apple-system, BlinkMacSystemFont, 'Noto Sans', 'Noto Sans CJK SC', 'Microsoft YaHei'; ">%d</text>
        <text x="50%%" y="410.5" style="fill: #66757f;font-size: 200px;text-anchor: middle;font-family: -apple-system, BlinkMacSystemFont, 'Noto Sans', 'Noto Sans CJK SC', 'Microsoft YaHei'; ">%s</text>
    </svg>
    `, colorScheme.Primary, colorScheme.Secondary, dateInfo["year"], dateInfo["month"])
}

// Type 4: 仅显示年
func generateTypeFourSVG(color string, lang string, dateInfo map[string]interface{}) string {
	colorScheme := getColorScheme(color)

	return fmt.Sprintf(`
    <svg id="dynamic_icon_type4" xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 512 512">
        <path class="cls-6" d="M512,447.5c0,32-25,57-57,57H57c-32,0-57-25-57-57V120.5c0-31,25-57,57-57h398c32,0,57,26,57,57v327Z" style="fill: #ecf2f7;"/>
        <path class="cls-1" d="M39,0h434c21.5,0,39,17.5,39,39v146H0V39C0,17.5,17.5,0,39,0Z" style="fill: %s;"/>
        <g style="fill: %s;">
            <circle  cx="468.5" cy="135" r="14"/>
            <circle  cx="468.5" cy="93" r="14"/>
            <circle  cx="425.5" cy="135" r="14"/>
            <circle  cx="425.5" cy="93" r="14"/>
            <circle  cx="382.5" cy="135" r="14"/>
            <circle  cx="382.5" cy="93" r="14"/>
        </g>
        <text x="50%%" y="410.5" style="fill: #66757f;font-size: 200px;text-anchor: middle;font-family: -apple-system, BlinkMacSystemFont, 'Noto Sans', 'Noto Sans CJK SC', 'Microsoft YaHei'; ">%d</text>
    </svg>
    `, colorScheme.Primary, colorScheme.Secondary, dateInfo["year"])
}

// Type 5:: 显示周数
func generateTypeFiveSVG(color string, lang string, dateInfo map[string]interface{}) string {
	colorScheme := getColorScheme(color)

	return fmt.Sprintf(`
    <svg id="dynamic_icon_type5" xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 512 512">
        <path class="cls-6" d="M512,447.5c0,32-25,57-57,57H57c-32,0-57-25-57-57V120.5c0-31,25-57,57-57h398c32,0,57,26,57,57v327Z" style="fill: #ecf2f7;"/>
        <path class="cls-1" d="M39,0h434c21.5,0,39,17.5,39,39v146H0V39C0,17.5,17.5,0,39,0Z" style="fill: %s;"/>
        <g style="fill: %s;">
            <circle  cx="468.5" cy="135" r="14"/>
            <circle  cx="468.5" cy="93" r="14"/>
            <circle  cx="425.5" cy="135" r="14"/>
            <circle  cx="425.5" cy="93" r="14"/>
            <circle  cx="382.5" cy="135" r="14"/>
            <circle  cx="382.5" cy="93" r="14"/>
        </g>
        <text transform="translate(22 146.5)" style="fill: #fff;font-size: 120px; font-family: -apple-system, BlinkMacSystemFont, 'Noto Sans', 'Noto Sans CJK SC', 'Microsoft YaHei'; ">%d</text>
        <text x="50%%" y="410.5" style="fill: #66757f;font-size: 200px;text-anchor: middle;font-family: -apple-system, BlinkMacSystemFont, 'Noto Sans', 'Noto Sans CJK SC', 'Microsoft YaHei'; ">%s</text>
    </svg>
    `, colorScheme.Primary, colorScheme.Secondary, dateInfo["isoYear"], dateInfo["week"])
}

// Type 6: 仅显示星期
func generateTypeSixSVG(color string, lang string, weekdayType string, dateInfo map[string]interface{}) string {

	weekday := dateInfo["weekday"].(string)
	isWeekend := dateInfo["isWeekend"].(bool)

	// 如果不设置颜色，周末默认使用蓝色，工作日默认使用红色
	var colorScheme ColorScheme
	if color == "" {
		if isWeekend {
			colorScheme = colorSchemes["blue"]
		} else {
			colorScheme = colorSchemes["red"]
		}
	} else {
		colorScheme = getColorScheme(color)
	}
	// 动态变化字体大小
	var fontSize float64
	switch lang {
	case "zh_CN", "zh_CHT":
		fontSize = 460 / float64(len([]rune(weekday)))
	default:
		switch weekdayType {
		case "1":
			fontSize = 690 / float64(len([]rune(weekday)))
		case "2":
			fontSize = 600 / float64(len([]rune(weekday)))
		case "3":
			fontSize = 720 / float64(len([]rune(weekday)))
		case "4":
			fontSize = 630 / float64(len([]rune(weekday)))
		default:
			fontSize = 750 / float64(len([]rune(weekday)))
		}
	}

	return fmt.Sprintf(`
    <svg id="dynamic_icon_type6" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
    <path id="center" d="M512,447.5c0,32-25,57-57,57H57c-32,0-57-25-57-57V120.5c0-31,25-57,57-57h398c32,0,57,26,57,57v327Z" style="fill: #ecf2f7;"/>
    <path id="top" d="M39,0h434c21.5,0,39,14,39,31.2v116.8H0V31.2C0,14,17.5,0,39,0Z" style="fill: %s;"/>
    <g id="cirle" style="fill: %s;">
        <circle cx="468.5" cy="113.5" r="14"/>
        <circle cx="468.5" cy="71.5" r="14"/>
        <circle cx="425.5" cy="113.5" r="14"/>
        <circle cx="425.5" cy="71.5" r="14"/>
        <circle cx="382.5" cy="113.5" r="14"/>
        <circle cx="382.5" cy="71.5" r="14"/>
    </g>
    <text id="weekday" x="50%%"  y="65%%" style="fill: %s; font-size: %.2fpx; text-anchor: middle; dominant-baseline:middle; font-family: -apple-system, BlinkMacSystemFont, 'Noto Sans', 'Noto Sans CJK SC', 'Microsoft YaHei';">%s</text>
    </svg>`, colorScheme.Primary, colorScheme.Secondary, colorScheme.Primary, fontSize, weekday)
}

// Type7: 倒数日
func generateTypeSevenSVG(color string, lang string, dateInfo map[string]interface{}) string {
	colorScheme := getColorScheme(color)

	diffDays := dateInfo["countDown"].(int)

	var tipText, diffDaysText string

	// 设置输出字符
	switch {
	case diffDays == 0:
		switch lang {
		case "zh_CN", "zh_CHT":
			tipText = "今天"
		default:
			tipText = "Today"
		}
		diffDaysText = "--"
	case diffDays > 0:
		switch lang {
		case "zh_CN":
			tipText = "还有"
		case "zh_CHT":
			tipText = "還有"
		default:
			tipText = "Left"
		}
		diffDaysText = fmt.Sprintf("%d", diffDays)
	default:
		switch lang {
		case "zh_CN":
			tipText = "已过"
		case "zh_CHT":
			tipText = "已過"
		default:
			tipText = "Past"
		}
		absDiffDays := -diffDays
		diffDaysText = fmt.Sprintf("%d", absDiffDays)
	}

	var dayStr string
	switch lang {
	case "zh_CN", "zh_CHT":
		dayStr = "天"
	default:
		dayStr = "days"
	}
	// 动态变化字体大小
	var fontSize float64
	switch {
	case len(diffDaysText) <= 3:
		fontSize = 240
	case len(diffDaysText) == 4:
		fontSize = 190
	case len(diffDaysText) == 5:
		fontSize = 140
	case len(diffDaysText) >= 6:
		fontSize = 780 / float64(len(diffDaysText))
	}

	return fmt.Sprintf(`
    <svg id="dynamic_icon_type7" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
        <path id="bottom" d="M512,447.5c0,32-25,57-57,57H57c-32,0-57-25-57-57V120.5c0-31,25-57,57-57h398c32,0,57,26,57,57v327Z" style="fill: #ecf2f7;"/>
        <path id="top" d="M39,0h434c21.52,0,39,17.48,39,39v146H0V39C0,17.48,17.48,0,39,0Z" style="fill: %s;"/>
        <text id="year" transform="translate(46.1 78.92)" style="fill: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Noto Sans', 'Noto Sans CJK SC', 'Microsoft YaHei'; font-size: 60px;">%d</text>
        <text id="day" transform="translate(43.58 148.44)" style="fill: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Noto Sans', 'Noto Sans CJK SC', 'Microsoft YaHei'; font-size: 60px;">%s</text>
        <text id="passStr" transform="translate(400 148.44)" style="fill: #fff; text-anchor: middle;font-family: -apple-system, BlinkMacSystemFont, 'Noto Sans', 'Noto Sans CJK SC', 'Microsoft YaHei'; font-size: 71.18px;">%s</text>
        <text id="diffDays" x="50%%" y="65%%" style="font-size: %.0fpx; fill: #66757f; text-anchor: middle; dominant-baseline:middle;font-family: -apple-system, BlinkMacSystemFont, 'Noto Sans', 'Noto Sans CJK SC', 'Microsoft YaHei'; ">%s</text>
        <text id="dayStr" x="50%%" y="472.5" style="font-size: 64px; text-anchor: middle; fill: #66757f; font-family: -apple-system, BlinkMacSystemFont, 'Noto Sans', 'Noto Sans CJK SC', 'Microsoft YaHei';">%s</text>
    </svg>`, colorScheme.Primary, dateInfo["year"], dateInfo["date"], tipText, fontSize, diffDaysText, dayStr)
}

// Type 8: 文字图标
func generateTypeEightSVG(color, content, id string) string {
	if strings.Contains(content, ".action{") {
		content = model.RenderDynamicIconContentTemplate(content, id)
	}

	colorScheme := getColorScheme(color)

	// 动态变化字体大小
	isChinese := regexp.MustCompile(`[\p{Han}]`).MatchString(content)
	var fontSize float64
	if isChinese {
		switch {
		case len([]rune(content)) == 1:
			fontSize = 320
		default:
			fontSize = 480 / float64(len([]rune(content)))
		}
	} else {
		switch {
		case len([]rune(content)) == 1:
			fontSize = 480
		case len([]rune(content)) == 2:
			fontSize = 300
		case len([]rune(content)) == 3:
			fontSize = 240
		default:
			fontSize = 750 / float64(len([]rune(content)))
		}
	}
	// 当内容为单个字符时，一些小写字母需要调整文字位置(暂时没法批量解决)
	dy := "0%"
	if len([]rune(content)) == 1 {
		switch content {
		case "g", "p", "y", "q":
			dy = "-10%"
		case "j":
			dy = "-5%"
		default:
			dy = "0%"
		}
	}

	return fmt.Sprintf(`
    <svg id="dynamic_icon_type8" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
        <path d="M39,0h434c20.97,0,38,17.03,38,38v412c0,33.11-26.89,60-60,60H60c-32.56,0-59-26.44-59-59V38C1,17.03,18.03,0,39,0Z" style="fill: %s;"/>
        <text x="50%%" y="55%%" dy="%s" style="font-size: %.2fpx; fill: #fff; text-anchor: middle; dominant-baseline:middle;font-family: -apple-system, BlinkMacSystemFont, 'Noto Sans', 'Noto Sans CJK SC', 'Microsoft YaHei'; ">%s</text>
	</svg>
    `, colorScheme.Primary, dy, fontSize, content)
}
