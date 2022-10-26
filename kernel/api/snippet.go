// SiYuan - Build Your Eternal Digital Garden
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
	"mime"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func serveSnippets(c *gin.Context) {
	name := strings.TrimPrefix(c.Request.URL.Path, "/snippets/")
	ext := filepath.Ext(name)
	name = strings.TrimSuffix(name, ext)
	confSnippets, err := model.LoadSnippets()
	if nil != err {
		logging.LogErrorf("load snippets failed: %s", name, err)
		c.Status(404)
		return
	}

	for _, s := range confSnippets {
		if s.Name == name && ("" != ext && s.Type == ext[1:]) {
			c.Header("Content-Type", mime.TypeByExtension(ext))
			c.String(http.StatusOK, s.Content)
			return
		}
	}
	c.Status(404)
}

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
	if 1 > len(snippets) {
		snippets = []*conf.Snippet{}
	}

	ret.Data = map[string]interface{}{
		"snippets": snippets,
	}
}
