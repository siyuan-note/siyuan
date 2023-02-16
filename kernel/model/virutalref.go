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
	"bytes"
	"github.com/88250/gulu"
	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/dgraph-io/ristretto"
	"github.com/panjf2000/ants/v2"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/search"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"sync"
)

// virtualBlockRefCache 用于保存块关联的虚拟引用关键字。
// 改进打开虚拟引用后加载文档的性能 https://github.com/siyuan-note/siyuan/issues/7378
var virtualBlockRefCache, _ = ristretto.NewCache(&ristretto.Config{
	NumCounters: 1024000,
	MaxCost:     102400,
	BufferItems: 64,
})

func getBlockVirtualRefKeywords(root *ast.Node) (ret []string) {
	val, ok := virtualBlockRefCache.Get(root.ID)
	if !ok {
		treeTitle := root.IALAttr("title")
		buf := bytes.Buffer{}
		ast.Walk(root, func(n *ast.Node, entering bool) ast.WalkStatus {
			if !entering || !n.IsBlock() {
				return ast.WalkContinue
			}

			content := treenode.NodeStaticContent(n, nil)
			buf.WriteString(content)
			return ast.WalkContinue
		})
		content := buf.String()
		putBlockVirtualRefKeywords(content, root.ID, treeTitle)
		val, ok = virtualBlockRefCache.Get(root.ID)
		if !ok {
			return
		}
	}
	ret = val.([]string)
	return
}

func putBlockVirtualRefKeywords(blockContent, blockID, docTitle string) {
	keywords := getVirtualRefKeywords(docTitle)
	if 1 > len(keywords) {
		return
	}

	var hitKeywords []string
	contentTmp := blockContent
	if !Conf.Search.CaseSensitive {
		contentTmp = strings.ToLower(blockContent)
	}
	for _, keyword := range keywords {
		keywordTmp := keyword
		if !Conf.Search.CaseSensitive {
			keywordTmp = strings.ToLower(keyword)
		}

		if strings.Contains(contentTmp, keywordTmp) {
			hitKeywords = append(hitKeywords, keyword)
		}
	}

	if 1 > len(hitKeywords) {
		return
	}

	hitKeywords = gulu.Str.RemoveDuplicatedElem(hitKeywords)
	virtualBlockRefCache.Set(blockID, hitKeywords, 1)
}

func CacheVirtualBlockRefJob() {
	virtualBlockRefCache.Del("virtual_ref")

	if !Conf.Editor.VirtualBlockRef {
		return
	}

	keywords := sql.QueryVirtualRefKeywords(Conf.Search.VirtualRefName, Conf.Search.VirtualRefAlias, Conf.Search.VirtualRefAnchor, Conf.Search.VirtualRefDoc)
	virtualBlockRefCache.Set("virtual_ref", keywords, 1)

	boxes := Conf.GetOpenedBoxes()
	luteEngine := lute.New()
	for _, box := range boxes {
		boxPath := filepath.Join(util.DataDir, box.ID)
		var paths []string
		filepath.Walk(boxPath, func(path string, info os.FileInfo, err error) error {
			if boxPath == path {
				// 跳过根路径（笔记本文件夹）
				return nil
			}

			if info.IsDir() {
				if strings.HasPrefix(info.Name(), ".") {
					return filepath.SkipDir
				}
				return nil
			}

			if filepath.Ext(path) != ".sy" || strings.Contains(filepath.ToSlash(path), "/assets/") {
				return nil
			}

			p := path[len(boxPath):]
			p = filepath.ToSlash(p)
			paths = append(paths, p)
			return nil
		})

		poolSize := runtime.NumCPU()
		if 4 < poolSize {
			poolSize = 4
		}
		i := 0
		waitGroup := &sync.WaitGroup{}
		pool, _ := ants.NewPoolWithFunc(poolSize, func(arg interface{}) {
			defer waitGroup.Done()

			p := arg.(string)
			tree, loadErr := filesys.LoadTree(box.ID, p, luteEngine)
			if nil != loadErr {
				return
			}

			treeTitle := tree.Root.IALAttr("title")
			buf := bytes.Buffer{}
			ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
				if !entering || !n.IsBlock() {
					return ast.WalkContinue
				}

				content := treenode.NodeStaticContent(n, nil)
				buf.WriteString(content)
				return ast.WalkContinue
			})
			content := buf.String()
			putBlockVirtualRefKeywords(content, tree.ID, treeTitle)
			i++
			logging.LogInfof("cached virtual block ref for tree [%s, %d/%d]", tree.ID, i, len(paths))
		})
		for _, p := range paths {
			waitGroup.Add(1)
			pool.Invoke(p)
		}
		waitGroup.Wait()
		pool.Release()
	}
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

	// 在 设置 - 搜索 中分别增加虚拟引用和反链提及 `关键字数量限制` https://github.com/siyuan-note/siyuan/issues/6603
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
