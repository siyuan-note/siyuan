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
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func copyStdMarkdown(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	ret.Data = model.ExportStdMarkdown(id)
}

func html2BlockDOM(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	dom := arg["dom"].(string)
	markdown, err := model.HTML2Markdown(dom)
	if nil != err {
		ret.Data = "Failed to convert"
		return
	}

	luteEngine := util.NewLute()
	var unlinks []*ast.Node
	tree := parse.Parse("", []byte(markdown), luteEngine.ParseOptions)
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		if ast.NodeListItem == n.Type && nil == n.FirstChild {
			newNode := treenode.NewParagraph()
			n.AppendChild(newNode)
			n.SetIALAttr("updated", util.TimeFromID(newNode.ID))
			return ast.WalkSkipChildren
		} else if ast.NodeBlockquote == n.Type && nil == n.FirstChild.Next {
			unlinks = append(unlinks, n)
		}
		return ast.WalkContinue
	})
	for _, n := range unlinks {
		n.Unlink()
	}

	if util.ContainerStd == model.Conf.System.Container {
		// 处理本地资源文件复制
		ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
			if !entering || ast.NodeLinkDest != n.Type {
				return ast.WalkContinue
			}

			if "" == n.TokensStr() {
				return ast.WalkContinue
			}

			localPath := n.TokensStr()
			if strings.HasPrefix(localPath, "http") {
				return ast.WalkContinue
			}

			localPath = strings.TrimPrefix(localPath, "file://")
			if gulu.OS.IsWindows() {
				localPath = strings.TrimPrefix(localPath, "/")
			}

			if !filepath.IsAbs(localPath) {
				// Kernel crash when copy-pasting from some browsers https://github.com/siyuan-note/siyuan/issues/9203
				return ast.WalkContinue
			}
			if !gulu.File.IsExist(localPath) {
				return ast.WalkContinue
			}

			name := filepath.Base(localPath)
			ext := filepath.Ext(name)
			name = name[0 : len(name)-len(ext)]
			name = name + "-" + ast.NewNodeID() + ext
			targetPath := filepath.Join(util.DataDir, "assets", name)
			if err = filelock.Copy(localPath, targetPath); nil != err {
				logging.LogErrorf("copy asset from [%s] to [%s] failed: %s", localPath, targetPath, err)
				return ast.WalkStop
			}
			n.Tokens = gulu.Str.ToBytes("assets/" + name)
			return ast.WalkContinue
		})
	}

	// 复制带超链接的图片无法保存到本地 https://github.com/siyuan-note/siyuan/issues/5993
	parse.NestedInlines2FlattedSpans(tree)

	renderer := render.NewProtyleRenderer(tree, luteEngine.RenderOptions)
	output := renderer.Render()
	ret.Data = gulu.Str.FromBytes(output)
}

func spinBlockDOM(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	dom := arg["dom"].(string)
	luteEngine := model.NewLute()

	dom = luteEngine.SpinBlockDOM(dom)
	ret.Data = map[string]interface{}{
		"dom": dom,
	}
}
