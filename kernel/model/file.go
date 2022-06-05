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
	"errors"
	"fmt"
	"io/fs"
	"math"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/html"
	"github.com/88250/lute/parse"
	util2 "github.com/88250/lute/util"
	"github.com/88250/protyle"
	"github.com/dustin/go-humanize"
	"github.com/facette/natsort"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/search"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type File struct {
	Path         string `json:"path"`
	Name         string `json:"name"`
	Icon         string `json:"icon"`
	Name1        string `json:"name1"`
	Alias        string `json:"alias"`
	Memo         string `json:"memo"`
	Bookmark     string `json:"bookmark"`
	ID           string `json:"id"`
	Count        int    `json:"count"`
	Size         uint64 `json:"size"`
	HSize        string `json:"hSize"`
	Mtime        int64  `json:"mtime"`
	CTime        int64  `json:"ctime"`
	HMtime       string `json:"hMtime"`
	HCtime       string `json:"hCtime"`
	Sort         int    `json:"sort"`
	SubFileCount int    `json:"subFileCount"`
}

func (box *Box) docFromFileInfo(fileInfo *FileInfo, ial map[string]string) (ret *File) {
	ret = &File{}
	ret.Path = fileInfo.path
	ret.Size = uint64(fileInfo.size)
	ret.Name = ial["title"] + ".sy"
	ret.Icon = ial["icon"]
	ret.ID = ial["id"]
	ret.Name1 = ial["name"]
	ret.Alias = ial["alias"]
	ret.Memo = ial["memo"]
	ret.Bookmark = ial["bookmark"]
	t, _ := time.ParseInLocation("20060102150405", ret.ID[:14], time.Local)
	ret.CTime = t.Unix()
	ret.HCtime = t.Format("2006-01-02 15:04:05")
	ret.HSize = humanize.Bytes(ret.Size)

	mTime := t
	if updated := ial["updated"]; "" != updated {
		if updatedTime, err := time.ParseInLocation("20060102150405", updated, time.Local); nil == err {
			mTime = updatedTime
		}
	}

	ret.Mtime = mTime.Unix()
	ret.HMtime = HumanizeTime(mTime)
	return
}

func HumanizeTime(then time.Time) string {
	labels := timeLangs[Conf.Lang]

	defaultMagnitudes := []humanize.RelTimeMagnitude{
		{time.Second, labels["now"].(string), time.Second},
		{2 * time.Second, labels["1s"].(string), 1},
		{time.Minute, labels["xs"].(string), time.Second},
		{2 * time.Minute, labels["1m"].(string), 1},
		{time.Hour, labels["xm"].(string), time.Minute},
		{2 * time.Hour, labels["1h"].(string), 1},
		{humanize.Day, labels["xh"].(string), time.Hour},
		{2 * humanize.Day, labels["1d"].(string), 1},
		{humanize.Week, labels["xd"].(string), humanize.Day},
		{2 * humanize.Week, labels["1w"].(string), 1},
		{humanize.Month, labels["xw"].(string), humanize.Week},
		{2 * humanize.Month, labels["1M"].(string), 1},
		{humanize.Year, labels["xM"].(string), humanize.Month},
		{18 * humanize.Month, labels["1y"].(string), 1},
		{2 * humanize.Year, labels["2y"].(string), 1},
		{humanize.LongTime, labels["xy"].(string), humanize.Year},
		{math.MaxInt64, labels["max"].(string), 1},
	}
	return humanize.CustomRelTime(then, time.Now(), labels["albl"].(string), labels["blbl"].(string), defaultMagnitudes)
}

func (box *Box) docIAL(p string) (ret map[string]string) {
	name := strings.ToLower(filepath.Base(p))
	if !strings.HasSuffix(name, ".sy") {
		return nil
	}

	ret = cache.GetDocIAL(p)
	if nil != ret {
		return ret
	}

	filePath := filepath.Join(util.DataDir, box.ID, p)

	data, err := filesys.NoLockFileRead(filePath)
	if util.IsCorruptedSYData(data) {
		filesys.UnlockFile(filePath)
		if removeErr := os.RemoveAll(filePath); nil == removeErr {
			util.LogInfof("removed corrupted data file [path=%s, length=%d]", filePath, len(data))
		} else {
			util.LogWarnf("remove corrupted data file [path=%s, length=%d] failed: %s", filePath, len(data), removeErr)
		}
		return nil
	}
	if nil != err {
		util.LogErrorf("read file [%s] failed: %s", p, err)
		return nil
	}
	ret = readDocIAL(data)
	if nil == ret {
		util.LogWarnf("tree [%s] is corrupted", filePath)
		return nil
	}
	cache.PutDocIAL(p, ret)
	return ret
}

func readDocIAL(data []byte) (ret map[string]string) {
	doc := map[string]interface{}{}
	if err := gulu.JSON.UnmarshalJSON(data, &doc); nil != err {
		util.LogErrorf("unmarshal data failed: %s", err)
		return nil
	}

	props := doc["Properties"].(map[string]interface{})
	ret = map[string]string{}
	for k, v := range props {
		ret[k] = v.(string)
	}
	return
}

func SearchDocsByKeyword(keyword string) (ret []map[string]string) {
	ret = []map[string]string{}

	openedBoxes := Conf.GetOpenedBoxes()
	boxes := map[string]*Box{}
	for _, box := range openedBoxes {
		boxes[box.ID] = box
	}

	var rootBlocks []*sql.Block
	if "" != keyword {
		for _, box := range boxes {
			if strings.Contains(box.Name, keyword) {
				ret = append(ret, map[string]string{"path": "/", "hPath": box.Name + "/", "box": box.ID, "boxIcon": box.Icon})
			}
		}

		condition := "hpath LIKE '%" + keyword + "%'"
		if "" != keyword {
			namCondition := Conf.Search.NAMFilter(keyword)
			if "" != namCondition {
				condition += " " + namCondition
			}
		}
		rootBlocks = sql.QueryRootBlockByCondition(condition)
	} else {
		for _, box := range boxes {
			ret = append(ret, map[string]string{"path": "/", "hPath": box.Name + "/", "box": box.ID, "boxIcon": box.Icon})
		}
	}

	for _, block := range rootBlocks {
		b := boxes[block.Box]
		if nil == b {
			continue
		}
		hPath := b.Name + block.HPath
		ret = append(ret, map[string]string{"path": block.Path, "hPath": hPath, "box": block.Box, "boxIcon": b.Icon})
	}

	sort.Slice(ret, func(i, j int) bool {
		return ret[i]["hPath"] < ret[j]["hPath"]
	})
	return
}

type FileInfo struct {
	path  string
	name  string
	size  int64
	isdir bool
}

func ListDocTree(boxID, path string, sortMode int) (ret []*File, totals int, err error) {
	ret = []*File{}

	box := Conf.Box(boxID)
	if nil == box {
		return nil, 0, errors.New(Conf.Language(0))
	}

	var files []*FileInfo
	start := time.Now()
	files, totals, err = box.Ls(path)
	if nil != err {
		return
	}
	elapsed := time.Now().Sub(start).Milliseconds()
	if 100 < elapsed {
		util.LogWarnf("ls elapsed [%dms]", elapsed)
	}

	start = time.Now()
	boxLocalPath := filepath.Join(util.DataDir, box.ID)
	var docs []*File
	for _, file := range files {
		if file.isdir {
			if !util.IsIDPattern(file.name) {
				continue
			}

			parentDocPath := strings.TrimSuffix(file.path, "/") + ".sy"
			subDocFile := box.Stat(parentDocPath)
			if nil == subDocFile {
				continue
			}
			if ial := box.docIAL(parentDocPath); nil != ial {
				doc := box.docFromFileInfo(subDocFile, ial)
				subFiles, err := os.ReadDir(filepath.Join(boxLocalPath, file.path))
				if nil == err {
					for _, subFile := range subFiles {
						if strings.HasSuffix(subFile.Name(), ".sy") {
							doc.SubFileCount++
						}
					}
				}
				docs = append(docs, doc)
			}
			continue
		}

		subFolder := filepath.Join(boxLocalPath, strings.TrimSuffix(file.path, ".sy"))
		if gulu.File.IsDir(subFolder) {
			continue
		}

		if ial := box.docIAL(file.path); nil != ial {
			doc := box.docFromFileInfo(file, ial)
			docs = append(docs, doc)
			continue
		}
	}
	elapsed = time.Now().Sub(start).Milliseconds()
	if 500 < elapsed {
		util.LogWarnf("build docs elapsed [%dms]", elapsed)
	}

	start = time.Now()
	refCount := sql.QueryRootBlockRefCount()
	for _, doc := range docs {
		if count := refCount[doc.ID]; 0 < count {
			doc.Count = count
		}
	}
	elapsed = time.Now().Sub(start).Milliseconds()
	if 500 < elapsed {
		util.LogWarnf("query root block ref count elapsed [%dms]", elapsed)
	}

	start = time.Now()
	switch sortMode {
	case util.SortModeNameASC:
		sort.Slice(docs, func(i, j int) bool {
			return util.PinYinCompare(util.RemoveEmoji(docs[i].Name), util.RemoveEmoji(docs[j].Name))
		})
	case util.SortModeNameDESC:
		sort.Slice(docs, func(i, j int) bool {
			return util.PinYinCompare(util.RemoveEmoji(docs[j].Name), util.RemoveEmoji(docs[i].Name))
		})
	case util.SortModeUpdatedASC:
		sort.Slice(docs, func(i, j int) bool { return docs[i].Mtime < docs[j].Mtime })
	case util.SortModeUpdatedDESC:
		sort.Slice(docs, func(i, j int) bool { return docs[i].Mtime > docs[j].Mtime })
	case util.SortModeAlphanumASC:
		sort.Slice(docs, func(i, j int) bool {
			return natsort.Compare(util.RemoveEmoji(docs[i].Name), util.RemoveEmoji(docs[j].Name))
		})
	case util.SortModeAlphanumDESC:
		sort.Slice(docs, func(i, j int) bool {
			return natsort.Compare(util.RemoveEmoji(docs[j].Name), util.RemoveEmoji(docs[i].Name))
		})
	case util.SortModeCustom:
		fileTreeFiles := docs
		box.fillSort(&fileTreeFiles)
		sort.Slice(fileTreeFiles, func(i, j int) bool {
			if fileTreeFiles[i].Sort == fileTreeFiles[j].Sort {
				return util.TimeFromID(fileTreeFiles[i].ID) > util.TimeFromID(fileTreeFiles[j].ID)
			}
			return fileTreeFiles[i].Sort < fileTreeFiles[j].Sort
		})
		ret = append(ret, fileTreeFiles...)
		if Conf.FileTree.MaxListCount < len(ret) {
			ret = ret[:Conf.FileTree.MaxListCount]
		}
		ret = ret[:]
		return
	case util.SortModeRefCountASC:
		sort.Slice(docs, func(i, j int) bool { return docs[i].Count < docs[j].Count })
	case util.SortModeRefCountDESC:
		sort.Slice(docs, func(i, j int) bool { return docs[i].Count > docs[j].Count })
	case util.SortModeCreatedASC:
		sort.Slice(docs, func(i, j int) bool { return docs[i].CTime < docs[j].CTime })
	case util.SortModeCreatedDESC:
		sort.Slice(docs, func(i, j int) bool { return docs[i].CTime > docs[j].CTime })
	}

	if util.SortModeCustom != sortMode {
		ret = append(ret, docs...)
	}

	if Conf.FileTree.MaxListCount < len(ret) {
		ret = ret[:Conf.FileTree.MaxListCount]
	}
	ret = ret[:]

	elapsed = time.Now().Sub(start).Milliseconds()
	if 200 < elapsed {
		util.LogInfof("sort docs elapsed [%dms]", elapsed)
	}
	return
}

func BlockWordCount(id string) (blockRuneCount, blockWordCount, rootBlockRuneCount, rootBlockWordCount int) {
	tree, _ := loadTreeByBlockID(id)
	if nil == tree {
		return
	}

	node := treenode.GetNodeInTree(tree, id)
	blockRuneCount, blockWordCount = node.ContentLen()
	if ast.NodeHeading == node.Type {
		level := node.HeadingLevel
		for n := node.Next; nil != n; n = n.Next {
			if ast.NodeHeading == n.Type && n.HeadingLevel <= level {
				break
			}
			rc, wc := n.ContentLen()
			blockRuneCount += rc
			blockWordCount += wc
		}
	}
	rootBlockRuneCount, rootBlockWordCount = tree.Root.ContentLen()
	return
}

func GetDoc(id string, index int, keyword string, mode int, size int) (blockCount int, dom, parentID, parent2ID, rootID, typ string, eof bool, boxID, docPath string, err error) {
	WaitForWritingFiles() // 写入数据时阻塞，避免获取到的数据不一致

	inputIndex := index
	tree, err := loadTreeByBlockID(id)
	if nil != err {
		if ErrBlockNotFound == err {
			if 0 == mode {
				err = ErrTreeNotFound // 初始化打开文档时如果找不到则关闭编辑器
			}
		}
		return
	}
	if nil == tree {
		err = ErrBlockNotFound
		return
	}

	luteEngine := NewLute()
	node := treenode.GetNodeInTree(tree, id)
	if nil == node {
		err = ErrBlockNotFound
		return
	}

	located := false
	isDoc := ast.NodeDocument == node.Type
	isHeading := ast.NodeHeading == node.Type
	boxID = node.Box
	docPath = node.Path
	if isDoc {
		if 4 == mode { // 加载文档末尾
			node = node.LastChild
			located = true
			// 重新计算 index
			ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
				if !entering {
					return ast.WalkContinue
				}

				index++
				return ast.WalkContinue
			})
		} else {
			node = node.FirstChild
		}
		typ = ast.NodeDocument.String()
		idx := 0
		if 0 < index {
			ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
				if !entering || !n.IsChildBlockOf(tree.Root, 1) {
					return ast.WalkContinue
				}

				idx++
				if index == idx {
					node = n.DocChild()
					if "1" == node.IALAttr("heading-fold") {
						// 加载到折叠标题下方块的话需要回溯到上方标题块
						for h := node.Previous; nil != h; h = h.Previous {
							if "1" == h.IALAttr("fold") {
								node = h
								break
							}
						}
					}
					located = true
					return ast.WalkStop
				}
				return ast.WalkContinue
			})
		}
	} else {
		if 0 == index && 0 != mode {
			// 非文档且没有指定 index 时需要计算 index
			ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
				if !entering {
					return ast.WalkContinue
				}

				index++
				if id == n.ID {
					node = n.DocChild()
					located = true
					return ast.WalkStop
				}
				return ast.WalkContinue
			})
		}
	}

	if 1 < index && !located {
		count := 0
		ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
			if !entering {
				return ast.WalkContinue
			}

			count++
			if index == count {
				node = n.DocChild()
				return ast.WalkStop
			}
			return ast.WalkContinue
		})
	}

	blockCount = tree.DocBlockCount()
	if ast.NodeDocument == node.Type {
		parentID = node.ID
		parent2ID = parentID
	} else {
		parentID = node.Parent.ID
		parent2ID = parentID
		tmp := node
		if ast.NodeListItem == node.Type {
			// 列表项聚焦返回和面包屑保持一致 https://github.com/siyuan-note/siyuan/issues/4914
			tmp = node.Parent
		}
		if headingParent := treenode.HeadingParent(tmp); nil != headingParent {
			parent2ID = headingParent.ID
		}
	}
	rootID = tree.Root.ID
	if !isDoc {
		typ = node.Type.String()
	}

	nodes, eof := loadNodesByMode(node, inputIndex, mode, size, isDoc, isHeading)
	refCount := sql.QueryRootChildrenRefCount(rootID)

	var virtualBlockRefKeywords []string
	var refKeywordReplacer *strings.Replacer
	if Conf.Editor.VirtualBlockRef {
		virtualBlockRefKeywords = sql.QueryVirtualRefKeywords(Conf.Search.VirtualRefName, Conf.Search.VirtualRefAlias, Conf.Search.VirtualRefAnchor, Conf.Search.VirtualRefDoc)
		if "" != strings.TrimSpace(Conf.Editor.VirtualBlockRefExclude) {
			exclude := strings.ReplaceAll(Conf.Editor.VirtualBlockRefExclude, "\\,", "__comma@sep__")
			excludes := strings.Split(exclude, ",")
			var tmp []string
			for _, e := range excludes {
				e = strings.ReplaceAll(e, "__comma@sep__", ",")
				tmp = append(tmp, e)
			}
			excludes = tmp
			virtualBlockRefKeywords = util.ExcludeElem(virtualBlockRefKeywords, excludes)
		}

		// 虚拟引用排除当前文档名 https://github.com/siyuan-note/siyuan/issues/4537
		virtualBlockRefKeywords = util.ExcludeElem(virtualBlockRefKeywords, []string{tree.Root.IALAttr("title")})

		if 0 < len(virtualBlockRefKeywords) {
			var tmp []string
			for _, k := range virtualBlockRefKeywords {
				repl := "<span data-type=\"virtual-block-ref\">" + k + "</span>"
				if util.IsASCII(k) {
					tmp = append(tmp, " "+k, " "+repl)
					tmp = append(tmp, " "+k+" ", " "+repl+" ")
					tmp = append(tmp, k+" ", repl+" ")
					continue
				}
				tmp = append(tmp, k, repl)
			}
			refKeywordReplacer = strings.NewReplacer(tmp...)
		}
	}

	subTree := &parse.Tree{Root: &ast.Node{Type: ast.NodeDocument}, Marks: tree.Marks}
	keyword = strings.Join(strings.Split(keyword, " "), search.TermSep)
	keywords := search.SplitKeyword(keyword)

	for _, n := range nodes {
		var unlinks []*ast.Node
		ast.Walk(n, func(n *ast.Node, entering bool) ast.WalkStatus {
			if !entering {
				return ast.WalkContinue
			}

			if "1" == n.IALAttr("heading-fold") {
				unlinks = append(unlinks, n)
				return ast.WalkContinue
			}

			if "" != n.ID {
				// 填充块引计数
				if cnt := refCount[n.ID]; 0 < cnt {
					n.SetIALAttr("refcount", strconv.Itoa(cnt))
				}
			}

			if ast.NodeBlockRef == n.Type {
				appendRefTextRenderResultForBlockRef(n)
				return ast.WalkSkipChildren
			}

			if ast.NodeText == n.Type {
				if 0 < len(keywords) {
					// 搜索高亮
					text := string(n.Tokens)
					text = search.EncloseHighlighting(text, keywords, "<span data-type=\"search-mark\">", "</span>", Conf.Search.CaseSensitive)
					n.Tokens = gulu.Str.ToBytes(text)
					if bytes.Contains(n.Tokens, []byte("search-mark")) {
						n.Tokens = bytes.ReplaceAll(n.Tokens, []byte("\\<span data-type=\"search-mark\">"), []byte("\\\\<span data-type=\"search-mark\">"))
						linkTree := parse.Inline("", n.Tokens, luteEngine.ParseOptions)
						var children []*ast.Node
						for c := linkTree.Root.FirstChild.FirstChild; nil != c; c = c.Next {
							children = append(children, c)
						}
						for _, c := range children {
							n.InsertBefore(c)
						}
						unlinks = append(unlinks, n)
						return ast.WalkContinue
					}
				}

				// 虚拟引用
				if Conf.Editor.VirtualBlockRef && nil != refKeywordReplacer {
					parentBlock := treenode.ParentBlock(n)
					if nil != parentBlock && 1 > refCount[parentBlock.ID] {
						content := string(n.Tokens)
						newContent := refKeywordReplacer.Replace(content)
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
								keys := util.SubstringsBetween(newContent, "<span data-type=\"virtual-block-ref\">", "</span>")
								for _, k := range keys {
									if gulu.Str.Contains(k, blockKeys) {
										return ast.WalkContinue
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
							unlinks = append(unlinks, n)
							return ast.WalkContinue
						}
					}
				}
			}
			return ast.WalkContinue
		})

		for _, unlink := range unlinks {
			unlink.Unlink()
		}

		subTree.Root.AppendChild(n)
	}

	luteEngine.RenderOptions.NodeIndexStart = index
	dom = luteEngine.Tree2BlockDOM(subTree, luteEngine.RenderOptions)
	return
}

func loadNodesByMode(node *ast.Node, inputIndex, mode, size int, isDoc, isHeading bool) (nodes []*ast.Node, eof bool) {
	if 2 == mode { // 向下
		next := node.Next
		if ast.NodeHeading == node.Type {
			// 标题展开时进行动态加载导致重复内容 https://github.com/siyuan-note/siyuan/issues/4671
			// 这里要考虑折叠标题是最后一个块的情况
			if children := treenode.FoldedHeadingChildren(node); 0 < len(children) {
				next = children[len(children)-1].Next
			}
		}
		if nil == next {
			eof = true
		} else {
			eof = util2.IsDocIAL(node.Tokens) || util2.IsDocIAL(next.Tokens)
		}
	}

	count := 0
	switch mode {
	case 0: // 仅加载当前 ID
		nodes = append(nodes, node)
		if isDoc {
			for n := node.Next; nil != n; n = n.Next {
				if "1" == n.IALAttr("heading-fold") {
					continue
				}
				nodes = append(nodes, n)
				if 1 > count {
					count++
				} else {
					count += treenode.CountBlockNodes(n)
				}
				if size < count {
					break
				}
			}
		} else if isHeading {
			level := node.HeadingLevel
			for n := node.Next; nil != n; n = n.Next {
				if "1" == n.IALAttr("heading-fold") && ("1" == node.IALAttr("fold") && 0 == mode) {
					// 从大纲跳转折叠标题的下方标题时需要判断跳转的标题是否是折叠 https://github.com/siyuan-note/siyuan/issues/4920
					continue
				}
				if ast.NodeHeading == n.Type {
					if n.HeadingLevel <= level {
						break
					}
				} else if ast.NodeSuperBlock == n.Type {
					if h := treenode.SuperBlockHeading(n); nil != h {
						if level >= h.HeadingLevel {
							break
						}
					}
				}
				nodes = append(nodes, n)
				count++
				if size < count {
					break
				}
			}
		}
	case 4: // Ctrl+End 跳转到末尾后向上加载
		for n := node; nil != n; n = n.Previous {
			if "1" == n.IALAttr("heading-fold") {
				continue
			}
			nodes = append([]*ast.Node{n}, nodes...)
			if 1 > count {
				count++
			} else {
				count += treenode.CountBlockNodes(n)
			}
			if size < count {
				break
			}
		}
		eof = true
	case 1: // 向上加载
		for n := node.Previous; /* 从上一个节点开始加载 */ nil != n; n = n.Previous {
			if "1" == n.IALAttr("heading-fold") {
				continue
			}
			nodes = append([]*ast.Node{n}, nodes...)
			if 1 > count {
				count++
			} else {
				count += treenode.CountBlockNodes(n)
			}
			if size < count {
				break
			}
		}
		eof = nil == node.Previous
	case 2: // 向下加载
		for n := node.Next; /* 从下一个节点开始加载 */ nil != n; n = n.Next {
			if "1" == n.IALAttr("heading-fold") {
				continue
			}
			nodes = append(nodes, n)
			if 1 > count {
				count++
			} else {
				count += treenode.CountBlockNodes(n)
			}
			if size < count {
				break
			}
		}
	case 3: // 上下都加载
		for n := node; nil != n; n = n.Previous {
			if "1" == n.IALAttr("heading-fold") {
				continue
			}
			nodes = append([]*ast.Node{n}, nodes...)
			if 1 > count {
				count++
			} else {
				count += treenode.CountBlockNodes(n)
			}
			if 0 < inputIndex {
				if 1 < count {
					break // 滑块指示器加载
				}
			} else {
				if size < count {
					break
				}
			}
		}
		if size/2 < count {
			size = size / 2
		} else {
			size = size - count
		}
		count = 0
		for n := node.Next; nil != n; n = n.Next {
			if "1" == n.IALAttr("heading-fold") {
				continue
			}
			nodes = append(nodes, n)
			if 1 > count {
				count++
			} else {
				count += treenode.CountBlockNodes(n)
			}
			if 0 < inputIndex {
				if size < count {
					break
				}
			} else {
				if size < count {
					break
				}
			}
		}
	}
	return
}

func writeJSONQueue(tree *parse.Tree) (err error) {
	if err = filesys.WriteTree(tree); nil != err {
		return
	}
	sql.UpsertTreeQueue(tree)
	return
}

func indexWriteJSONQueue(tree *parse.Tree) (err error) {
	treenode.ReindexBlockTree(tree)
	return writeJSONQueue(tree)
}

func renameWriteJSONQueue(tree *parse.Tree, oldHPath string) (err error) {
	if err = filesys.WriteTree(tree); nil != err {
		return
	}
	sql.RenameTreeQueue(tree, oldHPath)
	treenode.ReindexBlockTree(tree)
	return
}

func DuplicateDoc(rootID string) (err error) {
	msgId := util.PushMsg(Conf.Language(116), 30000)
	defer util.PushClearMsg(msgId)

	WaitForWritingFiles()
	tree, err := loadTreeByBlockID(rootID)
	if nil != err {
		return
	}

	tree.ID = ast.NewNodeID()
	tree.Root.ID = tree.ID
	titleSuffix := "Duplicated"
	if t, parseErr := time.Parse("20060102150405", util.TimeFromID(tree.ID)); nil == parseErr {
		titleSuffix = t.Format("2006-01-02 15:04:05")
	}
	tree.Root.SetIALAttr("id", tree.ID)
	tree.Root.SetIALAttr("title", tree.Root.IALAttr("title")+" "+titleSuffix)
	p := path.Join(path.Dir(tree.Path), tree.ID) + ".sy"
	tree.Path = p
	tree.HPath = tree.HPath + " " + titleSuffix
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering || ast.NodeDocument == n.Type {
			return ast.WalkContinue
		}
		if n.IsBlock() && "" != n.ID {
			n.ID = ast.NewNodeID()
			n.SetIALAttr("id", n.ID)
		}
		return ast.WalkContinue
	})

	transaction := &Transaction{DoOperations: []*Operation{{Action: "create", Data: tree}}}
	err = PerformTransactions(&[]*Transaction{transaction})
	if nil != err {
		tx, txErr := sql.BeginTx()
		if nil != txErr {
			util.LogFatalf("transaction failed: %s", txErr)
			return
		}
		sql.ClearBoxHash(tx)
		sql.CommitTx(tx)
		util.LogFatalf("transaction failed: %s", err)
		return
	}
	sql.WaitForWritingDatabase()
	return
}

func CreateDocByMd(boxID, p, title, md string) (err error) {
	WaitForWritingFiles()

	box := Conf.Box(boxID)
	if nil == box {
		return errors.New(Conf.Language(0))
	}

	luteEngine := NewLute()
	dom := luteEngine.Md2BlockDOM(md)
	return createDoc(box.ID, p, title, dom)
}

func CreateWithMarkdown(boxID, hPath, md string) (id string, err error) {
	box := Conf.Box(boxID)
	if nil == box {
		err = errors.New(Conf.Language(0))
		return
	}

	WaitForWritingFiles()
	luteEngine := NewLute()
	dom := luteEngine.Md2BlockDOM(md)
	id, err = createDocsByHPath(box.ID, hPath, dom)
	return
}

func GetHPathByPath(boxID, p string) (hPath string, err error) {
	if "/" == p {
		hPath = "/"
		return
	}

	tree, err := LoadTree(boxID, p)
	if nil != err {
		return
	}
	hPath = tree.HPath
	return
}

func GetHPathByID(id string) (hPath string, err error) {
	tree, err := loadTreeByBlockID(id)
	if nil != err {
		return
	}
	hPath = tree.HPath
	return
}

func GetFullHPathByID(id string) (hPath string, err error) {
	tree, err := loadTreeByBlockID(id)
	if nil != err {
		return
	}

	box := Conf.Box(tree.Box)
	var boxName string
	if nil != box {
		boxName = box.Name
	}
	hPath = boxName + tree.HPath
	return
}

func MoveDoc(fromBoxID, fromPath, toBoxID, toPath string) (newPath string, err error) {
	if fromBoxID == toBoxID && fromPath == toPath {
		return
	}

	if depth := strings.Count(toPath, "/"); 6 < depth && !Conf.FileTree.AllowCreateDeeper {
		err = errors.New(Conf.Language(118))
		return
	}

	fromDir := strings.TrimSuffix(fromPath, ".sy")
	if strings.HasPrefix(toPath, fromDir) {
		err = errors.New(Conf.Language(87))
		return
	}

	fromBox := Conf.Box(fromBoxID)
	if nil == fromBox {
		err = errors.New(Conf.Language(0))
		return
	}

	WaitForWritingFiles()
	writingDataLock.Lock()
	defer writingDataLock.Unlock()

	tree, err := LoadTree(fromBoxID, fromPath)
	if nil != err {
		err = ErrBlockNotFound
		return
	}

	toBox := Conf.Box(toBoxID)
	if nil == toBox {
		err = errors.New(Conf.Language(0))
		return
	}
	isSameBox := fromBoxID == toBoxID

	if isSameBox {
		if !fromBox.Exist(toPath) {
			err = ErrBlockNotFound
			return
		}
	} else {
		if !toBox.Exist(toPath) {
			err = ErrBlockNotFound
			return
		}
	}

	moveToRoot := "/" == toPath
	toBlockID := tree.ID
	fromFolder := path.Join(path.Dir(fromPath), tree.ID)
	toFolder := "/"
	if !moveToRoot {
		var toTree *parse.Tree
		if isSameBox {
			toTree, err = LoadTree(fromBoxID, toPath)
		} else {
			toTree, err = LoadTree(toBoxID, toPath)
		}
		if nil != err {
			err = ErrBlockNotFound
			return
		}

		toBlockID = toTree.ID
		toFolder = path.Join(path.Dir(toPath), toBlockID)
	}

	if isSameBox {
		if err = fromBox.MkdirAll(toFolder); nil != err {
			return
		}
	} else {
		if err = toBox.MkdirAll(toFolder); nil != err {
			return
		}
	}

	if fromBox.Exist(fromFolder) {
		// 移动子文档文件夹

		newFolder := path.Join(toFolder, tree.ID)
		if isSameBox {
			if err = fromBox.Move(fromFolder, newFolder); nil != err {
				return
			}
		} else {
			absFromPath := filepath.Join(util.DataDir, fromBoxID, fromFolder)
			absToPath := filepath.Join(util.DataDir, toBoxID, newFolder)
			filesys.ReleaseFileLocks(absFromPath)
			if gulu.File.IsExist(absToPath) {
				filesys.ReleaseFileLocks(absToPath)
				os.RemoveAll(absToPath)
			}
			if err = os.Rename(absFromPath, absToPath); nil != err {
				msg := fmt.Sprintf(Conf.Language(5), fromBox.Name, fromPath, err)
				util.LogErrorf("move [path=%s] in box [%s] failed: %s", fromPath, fromBoxID, err)
				err = errors.New(msg)
				return
			}
		}
	}

	newPath = path.Join(toFolder, tree.ID+".sy")

	if isSameBox {
		if err = fromBox.Move(fromPath, newPath); nil != err {
			return
		}

		tree, err = LoadTree(fromBoxID, newPath)
		if nil != err {
			return
		}

		moveTree(tree)
	} else {
		absFromPath := filepath.Join(util.DataDir, fromBoxID, fromPath)
		absToPath := filepath.Join(util.DataDir, toBoxID, newPath)
		filesys.ReleaseFileLocks(absFromPath)
		if err = os.Rename(absFromPath, absToPath); nil != err {
			msg := fmt.Sprintf(Conf.Language(5), fromBox.Name, fromPath, err)
			util.LogErrorf("move [path=%s] in box [%s] failed: %s", fromPath, fromBoxID, err)
			err = errors.New(msg)
			return
		}

		tree, err = LoadTree(toBoxID, newPath)
		if nil != err {
			return
		}

		moveTree(tree)
		moveSorts(tree.ID, fromBoxID, toBoxID)
	}
	cache.ClearDocsIAL()
	IncWorkspaceDataVer()
	return
}

func RemoveDoc(boxID, p string) (err error) {
	box := Conf.Box(boxID)
	if nil == box {
		err = errors.New(Conf.Language(0))
		return
	}

	WaitForWritingFiles()
	writingDataLock.Lock()
	defer writingDataLock.Unlock()

	tree, err := LoadTree(boxID, p)
	if nil != err {
		return
	}

	historyDir, err := util.GetHistoryDir("delete")
	if nil != err {
		util.LogErrorf("get history dir failed: %s", err)
		return
	}

	historyPath := filepath.Join(historyDir, boxID, p)
	absPath := filepath.Join(util.DataDir, boxID, p)
	filesys.ReleaseFileLocks(absPath)
	if err = gulu.File.Copy(absPath, historyPath); nil != err {
		return errors.New(fmt.Sprintf(Conf.Language(70), box.Name, absPath, err))
	}

	copyDocAssetsToDataAssets(boxID, p)

	rootID := tree.ID
	dir := path.Dir(p)
	childrenDir := path.Join(dir, rootID)
	existChildren := box.Exist(childrenDir)
	if existChildren {
		absChildrenDir := filepath.Join(util.DataDir, tree.Box, childrenDir)
		historyPath = filepath.Join(historyDir, tree.Box, childrenDir)
		if err = gulu.File.Copy(absChildrenDir, historyPath); nil != err {
			return
		}
	}

	box.removeSort(rootID, p)
	if err = box.Remove(p); nil != err {
		return
	}

	if existChildren {
		box.Remove(childrenDir)
	}

	treenode.RemoveBlockTreesByPathPrefix(childrenDir)
	sql.RemoveTreePathQueue(box.ID, childrenDir)

	if "/" != dir {
		others, err := os.ReadDir(filepath.Join(util.DataDir, boxID, dir))
		if nil == err && 1 > len(others) {
			box.Remove(dir)
		}
	}

	cache.RemoveDocIAL(p)
	return
}

func RenameDoc(boxID, p, title string) (err error) {
	box := Conf.Box(boxID)
	if nil == box {
		err = errors.New(Conf.Language(0))
		return
	}

	WaitForWritingFiles()
	tree, err := LoadTree(box.ID, p)
	if nil != err {
		return
	}

	title = util.RemoveInvisible(title)
	oldTitle := tree.Root.IALAttr("title")
	if oldTitle == title {
		return
	}
	if "" == title {
		title = "Untitled"
	}

	evt := util.NewCmdResult("rename", 0, util.PushModeBroadcast, util.PushModeNone)
	evt.Data = map[string]interface{}{
		"box":   boxID,
		"id":    tree.Root.ID,
		"path":  p,
		"title": title,
	}
	util.PushEvent(evt)

	oldHPath := tree.HPath
	tree.HPath = path.Join(path.Dir(tree.HPath), title)
	tree.Root.SetIALAttr("title", title)
	tree.Root.SetIALAttr("updated", util.CurrentTimeSecondsStr())

	if err = renameWriteJSONQueue(tree, oldHPath); nil != err {
		return
	}

	box.renameSubTrees(tree)
	changedDefs := map[string]*ast.Node{tree.ID: tree.Root}
	changedTrees := map[string]*parse.Tree{tree.ID: tree}

	// 引用文档时锚文本没有跟随文档重命名 https://github.com/siyuan-note/siyuan/issues/4193
	// 详见 refreshDynamicRefText 函数实现
	go func() {
		sql.WaitForWritingDatabase()
		refreshDynamicRefText(changedDefs, changedTrees)
	}()

	IncWorkspaceDataVer()
	return
}

func CreateDailyNote(boxID string) (p string, err error) {
	box := Conf.Box(boxID)
	if nil == box {
		err = ErrBoxNotFound
		return
	}

	boxConf := box.GetConf()
	if "" == boxConf.DailyNoteSavePath || "/" == boxConf.DailyNoteSavePath {
		err = errors.New(Conf.Language(49))
		return
	}

	hPath, err := RenderCreateDocNameTemplate(boxConf.DailyNoteSavePath)
	if nil != err {
		return
	}

	WaitForWritingFiles()

	existRoot := treenode.GetBlockTreeRootByHPath(box.ID, hPath)
	if nil != existRoot {
		p = existRoot.Path
		return
	}

	id, err := createDocsByHPath(box.ID, hPath, "")
	if nil != err {
		return
	}

	var dom string
	if "" != boxConf.DailyNoteTemplatePath {
		tplPath := filepath.Join(util.DataDir, "templates", boxConf.DailyNoteTemplatePath)
		if !gulu.File.IsExist(tplPath) {
			util.LogWarnf("not found daily note template [%s]", tplPath)
		} else {
			dom, err = renderTemplate(tplPath, id)
			if nil != err {
				util.LogWarnf("render daily note template [%s] failed: %s", boxConf.DailyNoteTemplatePath, err)
			}
		}
	}
	if "" != dom {
		var tree *parse.Tree
		tree, err = loadTreeByBlockID(id)
		if nil == err {
			tree.Root.FirstChild.Unlink()

			luteEngine := NewLute()
			newTree := luteEngine.BlockDOM2Tree(dom)
			var children []*ast.Node
			for c := newTree.Root.FirstChild; nil != c; c = c.Next {
				children = append(children, c)
			}
			for _, c := range children {
				tree.Root.AppendChild(c)
			}
			tree.Root.SetIALAttr("updated", util.CurrentTimeSecondsStr())
			if err = indexWriteJSONQueue(tree); nil != err {
				return
			}
		}
	}
	IncWorkspaceDataVer()

	b := treenode.GetBlockTree(id)
	p = b.Path
	return
}

func createDoc(boxID, p, title, dom string) (err error) {
	title = util.RemoveInvisible(title)

	baseName := strings.TrimSpace(path.Base(p))
	if "" == strings.TrimSuffix(baseName, ".sy") {
		return errors.New(Conf.Language(16))
	}

	if strings.HasPrefix(baseName, ".") {
		return errors.New(Conf.Language(13))
	}

	box := Conf.Box(boxID)
	if nil == box {
		return errors.New(Conf.Language(0))
	}

	id := strings.TrimSuffix(path.Base(p), ".sy")
	var hPath string
	folder := path.Dir(p)
	if "/" != folder {
		parentID := path.Base(folder)
		parentTree, err := loadTreeByBlockID(parentID)
		if nil != err {
			util.LogErrorf("get parent tree [id=%s] failed", parentID)
			return ErrBlockNotFound
		}
		hPath = path.Join(parentTree.HPath, title)
	} else {
		hPath = "/" + title
	}

	if depth := strings.Count(p, "/"); 7 < depth && !Conf.FileTree.AllowCreateDeeper {
		err = errors.New(Conf.Language(118))
		return
	}

	if !box.Exist(folder) {
		if err = box.MkdirAll(folder); nil != err {
			return err
		}
	}

	if box.Exist(p) {
		return errors.New(Conf.Language(1))
	}

	var tree *parse.Tree
	luteEngine := NewLute()
	tree = luteEngine.BlockDOM2Tree(dom)
	tree.Box = boxID
	tree.Path = p
	tree.HPath = hPath
	tree.ID = id
	tree.Root.ID = id
	updated := util.TimeFromID(id)
	tree.Root.KramdownIAL = [][]string{{"id", id}, {"title", html.EscapeAttrVal(title)}, {"updated", updated}}
	if nil == tree.Root.FirstChild {
		tree.Root.AppendChild(protyle.NewParagraph())
	}

	transaction := &Transaction{DoOperations: []*Operation{{Action: "create", Data: tree}}}
	err = PerformTransactions(&[]*Transaction{transaction})
	if nil != err {
		tx, txErr := sql.BeginTx()
		if nil != txErr {
			util.LogFatalf("transaction failed: %s", txErr)
			return
		}
		sql.ClearBoxHash(tx)
		sql.CommitTx(tx)
		util.LogFatalf("transaction failed: %s", err)
		return
	}
	WaitForWritingFiles()
	return
}

func moveSorts(rootID, fromBox, toBox string) {
	root := treenode.GetBlockTree(rootID)
	if nil == root {
		return
	}

	fromRootSorts := map[string]int{}
	ids := rootChildIDs(rootID)
	fromConfPath := filepath.Join(util.DataDir, fromBox, ".siyuan", "sort.json")
	fromFullSortIDs := map[string]int{}
	if gulu.File.IsExist(fromConfPath) {
		data, err := filesys.LockFileRead(fromConfPath)
		if nil != err {
			util.LogErrorf("read sort conf failed: %s", err)
			return
		}

		if err = gulu.JSON.UnmarshalJSON(data, &fromFullSortIDs); nil != err {
			util.LogErrorf("unmarshal sort conf failed: %s", err)
		}
	}
	for _, id := range ids {
		fromRootSorts[id] = fromFullSortIDs[id]
	}

	toConfPath := filepath.Join(util.DataDir, toBox, ".siyuan", "sort.json")
	toFullSortIDs := map[string]int{}
	if gulu.File.IsExist(toConfPath) {
		data, err := filesys.LockFileRead(toConfPath)
		if nil != err {
			util.LogErrorf("read sort conf failed: %s", err)
			return
		}

		if err = gulu.JSON.UnmarshalJSON(data, &toFullSortIDs); nil != err {
			util.LogErrorf("unmarshal sort conf failed: %s", err)
			return
		}
	}

	for id, sortVal := range fromRootSorts {
		toFullSortIDs[id] = sortVal
	}

	data, err := gulu.JSON.MarshalIndentJSON(toFullSortIDs, "", "  ")
	if nil != err {
		util.LogErrorf("marshal sort conf failed: %s", err)
		return
	}
	if err = filesys.LockFileWrite(toConfPath, data); nil != err {
		util.LogErrorf("write sort conf failed: %s", err)
		return
	}
}

func rootChildIDs(rootID string) (ret []string) {
	root := treenode.GetBlockTree(rootID)
	if nil == root {
		return
	}

	ret = append(ret, rootID)
	boxLocalPath := filepath.Join(util.DataDir, root.BoxID)
	subFolder := filepath.Join(boxLocalPath, strings.TrimSuffix(root.Path, ".sy"))
	if !gulu.File.IsDir(subFolder) {
		return
	}
	filepath.Walk(subFolder, func(path string, info fs.FileInfo, err error) error {
		if strings.HasSuffix(path, ".sy") {
			name := filepath.Base(path)
			id := strings.TrimSuffix(name, ".sy")
			ret = append(ret, id)
		}
		return nil
	})
	return
}

func ChangeFileTreeSort(boxID string, paths []string) {
	WaitForWritingFiles()
	writingDataLock.Lock()
	defer writingDataLock.Unlock()

	box := Conf.Box(boxID)
	sortIDs := map[string]int{}
	max := 0
	for i, p := range paths {
		id := strings.TrimSuffix(path.Base(p), ".sy")
		sortIDs[id] = i + 1
		if i == len(paths)-1 {
			max = i + 2
		}
	}

	p := paths[0]
	parentPath := path.Dir(p)
	absParentPath := filepath.Join(util.DataDir, boxID, parentPath)
	files, err := os.ReadDir(absParentPath)
	if nil != err {
		util.LogErrorf("read dir [%s] failed: %s", err)
	}

	sortFolderIDs := map[string]int{}
	for _, f := range files {
		if !strings.HasSuffix(f.Name(), ".sy") {
			continue
		}

		id := strings.TrimSuffix(f.Name(), ".sy")
		val := sortIDs[id]
		if 0 == val {
			val = max
			max++
		}
		sortFolderIDs[id] = val
	}

	confDir := filepath.Join(util.DataDir, box.ID, ".siyuan")
	if err = os.MkdirAll(confDir, 0755); nil != err {
		util.LogErrorf("create conf dir failed: %s", err)
		return
	}
	confPath := filepath.Join(confDir, "sort.json")
	fullSortIDs := map[string]int{}
	var data []byte
	if gulu.File.IsExist(confPath) {
		data, err = filesys.LockFileRead(confPath)
		if nil != err {
			util.LogErrorf("read sort conf failed: %s", err)
			return
		}

		if err = gulu.JSON.UnmarshalJSON(data, &fullSortIDs); nil != err {
			util.LogErrorf("unmarshal sort conf failed: %s", err)
		}
	}

	for sortID, sortVal := range sortFolderIDs {
		fullSortIDs[sortID] = sortVal
	}

	data, err = gulu.JSON.MarshalIndentJSON(fullSortIDs, "", "  ")
	if nil != err {
		util.LogErrorf("marshal sort conf failed: %s", err)
		return
	}
	if err = filesys.LockFileWrite(confPath, data); nil != err {
		util.LogErrorf("write sort conf failed: %s", err)
		return
	}

	IncWorkspaceDataVer()
}

func (box *Box) fillSort(files *[]*File) {
	confPath := filepath.Join(util.DataDir, box.ID, ".siyuan", "sort.json")
	if !gulu.File.IsExist(confPath) {
		return
	}

	data, err := filesys.LockFileRead(confPath)
	if nil != err {
		util.LogErrorf("read sort conf failed: %s", err)
		return
	}

	fullSortIDs := map[string]int{}
	if err = gulu.JSON.UnmarshalJSON(data, &fullSortIDs); nil != err {
		util.LogErrorf("unmarshal sort conf failed: %s", err)
		return
	}

	for _, f := range *files {
		id := strings.TrimSuffix(f.ID, ".sy")
		f.Sort = fullSortIDs[id]
	}
}

func (box *Box) removeSort(rootID, path string) {
	absRoot := filepath.Join(util.DataDir, box.ID, path)
	absRootDir := strings.TrimSuffix(absRoot, ".sy")
	toRemoves := map[string]bool{rootID: true}
	filepath.Walk(absRootDir, func(path string, info fs.FileInfo, err error) error {
		if nil == info {
			return nil
		}
		name := info.Name()
		isDir := info.IsDir()
		if util.IsReservedFilename(name) {
			if isDir {
				return filepath.SkipDir
			}
			return nil
		}

		if !isDir && strings.HasSuffix(name, ".sy") {
			id := strings.TrimSuffix(name, ".sy")
			toRemoves[id] = true
		}
		return nil
	})

	confPath := filepath.Join(util.DataDir, box.ID, ".siyuan", "sort.json")
	if !gulu.File.IsExist(confPath) {
		return
	}

	data, err := filesys.LockFileRead(confPath)
	if nil != err {
		util.LogErrorf("read sort conf failed: %s", err)
		return
	}

	fullSortIDs := map[string]int{}
	if err = gulu.JSON.UnmarshalJSON(data, &fullSortIDs); nil != err {
		util.LogErrorf("unmarshal sort conf failed: %s", err)
		return
	}

	for toRemove := range toRemoves {
		delete(fullSortIDs, toRemove)
	}

	data, err = gulu.JSON.MarshalIndentJSON(fullSortIDs, "", "  ")
	if nil != err {
		util.LogErrorf("marshal sort conf failed: %s", err)
		return
	}
	if err = filesys.LockFileWrite(confPath, data); nil != err {
		util.LogErrorf("write sort conf failed: %s", err)
		return
	}
}

func ServeFile(c *gin.Context, filePath string) (err error) {
	WaitForWritingFiles()

	if filesys.IsLocked(filePath) {
		if err = filesys.UnlockFile(filePath); nil == err {
			util.LogInfof("unlocked file [%s]", filePath)
		} else {
			msg := fmt.Sprintf("unlock file [%s] failed: %s", filePath, err)
			util.LogErrorf(msg)
			return errors.New(msg)
		}
	}
	c.File(filePath)
	return
}
