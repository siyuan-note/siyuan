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
	"bytes"
	"io"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func extensionCopy(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(200, ret)

	form, _ := c.MultipartForm()
	dom := form.Value["dom"][0]
	assets := filepath.Join(util.DataDir, "assets")
	if notebookVal := form.Value["notebook"]; 0 < len(notebookVal) {
		assets = filepath.Join(util.DataDir, notebookVal[0], "assets")
		if !gulu.File.IsDir(assets) {
			assets = filepath.Join(util.DataDir, "assets")
		}
	}

	if err := os.MkdirAll(assets, 0755); nil != err {
		logging.LogErrorf("create assets folder [%s] failed: %s", assets, err)
		ret.Msg = err.Error()
		return
	}

	luteEngine := model.NewLute()
	md := luteEngine.HTML2Md(dom)
	md = strings.TrimSpace(md)
	ret.Data = map[string]interface{}{
		"md": md,
	}

	uploaded := map[string]string{}
	for originalName, file := range form.File {
		oName, err := url.PathUnescape(originalName)
		if nil != err {
			if strings.Contains(originalName, "%u") {
				originalName = strings.ReplaceAll(originalName, "%u", "\\u")
				originalName, err = strconv.Unquote("\"" + originalName + "\"")
				if nil != err {
					continue
				}
				oName, err = url.PathUnescape(originalName)
				if nil != err {
					continue
				}
			} else {
				continue
			}
		}
		u, _ := url.Parse(oName)
		if "" == u.Path {
			continue
		}
		fName := path.Base(u.Path)
		fName = util.FilterUploadFileName(fName)
		f, err := file[0].Open()
		if nil != err {
			ret.Code = -1
			ret.Msg = err.Error()
			break
		}

		data, err := io.ReadAll(f)
		if nil != err {
			ret.Code = -1
			ret.Msg = err.Error()
			break
		}

		ext := path.Ext(fName)
		fName = fName[0 : len(fName)-len(ext)]
		if "" == ext && bytes.HasPrefix(data, []byte("<svg ")) && bytes.HasSuffix(data, []byte("</svg>")) {
			ext = ".svg"
		}
		fName = fName + "-" + ast.NewNodeID() + ext
		writePath := filepath.Join(assets, fName)
		if err = gulu.File.WriteFileSafer(writePath, data, 0644); nil != err {
			ret.Code = -1
			ret.Msg = err.Error()
			break
		}

		uploaded[oName] = "assets/" + fName
	}

	for k, v := range uploaded {
		if "" == md {
			// 复制单个图片的情况
			md = "![](" + v + ")"
			break
		}
		md = strings.ReplaceAll(md, "]("+k+")", "]("+v+")")
		p, err := url.Parse(k)
		if nil != err {
			continue
		}
		md = strings.ReplaceAll(md, "]("+p.Path+")", "]("+v+")")
	}

	ret.Data = map[string]interface{}{
		"md": md,
	}
	ret.Msg = model.Conf.Language(72)
}
