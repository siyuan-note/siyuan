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

package model

import (
	"regexp"
	"sort"
	"strings"

	"github.com/88250/gulu"
	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func processVirtualRef(n *ast.Node, unlinks *[]*ast.Node, virtualBlockRefKeywords []string, refCount map[string]int, luteEngine *lute.Lute) bool {
	if !Conf.Editor.VirtualBlockRef || 1 > len(virtualBlockRefKeywords) {
		return false
	}

	if ast.NodeText != n.Type {
		return false
	}

	parentBlock := treenode.ParentBlock(n)
	if nil == parentBlock || 0 < refCount[parentBlock.ID] {
		return false
	}

	content := string(n.Tokens)
	newContent := markReplaceSpanWithSplit(content, virtualBlockRefKeywords, getMarkSpanStart(virtualBlockRefDataType), getMarkSpanEnd())
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
			keys := gulu.Str.SubstringsBetween(newContent, getMarkSpanStart(virtualBlockRefDataType), getMarkSpanEnd())
			for _, k := range keys {
				if gulu.Str.Contains(k, blockKeys) {
					return true
				}
			}
		}

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

	ret = sql.QueryVirtualRefKeywords(Conf.Search.VirtualRefName, Conf.Search.VirtualRefAlias, Conf.Search.VirtualRefAnchor, Conf.Search.VirtualRefDoc)
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

	if Conf.Search.VirtualRefKeywordsLimit < len(ret) {
		ret = ret[:Conf.Search.VirtualRefKeywordsLimit]
	}
	return
}

func prepareMarkKeywords(keywords []string) (ret []string) {
	ret = gulu.Str.RemoveDuplicatedElem(keywords)
	sort.SliceStable(ret, func(i, j int) bool {
		return len(ret[i]) > len(ret[j])
	})
	return
}
