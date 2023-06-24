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

package model

import (
	"bytes"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/88250/gulu"
	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/ClarkThan/ahocorasick"
	"github.com/dgraph-io/ristretto"
	"github.com/siyuan-note/siyuan/kernel/search"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

// virtualBlockRefCache 用于保存块关联的虚拟引用关键字。
// 改进打开虚拟引用后加载文档的性能 https://github.com/siyuan-note/siyuan/issues/7378
var virtualBlockRefCache, _ = ristretto.NewCache(&ristretto.Config{
	NumCounters: 102400,
	MaxCost:     10240,
	BufferItems: 64,
})

func getBlockVirtualRefKeywords(root *ast.Node) (ret []string) {
	val, ok := virtualBlockRefCache.Get(root.ID)
	if !ok {
		buf := bytes.Buffer{}
		ast.Walk(root, func(n *ast.Node, entering bool) ast.WalkStatus {
			if !entering || !n.IsBlock() {
				return ast.WalkContinue
			}

			content := treenode.NodeStaticContent(n, nil, false, false)
			buf.WriteString(content)
			return ast.WalkContinue
		})
		content := buf.String()
		ret = putBlockVirtualRefKeywords(content, root.ID, root.IALAttr("title"))
		return
	}
	ret = val.([]string)
	return
}

func putBlockVirtualRefKeywords(blockContent, blockID, docTitle string) (ret []string) {
	keywords := getVirtualRefKeywords(docTitle)
	if 1 > len(keywords) {
		return
	}

	contentTmp := blockContent
	var keywordsTmp []string
	if !Conf.Search.CaseSensitive {
		contentTmp = strings.ToLower(blockContent)
		for _, keyword := range keywords {
			keywordsTmp = append(keywordsTmp, strings.ToLower(keyword))
		}
	} else {
		for _, keyword := range keywords {
			keywordsTmp = append(keywordsTmp, keyword)
		}
	}

	m := ahocorasick.NewMatcher()
	m.BuildWithPatterns(keywordsTmp)
	hits := m.Search(contentTmp)
	for _, hit := range hits {
		ret = append(ret, hit)
	}

	if 1 > len(ret) {
		return
	}

	ret = gulu.Str.RemoveDuplicatedElem(ret)
	virtualBlockRefCache.SetWithTTL(blockID, ret, 1, 10*time.Minute)
	return
}

func CacheVirtualBlockRefJob() {
	virtualBlockRefCache.Del("virtual_ref")
	if !Conf.Editor.VirtualBlockRef {
		return
	}

	keywords := sql.QueryVirtualRefKeywords(Conf.Search.VirtualRefName, Conf.Search.VirtualRefAlias, Conf.Search.VirtualRefAnchor, Conf.Search.VirtualRefDoc)
	virtualBlockRefCache.Set("virtual_ref", keywords, 1)
}

func ResetVirtualBlockRefCache() {
	virtualBlockRefCache.Clear()
	CacheVirtualBlockRefJob()
}

func processVirtualRef(n *ast.Node, unlinks *[]*ast.Node, virtualBlockRefKeywords []string, refCount map[string]int, luteEngine *lute.Lute) bool {
	if !Conf.Editor.VirtualBlockRef {
		return false
	}

	if ast.NodeText != n.Type {
		return false
	}

	parentBlock := treenode.ParentBlock(n)
	if nil == parentBlock || 0 < refCount[parentBlock.ID] {
		return false
	}

	if 1 > len(virtualBlockRefKeywords) {
		return false
	}

	content := string(n.Tokens)
	tmp := gulu.Str.RemoveInvisible(content)
	tmp = strings.TrimSpace(tmp)
	if "" == tmp {
		return false
	}

	newContent := markReplaceSpanWithSplit(content, virtualBlockRefKeywords, search.GetMarkSpanStart(search.VirtualBlockRefDataType), search.GetMarkSpanEnd())
	if content != newContent {
		// 虚拟引用排除命中自身块命名和别名的情况 https://github.com/siyuan-note/siyuan/issues/3185
		var blockKeys []string
		if name := parentBlock.IALAttr("name"); "" != name {
			blockKeys = append(blockKeys, name)
		}
		if alias := parentBlock.IALAttr("alias"); "" != alias {
			blockKeys = append(blockKeys, alias)
		}
		if 0 < len(blockKeys) {
			keys := gulu.Str.SubstringsBetween(newContent, search.GetMarkSpanStart(search.VirtualBlockRefDataType), search.GetMarkSpanEnd())
			for _, k := range keys {
				if gulu.Str.Contains(k, blockKeys) {
					return true
				}
			}
		}

		// Wrong parsing virtual reference with `\` before it https://github.com/siyuan-note/siyuan/issues/7821
		newContent = strings.ReplaceAll(newContent, "\\"+search.GetMarkSpanStart(search.VirtualBlockRefDataType), "\\\\"+search.GetMarkSpanStart(search.VirtualBlockRefDataType))
		n.Tokens = []byte(newContent)
		linkTree := parse.Inline("", n.Tokens, luteEngine.ParseOptions)
		var children []*ast.Node
		for c := linkTree.Root.FirstChild.FirstChild; nil != c; c = c.Next {
			children = append(children, c)
		}
		for _, c := range children {
			n.InsertBefore(c)
		}
		*unlinks = append(*unlinks, n)
		return true
	}
	return false
}

func getVirtualRefKeywords(docName string) (ret []string) {
	if !Conf.Editor.VirtualBlockRef {
		return
	}

	if val, ok := virtualBlockRefCache.Get("virtual_ref"); ok {
		ret = val.([]string)
	}

	if "" != strings.TrimSpace(Conf.Editor.VirtualBlockRefInclude) {
		include := strings.ReplaceAll(Conf.Editor.VirtualBlockRefInclude, "\\,", "__comma@sep__")
		includes := strings.Split(include, ",")
		var tmp []string
		for _, e := range includes {
			e = strings.ReplaceAll(e, "__comma@sep__", ",")
			tmp = append(tmp, e)
		}
		includes = tmp
		ret = append(ret, includes...)
		ret = gulu.Str.RemoveDuplicatedElem(ret)
	}

	if "" != strings.TrimSpace(Conf.Editor.VirtualBlockRefExclude) {
		exclude := strings.ReplaceAll(Conf.Editor.VirtualBlockRefExclude, "\\,", "__comma@sep__")
		excludes := strings.Split(exclude, ",")
		var tmp, regexps []string
		for _, e := range excludes {
			e = strings.ReplaceAll(e, "__comma@sep__", ",")
			if strings.HasPrefix(e, "/") && strings.HasSuffix(e, "/") {
				regexps = append(regexps, e[1:len(e)-1])
			} else {
				tmp = append(tmp, e)
			}
		}
		excludes = tmp
		ret = gulu.Str.ExcludeElem(ret, excludes)
		if 0 < len(regexps) {
			tmp = nil
			for _, str := range ret {
				for _, re := range regexps {
					if ok, regErr := regexp.MatchString(re, str); !ok && nil == regErr {
						tmp = append(tmp, str)
						break
					}
				}
			}
			ret = tmp
		}
	}

	// 虚拟引用排除当前文档名 https://github.com/siyuan-note/siyuan/issues/4537
	ret = gulu.Str.ExcludeElem(ret, []string{docName})
	ret = prepareMarkKeywords(ret)
	return
}

func prepareMarkKeywords(keywords []string) (ret []string) {
	ret = gulu.Str.RemoveDuplicatedElem(keywords)
	var tmp []string
	for _, k := range ret {
		if "" != k {
			tmp = append(tmp, k)
		}
	}
	ret = tmp

	sort.SliceStable(ret, func(i, j int) bool {
		return len(ret[i]) > len(ret[j])
	})
	return
}
