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
	"time"
	"strings"
	"github.com/gin-gonic/gin"
)

type ColorScheme struct {
	Primary   string
	Secondary string
}

var colorSchemes = map[string]ColorScheme{
	"red":    {"#DD2F45", "#F4BEC3"},
	"blue":   {"#2bb7ff", "#0097e6"},
	"yellow": {"#feca57", "#ff9f43"},
	"green":  {"#55efc4", "#19b37a"},
	"purple": {"#a55eea", "#8854d0"},
	"pink":   {"#fd79a8", "#e05b8a"},
	"orange": {"#ff7f50", "#ff6348"},
	"grey":   {"#576574", "#222f3e"},
}

func getColorScheme(color string) ColorScheme {
	// 检查是否是预定义的颜色
	if scheme, ok := colorSchemes[strings.ToLower(color)]; ok {
		return scheme
	}



	// 如果不是预定义颜色，返回默认颜色
	return colorSchemes["red"]
}


func getDynamicIcon(c *gin.Context) {
	iconType := c.Query("type")
	color := c.Query("color")
	date := c.Query("date")
	locale := c.DefaultQuery("locale", "cn")
	content := c.Query("content")

	var svg string
	switch iconType {
	case "1":
		svg = generateTypeOneSVG(color, date, locale)
	case "2":
		svg = generateTypeTwoSVG(color, date, locale)
	case "3":
		svg = generateTypeThreeSVG(color, date, locale)
	case "4":
		svg = generateTypeFourSVG(color, date, locale)
	case "5":
		svg = generateTypeFiveSVG(color, date, locale)
	case "6":
		svg = generateTypeSixSVG(color, date, locale)
	case "7":
		svg = generateTypeSevenSVG(color, date, locale)
	case "8":
		svg = generateTypeEightSVG(color, content)
	default:
		svg = generateTypeOneSVG(color, date, locale)
	}

	c.Header("Content-Type", "image/svg+xml")
	c.Header("Cache-Control", "no-cache")
	c.Header("Pragma", "no-cache")
	c.String(http.StatusOK, svg)
}

func getDateInfo(dateStr string, locale string) map[string]interface{} {
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

	year := date.Year()
	month := date.Format("Jan")
	day := date.Day()
	weekday := date.Weekday().String()
	weekdayShort := date.Format("Mon")

	if locale == "cn" {
		month = date.Format("1月")
		weekday = []string{"星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"}[date.Weekday()]
		weekdayShort = []string{"周日", "周一", "周二", "周三", "周四", "周五", "周六"}[date.Weekday()]
	}

	// Calculate week number
	_, week := date.ISOWeek()
	weekString := fmt.Sprintf("%d周", week)
	if locale == "en" {
		weekString = fmt.Sprintf("%dW", week)
	}

	// Calculate days until today
	today := time.Now()
	today = time.Date(today.Year(), today.Month(), today.Day(), 0, 0, 0, 0, today.Location())
	date = time.Date(date.Year(), date.Month(), date.Day(), 0, 0, 0, 0, date.Location())
	countDown := int(math.Floor(date.Sub(today).Hours() / 24))

	return map[string]interface{}{
		"year":           year,
		"month":          month,
		"day":            day,
		"date":           fmt.Sprintf("%02d-%02d", date.Month(), date.Day()),
		"weekday":        weekday,
		"weekdayShort":   weekdayShort,
		"week":           weekString,
		"countDown": countDown,
	}
}

// Type 1: 显示年月日星期
func generateTypeOneSVG(color, date, locale string) string {
	colorScheme := getColorScheme(color)
	dateInfo := getDateInfo(date, locale)

	return fmt.Sprintf(`
    <svg id="dynamic_icon_type1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 504.5">
    <path d="M512,447.5c0,32-25,57-57,57H57c-32,0-57-25-57-57V120.5c0-31,25-57,57-57h398c32,0,57,26,57,57v327Z" style="fill: #ecf2f7;"/>
    <path d="M39,0h434c21.52,0,39,17.48,39,39v146H0V39C0,17.48,17.48,0,39,0Z" style="fill: %s;"/>
    <text transform="translate(22 146.5)" style="fill: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Noto Sans', 'Noto Sans CJK SC', 'Microsoft YaHei'; font-size: 100px;">%s</text>
    <text transform="translate(260 392.5)" style="fill: #66757f; font-family: -apple-system, BlinkMacSystemFont, 'Noto Sans', 'Noto Sans CJK SC', 'Microsoft YaHei'; font-size: 240px; text-anchor: middle">%d</text>
    <text transform="translate(260 472.5)" style="fill: #66757f; font-family: -apple-system, BlinkMacSystemFont, 'Noto Sans', 'Noto Sans CJK SC', 'Microsoft YaHei'; font-size: 64px; text-anchor: middle">%s</text>
    <text transform="translate(331.03 148.44)" style="fill: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Noto Sans', 'Noto Sans CJK SC', 'Microsoft YaHei'; font-size: 71.18px;">%d</text>
    </svg>
    `, colorScheme.Primary, dateInfo["month"], dateInfo["day"], dateInfo["weekday"], dateInfo["year"])
}

// Type 2: 显示年月日
func generateTypeTwoSVG(color, date, locale string) string {
	colorScheme := getColorScheme(color)
	dateInfo := getDateInfo(date, locale)

	return fmt.Sprintf(`
    <svg id="dynamic_icon_type2" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 504.5">
    <path d="M512,447.5c0,32-25,57-57,57H57c-32,0-57-25-57-57V120.5c0-31,25-57,57-57h398c32,0,57,26,57,57v327Z" style="fill: #ecf2f7;"/>
    <path d="M39,0h434c21.52,0,39,17.48,39,39v146H0V39C0,17.48,17.48,0,39,0Z" style="fill: %s;"/>
    <text transform="translate(22 146.5)" style="fill: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Noto Sans', 'Noto Sans CJK SC', 'Microsoft YaHei'; font-size: 100px;">%s</text>
    <text transform="translate(260 420.5)" style="fill: #66757f; font-family: -apple-system, BlinkMacSystemFont, 'Noto Sans', 'Noto Sans CJK SC', 'Microsoft YaHei'; font-size: 256px;text-anchor: middle">%d</text>
    <text transform="translate(331.03 148.44)" style="fill: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Noto Sans', 'Noto Sans CJK SC', 'Microsoft YaHei'; font-size: 71.18px;">%d</text>
    </svg>
    `, colorScheme.Primary, dateInfo["month"], dateInfo["day"], dateInfo["year"])
}

// Type 3: 显示年月
func generateTypeThreeSVG(color, date, locale string) string {
	colorScheme := getColorScheme(color)
	dateInfo := getDateInfo(date, locale)

	return fmt.Sprintf(`
    <svg id="dynamic_icon_type3" xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 512 504.5">
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
        <text transform="translate(260 410.5)" style="fill: #66757f;font-size: 160px;text-anchor: middle;font-family: -apple-system, BlinkMacSystemFont, 'Noto Sans', 'Noto Sans CJK SC', 'Microsoft YaHei'; ">%s</text>
    </svg>
    `, colorScheme.Primary, colorScheme.Secondary, dateInfo["year"], dateInfo["month"])
}

// Type 4: 仅显示年
func generateTypeFourSVG(color, date, locale string) string {
	colorScheme := getColorScheme(color)
	dateInfo := getDateInfo(date, locale)

	return fmt.Sprintf(`
    <svg id="dynamic_icon_type4" xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 512 504.5">
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
        <text transform="translate(260 410.5)" style="fill: #66757f;font-size: 180px;text-anchor: middle;font-family: -apple-system, BlinkMacSystemFont, 'Noto Sans', 'Noto Sans CJK SC', 'Microsoft YaHei'; ">%d</text>
    </svg>
    `, colorScheme.Primary, colorScheme.Secondary, dateInfo["year"])
}

// Type 5:: 显示周数
func generateTypeFiveSVG(color, date, locale string) string {
	colorScheme := getColorScheme(color)
	dateInfo := getDateInfo(date, locale)

	return fmt.Sprintf(`
    <svg id="dynamic_icon_type5" xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 512 504.5">
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
        <text transform="translate(260 410.5)" style="fill: #66757f;font-size: 200px;text-anchor: middle;font-family: -apple-system, BlinkMacSystemFont, 'Noto Sans', 'Noto Sans CJK SC', 'Microsoft YaHei'; ">%s</text>
    </svg>
    `, colorScheme.Primary, colorScheme.Secondary, dateInfo["year"], dateInfo["week"])
}

// Type 6: 仅显示星期
func generateTypeSixSVG(color, date, locale string) string {
	dateInfo := getDateInfo(date, locale)
	weekday := dateInfo["weekday"].(string)

	var colorScheme ColorScheme
	if color == "" {
		if weekday == "Saturday" || weekday == "Sunday" || weekday == "星期六" || weekday == "星期日" {
			colorScheme = colorSchemes["blue"]
		} else {
			colorScheme = colorSchemes["red"]
		}
	} else {
		colorScheme = getColorScheme(color)
	}

	return fmt.Sprintf(`
    <svg id="dynamic_icon_type6" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 504.5">
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
    <text id="weekday" transform="translate(260 380)" style="fill: %s; font-size: 210px; text-anchor: middle; font-family: -apple-system, BlinkMacSystemFont, 'Noto Sans', 'Noto Sans CJK SC', 'Microsoft YaHei';">%s</text>
    </svg>`, colorScheme.Primary, colorScheme.Secondary, colorScheme.Primary, dateInfo["weekdayShort"])
}

// Type7: 倒数日
func generateTypeSevenSVG(color, date, locale string) string {
	colorScheme := getColorScheme(color)
	dateInfo := getDateInfo(date, locale)
	diffDays := dateInfo["countDown"].(int)

	var tipText, diffDaysText string
	if diffDays == 0 {
		tipText = map[string]string{"en": "Today", "cn": "今天"}[locale]
		diffDaysText = "--"
	} else if diffDays > 0 {
		tipText = map[string]string{"en": "Left", "cn": "还有"}[locale]
		diffDaysText = fmt.Sprintf("%d", diffDays)
	} else {
		tipText = map[string]string{"en": "Past", "cn": "已过"}[locale]
		diffDaysText = fmt.Sprintf("%d", int(math.Abs(float64(diffDays))))
	}

	dayStr := map[string]string{"en": "days", "cn": "天"}[locale]

	fontSize := 240.0
	if len(diffDaysText) >= 6 {
		fontSize = 130
	} else if len(diffDaysText) == 5 {
		fontSize = 140
	} else if len(diffDaysText) == 4 {
		fontSize = 190
	}

	return fmt.Sprintf(`
    <svg id="dynamic_icon_type7" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 504.5">
        <path id="bottom" d="M512,447.5c0,32-25,57-57,57H57c-32,0-57-25-57-57V120.5c0-31,25-57,57-57h398c32,0,57,26,57,57v327Z" style="fill: #ecf2f7;"/>
        <path id="top" d="M39,0h434c21.52,0,39,17.48,39,39v146H0V39C0,17.48,17.48,0,39,0Z" style="fill: %s;"/>
        <text id="year" transform="translate(46.1 78.92)" style="fill: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Noto Sans', 'Noto Sans CJK SC', 'Microsoft YaHei'; font-size: 60px;">%d</text>
        <text id="day" transform="translate(43.58 148.44)" style="fill: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Noto Sans', 'Noto Sans CJK SC', 'Microsoft YaHei'; font-size: 60px;">%s</text>
        <text id="passStr" transform="translate(400 148.44)" style="fill: #fff; text-anchor: middle;font-family: -apple-system, BlinkMacSystemFont, 'Noto Sans', 'Noto Sans CJK SC', 'Microsoft YaHei'; font-size: 71.18px;">%s</text>
        <text id="diffDays" x="260" y="76%%" style="font-size: %.0fpx; fill: #66757f; text-anchor: middle; font-family: -apple-system, BlinkMacSystemFont, 'Noto Sans', 'Noto Sans CJK SC', 'Microsoft YaHei'; ">%s</text>
        <text id="dayStr" transform="translate(260 472.5)" style="font-size: 64px; text-anchor: middle; fill: #66757f; font-family: -apple-system, BlinkMacSystemFont, 'Noto Sans', 'Noto Sans CJK SC', 'Microsoft YaHei';">%s</text>
    </svg>`, colorScheme.Primary, dateInfo["year"], dateInfo["date"], tipText, fontSize, diffDaysText, dayStr)
}

// Type 8: 文字图标
func generateTypeEightSVG(color, content string) string {
	colorScheme := getColorScheme(color)

	isChinese := regexp.MustCompile(`[\p{Han}]`).MatchString(content)

	var fontSize float64
	switch {
	case len([]rune(content)) == 1:
		fontSize = 320
	case len([]rune(content)) == 2:
		fontSize = 240
	case len([]rune(content)) == 3:
		fontSize = 160
	case len([]rune(content)) == 4:
		fontSize = 120
	case len([]rune(content)) == 5:
		fontSize = 95
	default:
		if isChinese {
			fontSize = 480 / float64(len([]rune(content)))
		} else {
			fontSize = 750 / float64(len([]rune(content)))
		}
	}

	return fmt.Sprintf(`
    <svg id="dynamic_icon_type8" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 511">
        <path d="M39,0h434c20.97,0,38,17.03,38,38v412c0,33.11-26.89,60-60,60H60c-32.56,0-59-26.44-59-59V38C1,17.03,18.03,0,39,0Z" style="fill: %s;"/>
        <text x="260px" y="55%%" style="font-size: %.2fpx; fill: #fff; text-anchor: middle; dominant-baseline:middle;font-family: -apple-system, BlinkMacSystemFont, 'Noto Sans', 'Noto Sans CJK SC', 'Microsoft YaHei'; ">%s</text>
    </svg>
    `, colorScheme.Primary, fontSize, content)
}
