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
	"net/http"
	"strings"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func getSnippet(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	typ := arg["type"].(string)                 // js/css/all
	enabledArg := int(arg["enabled"].(float64)) // 0：禁用，1：启用，2：全部
	enabled := true
	if 0 == enabledArg {
		enabled = false
	}
	var keyword string
	if nil != arg["keyword"] {
		keyword = arg["keyword"].(string)
	}

	confSnippets, err := model.LoadSnippets()
	if nil != err {
		ret.Code = -1
		ret.Msg = "load snippets failed: " + err.Error()
		return
	}

	var snippets []*conf.Snippet
	for _, s := range confSnippets {
		if ("all" == typ || s.Type == typ) && (2 == enabledArg || s.Enabled == enabled) {
			snippets = append(snippets, s)
		}
	}

	if "" != keyword {
		var snippetsFiltered []*conf.Snippet
		for _, s := range snippets {
			if strings.Contains(strings.ToLower(s.Name), strings.ToLower(keyword)) || strings.Contains(strings.ToLower(s.Content), strings.ToLower(keyword)) {
				snippetsFiltered = append(snippetsFiltered, s)
			}
		}
		snippets = snippetsFiltered
	}

	if 1 > len(snippets) {
		snippets = []*conf.Snippet{}
	}

	ret.Data = map[string]interface{}{
		"snippets": snippets,
	}
}

func setSnippet(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	snippetsArg := arg["snippets"].([]interface{})
	var snippets []*conf.Snippet
	for _, s := range snippetsArg {
		m := s.(map[string]interface{})
		snippet := &conf.Snippet{
			ID:      m["id"].(string),
			Name:    m["name"].(string),
			Type:    m["type"].(string),
			Content: m["content"].(string),
			Enabled: m["enabled"].(bool),
		}
		if "" == snippet.ID {
			snippet.ID = ast.NewNodeID()
		}
		snippets = append(snippets, snippet)
	}

	err := model.SetSnippet(snippets)
	if nil != err {
		ret.Code = -1
		ret.Msg = "set snippet failed: " + err.Error()
		return
	}
}

func removeSnippet(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	snippet, err := model.RemoveSnippet(id)
	if nil != err {
		ret.Code = -1
		ret.Msg = "remove snippet failed: " + err.Error()
		return
	}
	ret.Data = snippet
}
