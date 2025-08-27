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

package filesys

import (
	"math"
	"text/template"
	"time"

	"github.com/88250/go-humanize"
	"github.com/88250/lute/parse"
	util2 "github.com/88250/lute/util"
	"github.com/Masterminds/sprig/v3"
	"github.com/araddon/dateparse"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
	"github.com/spf13/cast"
)

func BuiltInTemplateFuncs() (ret template.FuncMap) {
	ret = sprig.TxtFuncMap()

	// 因为安全原因移除一些函数 https://github.com/siyuan-note/siyuan/issues/13426
	delete(ret, "env")
	delete(ret, "expandenv")
	delete(ret, "getHostByName")

	ret["Weekday"] = util.Weekday
	ret["WeekdayCN"] = util.WeekdayCN
	ret["WeekdayCN2"] = util.WeekdayCN2
	ret["ISOWeek"] = util.ISOWeek
	ret["ISOYear"] = util.ISOYear
	ret["ISOMonth"] = util.ISOMonth
	ret["ISOWeekDate"] = util.ISOWeekDate
	ret["pow"] = pow
	ret["powf"] = powf
	ret["log"] = log
	ret["logf"] = logf
	ret["parseTime"] = parseTime
	ret["FormatFloat"] = FormatFloat
	ret["getHPathByID"] = getHPathByID
	ret["statBlock"] = StatBlock
	ret["runeCount"] = runeCount
	ret["wordCount"] = wordCount
	ret["markdown2text"] = markdown2text
	ret["markdown2content"] = markdown2content
	return
}

func markdown2content(md string) (ret string) {
	luteEngine := util.NewLute()
	tree := parse.Parse("", []byte(md), luteEngine.ParseOptions)
	if nil == tree || nil == tree.Root {
		logging.LogWarnf("parse markdown [%s] failed", md)
		return
	}
	return tree.Root.Content()
}

func markdown2text(md string) (ret string) {
	luteEngine := util.NewLute()
	tree := parse.Parse("", []byte(md), luteEngine.ParseOptions)
	if nil == tree || nil == tree.Root {
		logging.LogWarnf("parse markdown [%s] failed", md)
		return
	}
	return tree.Root.Text()
}

func runeCount(s string) (ret int) {
	ret, _ = util2.WordCount(s)
	return
}

func wordCount(s string) (ret int) {
	_, ret = util2.WordCount(s)
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
	if err != nil {
		logging.LogWarnf("parse date [%s] failed [%s], return current time instead", dateStr, err)
		return now
	}
	return retTime
}

func FormatFloat(format string, n float64) string {
	return humanize.FormatFloat(format, n)
}

func getHPathByID(id string) (ret string) {
	bt := treenode.GetBlockTree(id)
	if nil == bt {
		return
	}
	ret = bt.HPath
	return
}
