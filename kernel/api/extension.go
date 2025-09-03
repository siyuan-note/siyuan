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
	"regexp"
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

	clippingSym := false
	symArticleHref := ""
	hasHref := nil != form.Value["href"]
	isPartClip := nil != form.Value["clipType"] && form.Value["clipType"][0] == "part"
	if hasHref && !isPartClip {
		// 剪藏链滴帖子时直接使用 Markdown 接口的返回
		// https://ld246.com/article/raw/1724850322251
		symArticleHref = form.Value["href"][0]

		var baseURL, originalPrefix string
		if strings.HasPrefix(symArticleHref, "https://ld246.com/article/") {
			baseURL = "https://ld246.com/article/raw/"
			originalPrefix = "https://ld246.com/article/"
		} else if strings.HasPrefix(symArticleHref, "https://liuyun.io/article/") {
			baseURL = "https://liuyun.io/article/raw/"
			originalPrefix = "https://liuyun.io/article/"
		}

		if "" != baseURL {
			articleID := strings.TrimPrefix(symArticleHref, originalPrefix)
			if idx := strings.IndexAny(articleID, "/?#"); -1 != idx {
				articleID = articleID[:idx]
			}

			symArticleHref = baseURL + articleID
			clippingSym = true
		}
	}

	uploaded := map[string]string{}
	for originalName, file := range form.File {
		oName, err := url.PathUnescape(originalName)
		unescaped := oName

		if clippingSym && strings.Contains(oName, "img-loading.svg") {
			continue
		}

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
		if strings.Contains(oName, "%") {
			unescaped, _ := url.PathUnescape(oName)
			if "" != unescaped {
				oName = unescaped
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

		fName = util.FilterUploadFileName(fName)
		ext := util.Ext(fName)
		if !util.IsCommonExt(ext) || strings.Contains(ext, "!") {
			// 改进浏览器剪藏扩展转换本地图片后缀 https://github.com/siyuan-note/siyuan/issues/7467 https://github.com/siyuan-note/siyuan/issues/15320
			if mtype := mimetype.Detect(data); nil != mtype {
				ext = mtype.Extension()
				fName += ext
			}
		}
		if "" == ext && bytes.HasPrefix(data, []byte("<svg ")) && bytes.HasSuffix(data, []byte("</svg>")) {
			ext = ".svg"
			fName += ext
		}

		fName = util.AssetName(fName, ast.NewNodeID())
		writePath := filepath.Join(assets, fName)
		if err = filelock.WriteFile(writePath, data); err != nil {
			ret.Code = -1
			ret.Msg = err.Error()
			break
		}

		uploaded[unescaped] = "assets/" + fName
	}

	luteEngine := util.NewLute()
	luteEngine.SetHTMLTag2TextMark(true)
	var md string
	var withMath bool

	if clippingSym {
		resp, err := httpclient.NewCloudRequest30s().Get(symArticleHref)
		if err != nil {
			logging.LogWarnf("get [%s] failed: %s", symArticleHref, err)
		} else {
			bodyData, readErr := io.ReadAll(resp.Body)
			if nil != readErr {
				ret.Code = -1
				ret.Msg = "read response body failed: " + readErr.Error()
				return
			}

			md = string(bodyData)
			luteEngine.SetIndentCodeBlock(true) // 链滴支持缩进代码块，因此需要开启
			tree := parse.Parse("", []byte(md), luteEngine.ParseOptions)
			ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
				if ast.NodeInlineMath == n.Type {
					withMath = true
					return ast.WalkStop
				} else if ast.NodeCodeBlock == n.Type {
					if !n.IsFencedCodeBlock {
						// 将缩进代码块转换为围栏代码块
						n.IsFencedCodeBlock = true
						n.CodeBlockFenceChar = '`'
						n.PrependChild(&ast.Node{Type: ast.NodeCodeBlockFenceInfoMarker})
						n.PrependChild(&ast.Node{Type: ast.NodeCodeBlockFenceOpenMarker, Tokens: []byte("```"), CodeBlockFenceLen: 3})
						n.LastChild.InsertAfter(&ast.Node{Type: ast.NodeCodeBlockFenceCloseMarker, Tokens: []byte("```"), CodeBlockFenceLen: 3})
						code := n.ChildByType(ast.NodeCodeBlockCode)
						if nil != code {
							code.Tokens = bytes.TrimPrefix(code.Tokens, []byte("    "))
							code.Tokens = bytes.ReplaceAll(code.Tokens, []byte("\n    "), []byte("\n"))
							code.Tokens = bytes.TrimPrefix(code.Tokens, []byte("\t"))
							code.Tokens = bytes.ReplaceAll(code.Tokens, []byte("\n\t"), []byte("\n"))
						}
					}
				}
				return ast.WalkContinue
			})

			md, _ = lute.FormatNodeSync(tree.Root, luteEngine.ParseOptions, luteEngine.RenderOptions)
		}
	}

	var tree *parse.Tree
	if "" == md {
		// 通过正则将 <iframe>.*</iframe> 标签中间包含的换行去掉
		regx, _ := regexp.Compile(`(?i)<iframe[^>]*>([\s\S]*?)<\/iframe>`)
		dom = regx.ReplaceAllStringFunc(dom, func(s string) string {
			s = strings.ReplaceAll(s, "\n", "")
			s = strings.ReplaceAll(s, "\r", "")
			return s
		})

		tree, withMath = model.HTML2Tree(dom, luteEngine)
		if nil == tree {
			md, withMath, _ = model.HTML2Markdown(dom, luteEngine)
			if withMath {
				luteEngine.SetInlineMath(true)
			}
			tree = parse.Parse("", []byte(md), luteEngine.ParseOptions)
		}
	} else {
		tree = parse.Parse("", []byte(md), luteEngine.ParseOptions)
	}

	var unlinks []*ast.Node
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

				// 检测 alt 和 title 格式，如果不是文本的话转换为文本 https://github.com/siyuan-note/siyuan/issues/14233
				if linkText := n.ChildByType(ast.NodeLinkText); nil != linkText {
					if inlineTree := parse.Inline("", linkText.Tokens, luteEngine.ParseOptions); nil != inlineTree && nil != inlineTree.Root && nil != inlineTree.Root.FirstChild {
						if fc := inlineTree.Root.FirstChild.FirstChild; nil != fc {
							if ast.NodeText != fc.Type {
								linkText.Tokens = []byte(fc.Text())
							}
						}
					}
				}
				if title := n.ChildByType(ast.NodeLinkTitle); nil != title {
					if inlineTree := parse.Inline("", title.Tokens, luteEngine.ParseOptions); nil != inlineTree && nil != inlineTree.Root && nil != inlineTree.Root.FirstChild {
						if fc := inlineTree.Root.FirstChild.FirstChild; nil != fc {
							if ast.NodeText != fc.Type {
								title.Tokens = []byte(fc.Text())
							}
						}
					}
				}
			}
		}
		return ast.WalkContinue
	})
	for _, unlink := range unlinks {
		unlink.Unlink()
	}

	parse.TextMarks2Inlines(tree) // 先将 TextMark 转换为 Inlines https://github.com/siyuan-note/siyuan/issues/13056
	parse.NestedInlines2FlattedSpansHybrid(tree, false)

	md, _ = lute.FormatNodeSync(tree.Root, luteEngine.ParseOptions, luteEngine.RenderOptions)
	ret.Data = map[string]interface{}{
		"md":       md,
		"withMath": withMath,
	}
	ret.Msg = model.Conf.Language(72)
}
