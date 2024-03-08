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

package util

import (
	"github.com/Masterminds/sprig/v3"
	"github.com/araddon/dateparse"
	"github.com/siyuan-note/logging"
	"github.com/spf13/cast"
	"math"
	"text/template"
	"time"
)

func BuiltInTemplateFuncs() (ret template.FuncMap) {
	ret = sprig.TxtFuncMap()
	ret["Weekday"] = Weekday
	ret["WeekdayCN"] = WeekdayCN
	ret["WeekdayCN2"] = WeekdayCN2
	ret["ISOWeek"] = ISOWeek
	ret["pow"] = pow
	ret["powf"] = powf
	ret["log"] = log
	ret["logf"] = logf
	ret["parseTime"] = parseTime
	return
}

func pow(a, b interface{}) int64    { return int64(math.Pow(cast.ToFloat64(a), cast.ToFloat64(b))) }
func powf(a, b interface{}) float64 { return math.Pow(cast.ToFloat64(a), cast.ToFloat64(b)) }
func log(a, b interface{}) int64 {
	return int64(math.Log(cast.ToFloat64(a)) / math.Log(cast.ToFloat64(b)))
}
func logf(a, b interface{}) float64 { return math.Log(cast.ToFloat64(a)) / math.Log(cast.ToFloat64(b)) }

func parseTime(dateStr string) time.Time {
	now := time.Now()
	retTime, err := dateparse.ParseIn(dateStr, now.Location())
	if nil != err {
		logging.LogWarnf("parse date [%s] failed [%s], return current time instead", dateStr, err)
		return now
	}
	return retTime
}
