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
	"github.com/siyuan-note/httpclient"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var extensionClipDiagnosticIDPattern = regexp.MustCompile(`^[a-zA-Z0-9-]{1,64}$`)

func extensionClipAssetLabel(raw string) string {
	decoded, err := url.PathUnescape(raw)
	if nil == err {
		raw = decoded
	}
	u, err := url.Parse(raw)
	if nil != err {
		return "invalid"
	}
	if "data" == u.Scheme || "blob" == u.Scheme {
		return u.Scheme + ":inline"
	}
	name := path.Base(u.Path)
	if "." == name || "/" == name {
		name = ""
	}
	if "" == u.Hostname() {
		raw = name
	} else {
		raw = u.Hostname() + "/" + name
	}
	raw = strings.Map(func(r rune) rune {
		if r < 32 || 127 == r {
			return -1
		}
		return r
	}, raw)
	if 128 < len(raw) {
		raw = raw[:128] + "..."
	}
	return raw
}

func extensionCopy(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(200, ret)

	form, _ := c.MultipartForm()
	dom := form.Value["dom"][0]
	diagnosticID := "unknown"
	if values := form.Value["diagnosticID"]; 0 < len(values) &&
		extensionClipDiagnosticIDPattern.MatchString(values[0]) {
		diagnosticID = values[0]
	}
	assetsOn := len(form.Value["assets"]) > 0 && "true" == form.Value["assets"][0]
	clipType := ""
	if values := form.Value["clipType"]; 0 < len(values) {
		clipType = values[0]
	}
	logging.LogInfof("[browser clipping][%s] received multipart [type=%s, assets=%t, domBytes=%d, files=%d]",
		diagnosticID, clipType, assetsOn, len(dom), len(form.File))
	assets := filepath.Join(util.DataDir, "assets")
	boxID := ""
	if notebookVal := form.Value["notebook"]; 0 < len(notebookVal) {
		nb := notebookVal[0]
		if model.IsEncryptedBox(nb) {
			boxID = nb
			assets = filepath.Join(util.DataDir, nb, "assets")
		} else {
			assets = filepath.Join(util.DataDir, nb, "assets")
			if !gulu.File.IsDir(assets) {
				assets = filepath.Join(util.DataDir, "assets")
			}
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
	storedFileCount := 0
	rejectedFileCount := 0
	for originalName, file := range form.File {
		// 链滴/流云整页剪藏走服务端原始 Markdown，扩展上传的 DOM 资源地址与原始 Markdown 中的地址必然不一致，
		// 上传的文件无法被匹配引用；该路径下由内核按“下载资源”开关统一下载本地化，因此跳过扩展上传的文件
		if clippingSym {
			continue
		}

		oName, err := url.PathUnescape(originalName)
		unescaped := oName

		if err != nil {
			if strings.Contains(originalName, "%u") {
				originalName = strings.ReplaceAll(originalName, "%u", "\\u")
				originalName, err = strconv.Unquote("\"" + originalName + "\"")
				if err != nil {
					rejectedFileCount++
					continue
				}
				oName, err = url.PathUnescape(originalName)
				if err != nil {
					rejectedFileCount++
					continue
				}
			} else {
				rejectedFileCount++
				continue
			}
		}
		if strings.Contains(oName, "%") {
			unescaped, _ := url.PathUnescape(oName)
			if "" != unescaped {
				oName = unescaped
			}
		}

		u, parseErr := url.Parse(oName)
		if nil != parseErr || nil == u {
			rejectedFileCount++
			continue
		}
		if "" == u.Path {
			rejectedFileCount++
			continue
		}
		fName := path.Base(u.Path)

		f, err := file[0].Open()
		if err != nil {
			rejectedFileCount++
			ret.Code = -1
			ret.Msg = err.Error()
			break
		}

		data, err := io.ReadAll(f)
		if err != nil {
			rejectedFileCount++
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

		// 统一通过 storeAssetForBox 写入，加密 box 自动脱敏 + 加密落盘 + 追加 ?box=
		storedName, storeErr := model.StoreAssetForBox(boxID, assets, fName, data)
		if storeErr != nil {
			rejectedFileCount++
			ret.Code = -1
			ret.Msg = storeErr.Error()
			break
		}

		assetURL := "assets/" + storedName
		if boxID != "" {
			assetURL += "?box=" + boxID
		}
		uploaded[unescaped] = assetURL
		storedFileCount++
	}
	logging.LogInfof("[browser clipping][%s] processed multipart files [received=%d, stored=%d, rejected=%d, mappings=%d]",
		diagnosticID, len(form.File), storedFileCount, rejectedFileCount, len(uploaded))

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
			tree.Box = boxID
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

			// 链滴/流云整页剪藏时扩展上传的 DOM 资源地址与服务端原始 Markdown 中的地址不一致，
			// 扩展上传的文件无法匹配；当用户开启“下载资源”时由内核直接下载原始 Markdown 中的网络资源到本地
			if assetsOn {
				model.DownloadNetAssets2LocalAssets(tree, false, symArticleHref, assets)
			}

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

		tree, withMath = model.HTML2Tree(dom, luteEngine, boxID)
	} else {
		tree = parse.Parse("", []byte(md), luteEngine.ParseOptions)
	}

	var unlinks []*ast.Node
	imageCount := 0
	emptyImageDestinationCount := 0
	uploadedMatchCount := 0
	unmatchedNetworkCount := 0
	var unmatchedNetworkAssets []string
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
			imageCount++
			if dest := n.ChildByType(ast.NodeLinkDest); nil != dest {
				originalDest := string(dest.Tokens)
				if "" == originalDest {
					emptyImageDestinationCount++
				}
				assetPath := uploaded[string(dest.Tokens)]
				if "" == assetPath {
					assetPath = uploaded[string(dest.Tokens)+"?imageView2/2/interlace/1/format/webp"]
				}
				if "" != assetPath {
					dest.Tokens = []byte(assetPath)
					uploadedMatchCount++
				} else if strings.HasPrefix(originalDest, "http://") || strings.HasPrefix(originalDest, "https://") {
					unmatchedNetworkCount++
					if len(unmatchedNetworkAssets) < 20 {
						unmatchedNetworkAssets = append(unmatchedNetworkAssets, extensionClipAssetLabel(originalDest))
					}
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
			} else {
				emptyImageDestinationCount++
			}
		}
		return ast.WalkContinue
	})
	for _, unlink := range unlinks {
		unlink.Unlink()
	}
	logging.LogInfof("[browser clipping][%s] matched image destinations [images=%d, emptyDestinations=%d, "+
		"uploadedMatches=%d, unmatchedNetwork=%d, assets=%t, unmatched=%s]", diagnosticID, imageCount,
		emptyImageDestinationCount, uploadedMatchCount, unmatchedNetworkCount, assetsOn,
		strings.Join(unmatchedNetworkAssets, ","))

	parse.TextMarks2Inlines(tree) // 先将 TextMark 转换为 Inlines https://github.com/siyuan-note/siyuan/issues/13056
	parse.NestedInlines2FlattedSpansHybrid(tree, false)

	md, _ = lute.FormatNodeSync(tree.Root, luteEngine.ParseOptions, luteEngine.RenderOptions)
	ret.Data = map[string]any{
		"md":       md,
		"withMath": withMath,
	}
	ret.Msg = model.Conf.Language(72)
}
