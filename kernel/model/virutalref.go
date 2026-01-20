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
	"github.com/88250/lute/editor"
	"github.com/88250/lute/parse"
	"github.com/ClarkThan/ahocorasick"
	"github.com/dgraph-io/ristretto"
	"github.com/siyuan-note/siyuan/kernel/search"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/task"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
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

			content := sql.NodeStaticContent(n, nil, false, false, false)
			content = strings.ReplaceAll(content, editor.Zwsp, "")
			buf.WriteString(content)
			return ast.WalkContinue
		})
		content := buf.String()
		ret = putBlockVirtualRefKeywords(content, root)
		return
	}
	ret = val.([]string)
	return
}

func putBlockVirtualRefKeywords(blockContent string, root *ast.Node) (ret []string) {
	keywords := getVirtualRefKeywords(root)
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
	virtualBlockRefCache.SetWithTTL(root.ID, ret, 1, 10*time.Minute)
	return
}

func CacheVirtualBlockRefJob() {
	if !Conf.Editor.VirtualBlockRef {
		return
	}
	task.AppendTask(task.CacheVirtualBlockRef, ResetVirtualBlockRefCache)
}

func ResetVirtualBlockRefCache() {
	virtualBlockRefCache.Clear()
	if !Conf.Editor.VirtualBlockRef {
		return
	}

	searchIgnoreLines := getSearchIgnoreLines()
	refSearchIgnoreLines := getRefSearchIgnoreLines()
	keywords := sql.QueryVirtualRefKeywords(Conf.Search.VirtualRefName, Conf.Search.VirtualRefAlias, Conf.Search.VirtualRefAnchor, Conf.Search.VirtualRefDoc, searchIgnoreLines, refSearchIgnoreLines)
	virtualBlockRefCache.Set("virtual_ref", keywords, 1)
}

// addNewKeywords 将新关键字添加到虚拟引用关键字列表中，如果不存在则追加，保留空白字符
func addNewKeywords(keywordsStr string, newKeywords []string) string {
	keywordsStr = strings.TrimSpace(keywordsStr)
	if 0 == len(newKeywords) {
		return keywordsStr
	}

	var builder strings.Builder
	if "" != keywordsStr {
		if !strings.HasSuffix(keywordsStr, "\\,") {
			keywordsStr = strings.TrimSuffix(keywordsStr, ",")
		}
		builder.WriteString(keywordsStr)
		builder.WriteString(",")
	}

	keywords := gulu.Str.RemoveDuplicatedElem(parseKeywords(keywordsStr))
	newKeywords = gulu.Str.RemoveDuplicatedElem(newKeywords)
	allKeys := make(map[string]bool)

	// 添加新关键字
	for _, keyword := range newKeywords {
		keywordTrimmed := strings.TrimSpace(keyword)
		if "" == keywordTrimmed {
			continue
		}
		if gulu.Str.Contains(keywordTrimmed, keywords) {
			// 剔除已存在的关键字
			continue
		}
		if _, value := allKeys[keywordTrimmed]; value {
			// 剔除重复的关键字
			continue
		}
		allKeys[keywordTrimmed] = true
		builder.WriteString(strings.ReplaceAll(keyword, ",", "\\,")) // 字符串切片转换为字符串，需要转义逗号
		builder.WriteString(",")
	}

	return strings.TrimSuffix(builder.String(), ",")
}

func AddVirtualBlockRefInclude(keyword []string) {
	if 1 > len(keyword) {
		return
	}
	Conf.Editor.VirtualBlockRefInclude = addNewKeywords(Conf.Editor.VirtualBlockRefInclude, keyword)
	Conf.Save()
	ResetVirtualBlockRefCache()
}

func AddVirtualBlockRefExclude(keyword []string) {
	if 1 > len(keyword) {
		return
	}
	Conf.Editor.VirtualBlockRefExclude = addNewKeywords(Conf.Editor.VirtualBlockRefExclude, keyword)
	Conf.Save()
	ResetVirtualBlockRefCache()
}

func processVirtualRef(n *ast.Node, unlinks *[]*ast.Node, virtualBlockRefKeywords []string, refCount map[string]int, luteEngine *lute.Lute) bool {
	if !Conf.Editor.VirtualBlockRef || 1 > len(virtualBlockRefKeywords) {
		return false
	}

	if ast.NodeText != n.Type {
		return false
	}

	parentBlock := treenode.ParentBlock(n)
	if nil == parentBlock {
		return false
	}

	if 0 < refCount[parentBlock.ID] {
		// 如果块被引用过，则将其自身的文本排除在虚拟引用关键字之外
		// Referenced blocks support rendering virtual references https://github.com/siyuan-note/siyuan/issues/10960
		parentText := getNodeRefText(parentBlock)
		virtualBlockRefKeywords = gulu.Str.RemoveElem(virtualBlockRefKeywords, parentText)
	}

	content := string(n.Tokens)
	tmp := util.RemoveInvalid(content)
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

// parseKeywords 将字符串转换为关键字切片，并剔除前后的空白字符
func parseKeywords(keywordsStr string) (keywords []string) {
	keywords = []string{}
	keywordsStr = strings.TrimSpace(keywordsStr)
	if "" == keywordsStr {
		return
	}
	// 先处理转义的逗号
	keywordsStr = strings.ReplaceAll(keywordsStr, "\\,", "__comma@sep__")
	// 再将连续或单个换行符替换为一个逗号，避免把 `\\\n` 转换为 `\,`
	keywordsStr = util.ReplaceNewline(keywordsStr, ",")
	// 按逗号分隔
	for part := range strings.SplitSeq(keywordsStr, ",") {
		part = strings.TrimSpace(part) // 剔除前后的空白字符
		if "" == part {
			continue
		}
		// 恢复转义的逗号
		part = strings.ReplaceAll(part, "__comma@sep__", ",")
		keywords = append(keywords, part)
	}
	return
}

func getVirtualRefKeywords(root *ast.Node) (ret []string) {
	if !Conf.Editor.VirtualBlockRef {
		return
	}

	if val, ok := virtualBlockRefCache.Get("virtual_ref"); ok {
		ret = val.([]string)
	}

	includes := parseKeywords(Conf.Editor.VirtualBlockRefInclude)
	if 0 < len(includes) {
		ret = append(ret, includes...)
		ret = gulu.Str.RemoveDuplicatedElem(ret)
	}

	excludes := parseKeywords(Conf.Editor.VirtualBlockRefExclude)
	if 0 < len(excludes) {
		var tmp, regexps []string
		for _, e := range excludes {
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
				matchExclude := false
				for _, re := range regexps {
					if ok, _ := regexp.MatchString(re, str); ok {
						matchExclude = true
						break
					}
				}
				if !matchExclude {
					tmp = append(tmp, str)
				}
			}
			ret = tmp
		}
	}

	// 虚拟引用排除当前文档名 https://github.com/siyuan-note/siyuan/issues/4537
	// Virtual references exclude the name and aliases from the current document https://github.com/siyuan-note/siyuan/issues/9204
	title := root.IALAttr("title")
	ret = gulu.Str.ExcludeElem(ret, []string{title})
	if name := root.IALAttr("name"); "" != name {
		ret = gulu.Str.ExcludeElem(ret, []string{name})
	}
	if alias := root.IALAttr("alias"); "" != alias {
		for _, a := range strings.Split(alias, ",") {
			ret = gulu.Str.ExcludeElem(ret, []string{a})
		}
	}

	ret = prepareMarkKeywords(ret)
	return
}

func prepareMarkKeywords(keywords []string) (ret []string) {
	ret = gulu.Str.RemoveDuplicatedElem(keywords)
	var tmp []string
	for _, k := range ret {
		if "" != k && "*" != k { // 提及和虚引排除 * Ignore `*` back mentions and virtual references https://github.com/siyuan-note/siyuan/issues/10873
			tmp = append(tmp, k)
		}
	}
	ret = tmp

	sort.SliceStable(ret, func(i, j int) bool {
		return len(ret[i]) > len(ret[j])
	})
	return
}
