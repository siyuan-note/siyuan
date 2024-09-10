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
	"bytes"
	"io"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/88250/gulu"
	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/gabriel-vasile/mimetype"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/httpclient"
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

	if err := os.MkdirAll(assets, 0755); err != nil {
		logging.LogErrorf("create assets folder [%s] failed: %s", assets, err)
		ret.Msg = err.Error()
		return
	}

	uploaded := map[string]string{}
	for originalName, file := range form.File {
		oName, err := url.PathUnescape(originalName)
		if err != nil {
			if strings.Contains(originalName, "%u") {
				originalName = strings.ReplaceAll(originalName, "%u", "\\u")
				originalName, err = strconv.Unquote("\"" + originalName + "\"")
				if err != nil {
					continue
				}
				oName, err = url.PathUnescape(originalName)
				if err != nil {
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

		f, err := file[0].Open()
		if err != nil {
			ret.Code = -1
			ret.Msg = err.Error()
			break
		}

		data, err := io.ReadAll(f)
		if err != nil {
			ret.Code = -1
			ret.Msg = err.Error()
			break
		}

		ext := path.Ext(fName)
		originalExt := ext
		if "" == ext || strings.Contains(ext, "!") {
			// 改进浏览器剪藏扩展转换本地图片后缀 https://github.com/siyuan-note/siyuan/issues/7467
			if mtype := mimetype.Detect(data); nil != mtype {
				ext = mtype.Extension()
			}
		}
		if "" == ext && bytes.HasPrefix(data, []byte("<svg ")) && bytes.HasSuffix(data, []byte("</svg>")) {
			ext = ".svg"
		}

		fName = fName[0 : len(fName)-len(originalExt)]
		fName = util.FilterUploadFileName(fName)
		fName = fName + "-" + ast.NewNodeID() + ext
		writePath := filepath.Join(assets, fName)
		if err = filelock.WriteFile(writePath, data); err != nil {
			ret.Code = -1
			ret.Msg = err.Error()
			break
		}

		uploaded[oName] = "assets/" + fName
	}

	luteEngine := util.NewLute()
	var md string
	var withMath bool
	if nil != form.Value["href"] {
		if href := form.Value["href"][0]; strings.HasPrefix(href, "https://ld246.com/article/") || strings.HasPrefix(href, "https://liuyun.io/article/") {
			// 剪藏链滴帖子时直接使用 Markdown 接口的返回
			// https://ld246.com/article/raw/1724850322251
			href = strings.ReplaceAll(href, "https://ld246.com/article/", "https://ld246.com/article/raw/")
			href = strings.ReplaceAll(href, "https://liuyun.io/article/", "https://liuyun.io/article/raw/")
			resp, err := httpclient.NewCloudRequest30s().Get(href)
			if err != nil {
				logging.LogWarnf("get [%s] failed: %s", href, err)
			} else {
				bodyData, readErr := io.ReadAll(resp.Body)
				if nil != readErr {
					ret.Code = -1
					ret.Msg = "read response body failed: " + readErr.Error()
					return
				}

				md = string(bodyData)
				tree := parse.Parse("", []byte(md), luteEngine.ParseOptions)
				ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
					if ast.NodeInlineMath == n.Type {
						withMath = true
						return ast.WalkStop
					}
					return ast.WalkContinue
				})
			}
		}
	}

	if "" == md {
		md, withMath, _ = model.HTML2Markdown(dom)
	}

	md = strings.TrimSpace(md)
	if withMath {
		luteEngine.SetInlineMath(true)
	}
	var unlinks []*ast.Node
	tree := parse.Parse("", []byte(md), luteEngine.ParseOptions)
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		if ast.NodeText == n.Type {
			// 剔除行首空白
			if ast.NodeParagraph == n.Parent.Type && n.Parent.FirstChild == n {
				n.Tokens = bytes.TrimLeft(n.Tokens, " \t\n")
			}
		} else if ast.NodeImage == n.Type {
			if dest := n.ChildByType(ast.NodeLinkDest); nil != dest {
				assetPath := uploaded[string(dest.Tokens)]
				if "" == assetPath {
					assetPath = uploaded[string(dest.Tokens)+"?imageView2/2/interlace/1/format/webp"]
				}
				if "" != assetPath {
					dest.Tokens = []byte(assetPath)
				}
			}
		}
		return ast.WalkContinue
	})
	for _, unlink := range unlinks {
		unlink.Unlink()
	}

	parse.NestedInlines2FlattedSpansHybrid(tree, false)

	md, _ = lute.FormatNodeSync(tree.Root, luteEngine.ParseOptions, luteEngine.RenderOptions)
	ret.Data = map[string]interface{}{
		"md":       md,
		"withMath": withMath,
	}
	ret.Msg = model.Conf.Language(72)
}
