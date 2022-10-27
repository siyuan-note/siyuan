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
	"sort"
	"strings"

	"github.com/88250/gulu"
	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/lex"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func processVirtualRef(n *ast.Node, unlinks *[]*ast.Node, virtualBlockRefKeywords []string, refCount map[string]int, luteEngine *lute.Lute) bool {
	if !Conf.Editor.VirtualBlockRef || 1 > len(virtualBlockRefKeywords) {
		return false
	}

	parentBlock := treenode.ParentBlock(n)
	if nil == parentBlock || 0 < refCount[parentBlock.ID] {
		return false
	}

	content := string(n.Tokens)
	newContent := markReplaceSpanWithSplit(content, virtualBlockRefKeywords, virtualBlockRefSpanStart, virtualBlockRefSpanEnd)
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
			keys := gulu.Str.SubstringsBetween(newContent, virtualBlockRefSpanStart, virtualBlockRefSpanEnd)
			for _, k := range keys {
				if gulu.Str.Contains(k, blockKeys) {
					return true
				}
			}
		}

		n.Tokens = []byte(newContent)
		n.Tokens = lex.EscapeMarkers(n.Tokens)
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
		var tmp []string
		for _, e := range excludes {
			e = strings.ReplaceAll(e, "__comma@sep__", ",")
			tmp = append(tmp, e)
		}
		excludes = tmp
		ret = gulu.Str.ExcludeElem(ret, excludes)
	}

	// 虚拟引用排除当前文档名 https://github.com/siyuan-note/siyuan/issues/4537
	ret = gulu.Str.ExcludeElem(ret, []string{docName})
	ret = prepareMarkKeywords(ret)
	return
}

func prepareMarkKeywords(keywords []string) (ret []string) {
	keywords = gulu.Str.RemoveDuplicatedElem(keywords)
	for _, k := range keywords {
		if strings.ContainsAny(k, "?*!@#$%^&()[]{}\\|;:'\",.<>~`") {
			continue
		}
		ret = append(ret, k)
	}

	sort.SliceStable(ret, func(i, j int) bool {
		return len(ret[i]) < len(ret[j])
	})
	return
}
