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
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/88250/go-humanize"
	"github.com/88250/gulu"
	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/html"
	"github.com/88250/lute/parse"
	util2 "github.com/88250/lute/util"
	"github.com/facette/natsort"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/riff"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/search"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/task"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type File struct {
	Path         string `json:"path"`
	Name         string `json:"name"` // 标题，即 ial["title"]
	Icon         string `json:"icon"`
	Name1        string `json:"name1"` // 命名，即 ial["name"]
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
	Hidden       bool   `json:"hidden"`

	NewFlashcardCount int `json:"newFlashcardCount"`
	DueFlashcardCount int `json:"dueFlashcardCount"`
	FlashcardCount    int `json:"flashcardCount"`
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
	ret.HCtime = t.Format("2006-01-02 15:04:05") + ", " + util.HumanizeTime(t, Conf.Lang)
	ret.HSize = humanize.BytesCustomCeil(ret.Size, 2)

	mTime := t
	if updated := ial["updated"]; "" != updated {
		if updatedTime, err := time.ParseInLocation("20060102150405", updated, time.Local); nil == err {
			mTime = updatedTime
		}
	}

	ret.Mtime = mTime.Unix()
	ret.HMtime = mTime.Format("2006-01-02 15:04:05") + ", " + util.HumanizeTime(mTime, Conf.Lang)
	return
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

	data, err := filelock.ReadFile(filePath)
	if util.IsCorruptedSYData(data) {
		box.moveCorruptedData(filePath)
		return nil
	}
	if nil != err {
		logging.LogErrorf("read file [%s] failed: %s", p, err)
		return nil
	}
	ret = filesys.ReadDocIAL(data)
	if 1 > len(ret) {
		logging.LogWarnf("tree [%s] is corrupted", filePath)
		box.moveCorruptedData(filePath)
		return nil
	}
	cache.PutDocIAL(p, ret)
	return ret
}

func (box *Box) moveCorruptedData(filePath string) {
	base := filepath.Base(filePath)
	to := filepath.Join(util.WorkspaceDir, "corrupted", time.Now().Format("2006-01-02-150405"), box.ID, base)
	if copyErr := filelock.Copy(filePath, to); nil != copyErr {
		logging.LogErrorf("copy corrupted data file [%s] failed: %s", filePath, copyErr)
		return
	}
	if removeErr := filelock.Remove(filePath); nil != removeErr {
		logging.LogErrorf("remove corrupted data file [%s] failed: %s", filePath, removeErr)
		return
	}
	logging.LogWarnf("moved corrupted data file [%s] to [%s]", filePath, to)
}

func SearchDocsByKeyword(keyword string, flashcard bool) (ret []map[string]string) {
	ret = []map[string]string{}

	var deck *riff.Deck
	var deckBlockIDs []string
	if flashcard {
		deck = Decks[builtinDeckID]
		if nil == deck {
			return
		}

		deckBlockIDs = deck.GetBlockIDs()
	}

	openedBoxes := Conf.GetOpenedBoxes()
	boxes := map[string]*Box{}
	for _, box := range openedBoxes {
		boxes[box.ID] = box
	}

	var rootBlocks []*sql.Block
	if "" != keyword {
		for _, box := range boxes {
			if strings.Contains(box.Name, keyword) {
				if flashcard {
					newFlashcardCount, dueFlashcardCount, flashcardCount := countBoxFlashcard(box.ID, deck, deckBlockIDs)
					if 0 < flashcardCount {
						ret = append(ret, map[string]string{"path": "/", "hPath": box.Name + "/", "box": box.ID, "boxIcon": box.Icon, "newFlashcardCount": strconv.Itoa(newFlashcardCount), "dueFlashcardCount": strconv.Itoa(dueFlashcardCount), "flashcardCount": strconv.Itoa(flashcardCount)})
					}
				} else {
					ret = append(ret, map[string]string{"path": "/", "hPath": box.Name + "/", "box": box.ID, "boxIcon": box.Icon})
				}
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
			if flashcard {
				newFlashcardCount, dueFlashcardCount, flashcardCount := countBoxFlashcard(box.ID, deck, deckBlockIDs)
				if 0 < flashcardCount {
					ret = append(ret, map[string]string{"path": "/", "hPath": box.Name + "/", "box": box.ID, "boxIcon": box.Icon, "newFlashcardCount": strconv.Itoa(newFlashcardCount), "dueFlashcardCount": strconv.Itoa(dueFlashcardCount), "flashcardCount": strconv.Itoa(flashcardCount)})
				}
			} else {
				ret = append(ret, map[string]string{"path": "/", "hPath": box.Name + "/", "box": box.ID, "boxIcon": box.Icon})
			}
		}
	}

	for _, rootBlock := range rootBlocks {
		b := boxes[rootBlock.Box]
		if nil == b {
			continue
		}
		hPath := b.Name + rootBlock.HPath
		if flashcard {
			newFlashcardCount, dueFlashcardCount, flashcardCount := countTreeFlashcard(rootBlock.ID, deck, deckBlockIDs)
			if 0 < flashcardCount {
				ret = append(ret, map[string]string{"path": rootBlock.Path, "hPath": hPath, "box": rootBlock.Box, "boxIcon": b.Icon, "newFlashcardCount": strconv.Itoa(newFlashcardCount), "dueFlashcardCount": strconv.Itoa(dueFlashcardCount), "flashcardCount": strconv.Itoa(flashcardCount)})
			}
		} else {
			ret = append(ret, map[string]string{"path": rootBlock.Path, "hPath": hPath, "box": rootBlock.Box, "boxIcon": b.Icon})
		}
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

func ListDocTree(boxID, listPath string, sortMode int, flashcard, showHidden bool, maxListCount int) (ret []*File, totals int, err error) {
	//os.MkdirAll("pprof", 0755)
	//cpuProfile, _ := os.Create("pprof/cpu_profile_list_doc_tree")
	//pprof.StartCPUProfile(cpuProfile)
	//defer pprof.StopCPUProfile()

	ret = []*File{}

	var deck *riff.Deck
	var deckBlockIDs []string
	if flashcard {
		deck = Decks[builtinDeckID]
		if nil == deck {
			return
		}

		deckBlockIDs = deck.GetBlockIDs()
	}

	box := Conf.Box(boxID)
	if nil == box {
		return nil, 0, errors.New(Conf.Language(0))
	}

	boxConf := box.GetConf()

	if util.SortModeUnassigned == sortMode {
		sortMode = Conf.FileTree.Sort
		if util.SortModeFileTree != boxConf.SortMode {
			sortMode = boxConf.SortMode
		}
	}

	var files []*FileInfo
	start := time.Now()
	files, totals, err = box.Ls(listPath)
	if nil != err {
		return
	}
	elapsed := time.Now().Sub(start).Milliseconds()
	if 100 < elapsed {
		logging.LogWarnf("ls elapsed [%dms]", elapsed)
	}

	start = time.Now()
	boxLocalPath := filepath.Join(util.DataDir, box.ID)
	var docs []*File
	for _, file := range files {
		if file.isdir {
			if !ast.IsNodeIDPattern(file.name) {
				continue
			}

			parentDocPath := strings.TrimSuffix(file.path, "/") + ".sy"
			parentDocFile := box.Stat(parentDocPath)
			if nil == parentDocFile {
				continue
			}
			if ial := box.docIAL(parentDocPath); nil != ial {
				if !showHidden && "true" == ial["custom-hidden"] {
					continue
				}

				doc := box.docFromFileInfo(parentDocFile, ial)
				subFiles, err := os.ReadDir(filepath.Join(boxLocalPath, file.path))
				if nil == err {
					for _, subFile := range subFiles {
						subDocFilePath := path.Join(file.path, subFile.Name())
						if subIAL := box.docIAL(subDocFilePath); "true" == subIAL["custom-hidden"] {
							continue
						}

						if strings.HasSuffix(subFile.Name(), ".sy") {
							doc.SubFileCount++
						}
					}
				}

				if flashcard {
					rootID := strings.TrimSuffix(filepath.Base(parentDocPath), ".sy")
					newFlashcardCount, dueFlashcardCount, flashcardCount := countTreeFlashcard(rootID, deck, deckBlockIDs)
					if 0 < flashcardCount {
						doc.NewFlashcardCount = newFlashcardCount
						doc.DueFlashcardCount = dueFlashcardCount
						doc.FlashcardCount = flashcardCount
						docs = append(docs, doc)
					}
				} else {
					docs = append(docs, doc)
				}
			}

			continue
		}

		subFolder := filepath.Join(boxLocalPath, strings.TrimSuffix(file.path, ".sy"))
		if gulu.File.IsDir(subFolder) {
			continue
		}

		if ial := box.docIAL(file.path); nil != ial {
			if !showHidden && "true" == ial["custom-hidden"] {
				continue
			}

			doc := box.docFromFileInfo(file, ial)

			if flashcard {
				rootID := strings.TrimSuffix(filepath.Base(file.path), ".sy")
				newFlashcardCount, dueFlashcardCount, flashcardCount := countTreeFlashcard(rootID, deck, deckBlockIDs)
				if 0 < flashcardCount {
					doc.NewFlashcardCount = newFlashcardCount
					doc.DueFlashcardCount = dueFlashcardCount
					doc.FlashcardCount = flashcardCount
					docs = append(docs, doc)
				}
			} else {
				docs = append(docs, doc)
			}
		}
	}
	elapsed = time.Now().Sub(start).Milliseconds()
	if 500 < elapsed {
		logging.LogWarnf("build docs [%d] elapsed [%dms]", len(docs), elapsed)
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
		logging.LogWarnf("query root block ref count elapsed [%dms]", elapsed)
	}

	start = time.Now()
	switch sortMode {
	case util.SortModeNameASC:
		sort.Slice(docs, func(i, j int) bool {
			return util.PinYinCompare(util.RemoveEmojiInvisible(docs[i].Name), util.RemoveEmojiInvisible(docs[j].Name))
		})
	case util.SortModeNameDESC:
		sort.Slice(docs, func(i, j int) bool {
			return util.PinYinCompare(util.RemoveEmojiInvisible(docs[j].Name), util.RemoveEmojiInvisible(docs[i].Name))
		})
	case util.SortModeUpdatedASC:
		sort.Slice(docs, func(i, j int) bool { return docs[i].Mtime < docs[j].Mtime })
	case util.SortModeUpdatedDESC:
		sort.Slice(docs, func(i, j int) bool { return docs[i].Mtime > docs[j].Mtime })
	case util.SortModeAlphanumASC:
		sort.Slice(docs, func(i, j int) bool {
			return natsort.Compare(util.RemoveEmojiInvisible(docs[i].Name), util.RemoveEmojiInvisible(docs[j].Name))
		})
	case util.SortModeAlphanumDESC:
		sort.Slice(docs, func(i, j int) bool {
			return natsort.Compare(util.RemoveEmojiInvisible(docs[j].Name), util.RemoveEmojiInvisible(docs[i].Name))
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
		totals = len(ret)
		if maxListCount < len(ret) {
			ret = ret[:maxListCount]
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
	case util.SortModeSizeASC:
		sort.Slice(docs, func(i, j int) bool { return docs[i].Size < docs[j].Size })
	case util.SortModeSizeDESC:
		sort.Slice(docs, func(i, j int) bool { return docs[i].Size > docs[j].Size })
	case util.SortModeSubDocCountASC:
		sort.Slice(docs, func(i, j int) bool { return docs[i].SubFileCount < docs[j].SubFileCount })
	case util.SortModeSubDocCountDESC:
		sort.Slice(docs, func(i, j int) bool { return docs[i].SubFileCount > docs[j].SubFileCount })
	}

	if util.SortModeCustom != sortMode {
		ret = append(ret, docs...)
	}

	totals = len(ret)
	if maxListCount < len(ret) {
		ret = ret[:maxListCount]
	}
	ret = ret[:]

	elapsed = time.Now().Sub(start).Milliseconds()
	if 200 < elapsed {
		logging.LogInfof("sort docs elapsed [%dms]", elapsed)
	}
	return
}

func ContentStat(content string) (ret *util.BlockStatResult) {
	luteEngine := util.NewLute()
	return contentStat(content, luteEngine)
}

func contentStat(content string, luteEngine *lute.Lute) (ret *util.BlockStatResult) {
	tree := luteEngine.BlockDOM2Tree(content)
	runeCnt, wordCnt, linkCnt, imgCnt, refCnt := tree.Root.Stat()
	return &util.BlockStatResult{
		RuneCount:  runeCnt,
		WordCount:  wordCnt,
		LinkCount:  linkCnt,
		ImageCount: imgCnt,
		RefCount:   refCnt,
	}
}

func BlocksWordCount(ids []string) (ret *util.BlockStatResult) {
	ret = &util.BlockStatResult{}
	trees := filesys.LoadTrees(ids)
	for _, id := range ids {
		tree := trees[id]
		if nil == tree {
			continue
		}

		node := treenode.GetNodeInTree(tree, id)
		if nil == node {
			continue
		}

		runeCnt, wordCnt, linkCnt, imgCnt, refCnt := node.Stat()
		ret.RuneCount += runeCnt
		ret.WordCount += wordCnt
		ret.LinkCount += linkCnt
		ret.ImageCount += imgCnt
		ret.RefCount += refCnt
	}
	return
}

func StatTree(id string) (ret *util.BlockStatResult) {
	WaitForWritingFiles()

	tree, _ := LoadTreeByBlockID(id)
	if nil == tree {
		return
	}

	var databaseBlockNodes []*ast.Node
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering || ast.NodeAttributeView != n.Type {
			return ast.WalkContinue
		}

		databaseBlockNodes = append(databaseBlockNodes, n)
		return ast.WalkContinue
	})

	luteEngine := util.NewLute()
	var dbRuneCnt, dbWordCnt, dbLinkCnt, dbImgCnt, dbRefCnt int
	for _, n := range databaseBlockNodes {
		if "" == n.AttributeViewID {
			continue
		}

		attrView, _ := av.ParseAttributeView(n.AttributeViewID)
		if nil == attrView {
			continue
		}

		content := bytes.Buffer{}
		for _, kValues := range attrView.KeyValues {
			for _, v := range kValues.Values {
				switch kValues.Key.Type {
				case av.KeyTypeURL:
					if v.IsEmpty() {
						continue
					}

					dbLinkCnt++
					content.WriteString(v.URL.Content)
				case av.KeyTypeMAsset:
					if v.IsEmpty() {
						continue
					}

					for _, asset := range v.MAsset {
						if av.AssetTypeImage == asset.Type {
							dbImgCnt++
						}
					}
				case av.KeyTypeBlock:
					if v.IsEmpty() {
						continue
					}

					if !v.IsDetached {
						dbRefCnt++
					}
					content.WriteString(v.Block.Content)
				case av.KeyTypeText:
					if v.IsEmpty() {
						continue
					}
					content.WriteString(v.Text.Content)
				case av.KeyTypeNumber:
					if v.IsEmpty() {
						continue
					}
					v.Number.FormatNumber()
					content.WriteString(v.Number.FormattedContent)
				case av.KeyTypeEmail:
					if v.IsEmpty() {
						continue
					}
					content.WriteString(v.Email.Content)
				case av.KeyTypePhone:
					if v.IsEmpty() {
						continue
					}
					content.WriteString(v.Phone.Content)
				}
			}
		}

		dbStat := contentStat(content.String(), luteEngine)
		dbRuneCnt += dbStat.RuneCount
		dbWordCnt += dbStat.WordCount
	}

	runeCnt, wordCnt, linkCnt, imgCnt, refCnt := tree.Root.Stat()
	runeCnt += dbRuneCnt
	wordCnt += dbWordCnt
	linkCnt += dbLinkCnt
	imgCnt += dbImgCnt
	refCnt += dbRefCnt
	return &util.BlockStatResult{
		RuneCount:  runeCnt,
		WordCount:  wordCnt,
		LinkCount:  linkCnt,
		ImageCount: imgCnt,
		RefCount:   refCnt,
	}
}

func GetDoc(startID, endID, id string, index int, query string, queryTypes map[string]bool, queryMethod, mode int, size int, isBacklink bool) (blockCount int, dom, parentID, parent2ID, rootID, typ string, eof, scroll bool, boxID, docPath string, isBacklinkExpand bool, err error) {
	//os.MkdirAll("pprof", 0755)
	//cpuProfile, _ := os.Create("pprof/GetDoc")
	//pprof.StartCPUProfile(cpuProfile)
	//defer pprof.StopCPUProfile()

	WaitForWritingFiles() // 写入数据时阻塞，避免获取到的数据不一致

	inputIndex := index
	tree, err := LoadTreeByBlockID(id)
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
		// Unable to open the doc when the block pointed by the scroll position does not exist https://github.com/siyuan-note/siyuan/issues/9030
		node = treenode.GetNodeInTree(tree, tree.Root.ID)
		if nil == node {
			err = ErrBlockNotFound
			return
		}
	}

	if isBacklink { // 引用计数浮窗请求，需要按照反链逻辑组装 https://github.com/siyuan-note/siyuan/issues/6853
		if ast.NodeParagraph == node.Type {
			if nil != node.Parent && ast.NodeListItem == node.Parent.Type {
				node = node.Parent
			}
		}
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

	// 判断是否需要显示动态加载滚动条 https://github.com/siyuan-note/siyuan/issues/7693
	childCount := 0
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		if 1 > childCount {
			childCount = 1
		} else {
			childCount += treenode.CountBlockNodes(n)
		}

		if childCount > Conf.Editor.DynamicLoadBlocks {
			scroll = true
			return ast.WalkStop
		}
		return ast.WalkContinue
	})

	var nodes []*ast.Node
	if isBacklink {
		// 引用计数浮窗请求，需要按照反链逻辑组装 https://github.com/siyuan-note/siyuan/issues/6853
		nodes, isBacklinkExpand = getBacklinkRenderNodes(node)
	} else {
		// 如果同时存在 startID 和 endID，并且是动态加载的情况，则只加载 startID 和 endID 之间的块 [startID, endID]
		if "" != startID && "" != endID && scroll {
			nodes, eof = loadNodesByStartEnd(tree, startID, endID)
			if 1 > len(nodes) {
				// 按 mode 加载兜底
				nodes, eof = loadNodesByMode(node, inputIndex, mode, size, isDoc, isHeading)
			} else {
				// 文档块没有指定 index 时需要计算 index，否则初次打开文档时 node-index 会为 0，导致首次 Ctrl+Home 无法回到顶部
				ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
					if !entering {
						return ast.WalkContinue
					}

					index++
					if nodes[0].ID == n.ID {
						return ast.WalkStop
					}
					return ast.WalkContinue
				})
			}
		} else {
			nodes, eof = loadNodesByMode(node, inputIndex, mode, size, isDoc, isHeading)
		}
	}

	refCount := sql.QueryRootChildrenRefCount(rootID)
	virtualBlockRefKeywords := getBlockVirtualRefKeywords(tree.Root)

	subTree := &parse.Tree{ID: rootID, Root: &ast.Node{Type: ast.NodeDocument}, Marks: tree.Marks}

	var keywords []string
	if "" != query && (0 == queryMethod || 1 == queryMethod) { // 只有关键字搜索和查询语法搜索才支持高亮
		if 0 == queryMethod {
			query = stringQuery(query)
		}
		typeFilter := buildTypeFilter(queryTypes)
		keywords = highlightByQuery(query, typeFilter, rootID)
	}

	for _, n := range nodes {
		var unlinks []*ast.Node
		ast.Walk(n, func(n *ast.Node, entering bool) ast.WalkStatus {
			if !entering {
				return ast.WalkContinue
			}

			if "1" == n.IALAttr("heading-fold") {
				// 折叠标题下被引用的块无法悬浮查看
				// The referenced block under the folded heading cannot be hovered to view https://github.com/siyuan-note/siyuan/issues/9582
				if (0 != mode && id != n.ID) || isDoc {
					unlinks = append(unlinks, n)
					return ast.WalkContinue
				}
			}

			if avs := n.IALAttr(av.NodeAttrNameAvs); "" != avs {
				// 填充属性视图角标 Display the database title on the block superscript https://github.com/siyuan-note/siyuan/issues/10545
				avNames := getAvNames(n.IALAttr(av.NodeAttrNameAvs))
				if "" != avNames {
					n.SetIALAttr(av.NodeAttrViewNames, avNames)
				}
			}

			if "" != n.ID {
				// 填充块引计数
				if cnt := refCount[n.ID]; 0 < cnt {
					n.SetIALAttr("refcount", strconv.Itoa(cnt))
				}
			}

			if 0 < len(keywords) {
				hitBlock := false
				for p := n.Parent; nil != p; p = p.Parent {
					if p.ID == id {
						hitBlock = true
						break
					}
				}
				if hitBlock {
					if ast.NodeCodeBlockCode == n.Type && !treenode.IsChartCodeBlockCode(n) {
						// 支持代码块搜索定位 https://github.com/siyuan-note/siyuan/issues/5520
						code := string(n.Tokens)
						markedCode := search.EncloseHighlighting(code, keywords, search.SearchMarkLeft, search.SearchMarkRight, Conf.Search.CaseSensitive, false)
						if code != markedCode {
							n.Tokens = gulu.Str.ToBytes(markedCode)
							return ast.WalkContinue
						}
					} else if markReplaceSpan(n, &unlinks, keywords, search.MarkDataType, luteEngine) {
						return ast.WalkContinue
					}
				}
			}

			if processVirtualRef(n, &unlinks, virtualBlockRefKeywords, refCount, luteEngine) {
				return ast.WalkContinue
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

	SetRecentDocByTree(tree)
	return
}

func loadNodesByStartEnd(tree *parse.Tree, startID, endID string) (nodes []*ast.Node, eof bool) {
	node := treenode.GetNodeInTree(tree, startID)
	if nil == node {
		return
	}
	nodes = append(nodes, node)
	for n := node.Next; nil != n; n = n.Next {
		if treenode.IsInFoldedHeading(n, nil) {
			continue
		}
		nodes = append(nodes, n)

		if n.ID == endID {
			if next := n.Next; nil == next {
				eof = true
			} else {
				eof = util2.IsDocIAL(n.Tokens) || util2.IsDocIAL(next.Tokens)
			}
			break
		}
	}
	return
}

func loadNodesByMode(node *ast.Node, inputIndex, mode, size int, isDoc, isHeading bool) (nodes []*ast.Node, eof bool) {
	if 2 == mode /* 向下 */ {
		next := node.Next
		if ast.NodeHeading == node.Type && "1" == node.IALAttr("fold") {
			// 标题展开时进行动态加载导致重复内容 https://github.com/siyuan-note/siyuan/issues/4671
			// 这里要考虑折叠标题是最后一个块的情况
			if children := treenode.HeadingChildren(node); 0 < len(children) {
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
				if treenode.IsInFoldedHeading(n, nil) {
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
				if treenode.IsInFoldedHeading(n, node) {
					// 大纲点击折叠标题跳转聚焦 https://github.com/siyuan-note/siyuan/issues/4920
					// 多级标题折叠后上级块引浮窗中未折叠 https://github.com/siyuan-note/siyuan/issues/4997
					continue
				}
				if ast.NodeHeading == n.Type {
					if n.HeadingLevel <= level {
						break
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
			if treenode.IsInFoldedHeading(n, nil) {
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
			if treenode.IsInFoldedHeading(n, nil) {
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
			if treenode.IsInFoldedHeading(n, node) {
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
			if treenode.IsInFoldedHeading(n, nil) {
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
			if treenode.IsInFoldedHeading(n, nil) {
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

func writeTreeUpsertQueue(tree *parse.Tree) (err error) {
	if err = filesys.WriteTree(tree); nil != err {
		return
	}
	sql.UpsertTreeQueue(tree)
	return
}

func writeTreeIndexQueue(tree *parse.Tree) (err error) {
	if err = filesys.WriteTree(tree); nil != err {
		return
	}
	sql.IndexTreeQueue(tree)
	return
}

func indexWriteTreeIndexQueue(tree *parse.Tree) (err error) {
	treenode.IndexBlockTree(tree)
	return writeTreeIndexQueue(tree)
}

func indexWriteTreeUpsertQueue(tree *parse.Tree) (err error) {
	treenode.UpsertBlockTree(tree)
	return writeTreeUpsertQueue(tree)
}

func renameWriteJSONQueue(tree *parse.Tree) (err error) {
	if err = filesys.WriteTree(tree); nil != err {
		return
	}
	sql.RenameTreeQueue(tree)
	treenode.UpsertBlockTree(tree)
	return
}

func DuplicateDoc(tree *parse.Tree) {
	msgId := util.PushMsg(Conf.Language(116), 30000)
	defer util.PushClearMsg(msgId)

	resetTree(tree, "Duplicated")
	createTreeTx(tree)
	WaitForWritingFiles()
	return
}

func createTreeTx(tree *parse.Tree) {
	transaction := &Transaction{DoOperations: []*Operation{{Action: "create", Data: tree}}}
	PerformTransactions(&[]*Transaction{transaction})
}

var createDocLock = sync.Mutex{}

func CreateDocByMd(boxID, p, title, md string, sorts []string) (tree *parse.Tree, err error) {
	createDocLock.Lock()
	defer createDocLock.Unlock()

	box := Conf.Box(boxID)
	if nil == box {
		err = errors.New(Conf.Language(0))
		return
	}

	luteEngine := util.NewLute()
	dom := luteEngine.Md2BlockDOM(md, false)
	tree, err = createDoc(box.ID, p, title, dom)
	if nil != err {
		return
	}

	WaitForWritingFiles()
	ChangeFileTreeSort(box.ID, sorts)
	return
}

func CreateWithMarkdown(boxID, hPath, md, parentID, id string, withMath bool) (retID string, err error) {
	createDocLock.Lock()
	defer createDocLock.Unlock()

	box := Conf.Box(boxID)
	if nil == box {
		err = errors.New(Conf.Language(0))
		return
	}

	WaitForWritingFiles()
	luteEngine := util.NewLute()
	if withMath {
		luteEngine.SetInlineMath(true)
	}
	dom := luteEngine.Md2BlockDOM(md, false)
	retID, err = createDocsByHPath(box.ID, hPath, dom, parentID, id)
	WaitForWritingFiles()
	return
}

func CreateDailyNote(boxID string) (p string, existed bool, err error) {
	createDocLock.Lock()
	defer createDocLock.Unlock()

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

	hPath, err := RenderGoTemplate(boxConf.DailyNoteSavePath)
	if nil != err {
		return
	}

	WaitForWritingFiles()

	existRoot := treenode.GetBlockTreeRootByHPath(box.ID, hPath)
	if nil != existRoot {
		existed = true
		p = existRoot.Path

		tree, loadErr := LoadTreeByBlockID(existRoot.RootID)
		if nil != loadErr {
			logging.LogWarnf("load tree by block id [%s] failed: %v", existRoot.RootID, loadErr)
			return
		}
		p = tree.Path
		date := time.Now().Format("20060102")
		if tree.Root.IALAttr("custom-dailynote-"+date) == "" {
			tree.Root.SetIALAttr("custom-dailynote-"+date, date)
			if err = indexWriteTreeUpsertQueue(tree); nil != err {
				return
			}
		}
		return
	}

	id, err := createDocsByHPath(box.ID, hPath, "", "", "")
	if nil != err {
		return
	}

	var templateTree *parse.Tree
	var templateDom string
	if "" != boxConf.DailyNoteTemplatePath {
		tplPath := filepath.Join(util.DataDir, "templates", boxConf.DailyNoteTemplatePath)
		if !filelock.IsExist(tplPath) {
			logging.LogWarnf("not found daily note template [%s]", tplPath)
		} else {
			var renderErr error
			templateTree, templateDom, renderErr = RenderTemplate(tplPath, id, false)
			if nil != renderErr {
				logging.LogWarnf("render daily note template [%s] failed: %s", boxConf.DailyNoteTemplatePath, err)
			}
		}
	}
	if "" != templateDom {
		var tree *parse.Tree
		tree, err = LoadTreeByBlockID(id)
		if nil == err {
			tree.Root.FirstChild.Unlink()

			luteEngine := util.NewLute()
			newTree := luteEngine.BlockDOM2Tree(templateDom)
			var children []*ast.Node
			for c := newTree.Root.FirstChild; nil != c; c = c.Next {
				children = append(children, c)
			}
			for _, c := range children {
				tree.Root.AppendChild(c)
			}

			// Creating a dailynote template supports doc attributes https://github.com/siyuan-note/siyuan/issues/10698
			templateIALs := parse.IAL2Map(templateTree.Root.KramdownIAL)
			for k, v := range templateIALs {
				if "name" == k || "alias" == k || "bookmark" == k || "memo" == k || strings.HasPrefix(k, "custom-") {
					tree.Root.SetIALAttr(k, v)
				}
			}

			tree.Root.SetIALAttr("updated", util.CurrentTimeSecondsStr())
			if err = indexWriteTreeUpsertQueue(tree); nil != err {
				return
			}
		}
	}
	IncSync()

	WaitForWritingFiles()

	tree, err := LoadTreeByBlockID(id)
	if nil != err {
		logging.LogErrorf("load tree by block id [%s] failed: %v", id, err)
		return
	}
	p = tree.Path
	date := time.Now().Format("20060102")
	tree.Root.SetIALAttr("custom-dailynote-"+date, date)
	if err = indexWriteTreeUpsertQueue(tree); nil != err {
		return
	}

	return
}

func GetHPathByPath(boxID, p string) (hPath string, err error) {
	if "/" == p {
		hPath = "/"
		return
	}

	luteEngine := util.NewLute()
	tree, err := filesys.LoadTree(boxID, p, luteEngine)
	if nil != err {
		return
	}
	hPath = tree.HPath
	return
}

func GetHPathsByPaths(paths []string) (hPaths []string, err error) {
	pathsBoxes := getBoxesByPaths(paths)
	for p, box := range pathsBoxes {
		if nil == box {
			logging.LogWarnf("box not found by path [%s]", p)
			continue
		}

		bt := treenode.GetBlockTreeByPath(p)
		if nil == bt {
			logging.LogWarnf("block tree not found by path [%s]", p)
			continue
		}

		hpath := html.UnescapeString(bt.HPath)
		hPaths = append(hPaths, box.Name+hpath)
	}
	return
}

func GetHPathByID(id string) (hPath string, err error) {
	tree, err := LoadTreeByBlockID(id)
	if nil != err {
		return
	}
	hPath = tree.HPath
	return
}

func GetFullHPathByID(id string) (hPath string, err error) {
	tree, err := LoadTreeByBlockID(id)
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

func GetIDsByHPath(hpath, boxID string) (ret []string, err error) {
	ret = []string{}
	roots := treenode.GetBlockTreeRootsByHPath(boxID, hpath)
	if 1 > len(roots) {
		return
	}

	for _, root := range roots {
		ret = append(ret, root.ID)
	}
	ret = gulu.Str.RemoveDuplicatedElem(ret)
	if 1 > len(ret) {
		ret = []string{}
	}
	return
}

func MoveDocs(fromPaths []string, toBoxID, toPath string, callback interface{}) (err error) {
	toBox := Conf.Box(toBoxID)
	if nil == toBox {
		err = errors.New(Conf.Language(0))
		return
	}

	fromPaths = util.FilterMoveDocFromPaths(fromPaths, toPath)
	if 1 > len(fromPaths) {
		return
	}

	pathsBoxes := getBoxesByPaths(fromPaths)

	if 1 == len(fromPaths) {
		// 移动到自己的父文档下的情况相当于不移动，直接返回
		if fromBox := pathsBoxes[fromPaths[0]]; nil != fromBox && fromBox.ID == toBoxID {
			parentDir := path.Dir(fromPaths[0])
			if ("/" == toPath && "/" == parentDir) || (parentDir+".sy" == toPath) {
				return
			}
		}
	}

	// 检查路径深度是否超过限制
	for fromPath, fromBox := range pathsBoxes {
		childDepth := util.GetChildDocDepth(filepath.Join(util.DataDir, fromBox.ID, fromPath))
		if depth := strings.Count(toPath, "/") + childDepth; 6 < depth && !Conf.FileTree.AllowCreateDeeper {
			err = errors.New(Conf.Language(118))
			return
		}
	}

	// A progress layer appears when moving more than 64 documents at once https://github.com/siyuan-note/siyuan/issues/9356
	subDocsCount := 0
	for fromPath, fromBox := range pathsBoxes {
		subDocsCount += countSubDocs(fromBox.ID, fromPath)
	}
	needShowProgress := 64 < subDocsCount
	if needShowProgress {
		defer util.PushClearProgress()
	}

	WaitForWritingFiles()
	luteEngine := util.NewLute()
	count := 0
	for fromPath, fromBox := range pathsBoxes {
		count++
		if needShowProgress {
			util.PushEndlessProgress(fmt.Sprintf(Conf.Language(70), fmt.Sprintf("%d/%d", count, len(fromPaths))))
		}

		_, err = moveDoc(fromBox, fromPath, toBox, toPath, luteEngine, callback)
		if nil != err {
			return
		}
	}
	cache.ClearDocsIAL()
	IncSync()
	return
}

func countSubDocs(box, p string) (ret int) {
	p = strings.TrimSuffix(p, ".sy")
	_ = filepath.Walk(filepath.Join(util.DataDir, box, p), func(path string, info os.FileInfo, err error) error {
		if nil != err {
			return err
		}
		if info.IsDir() {
			return nil
		}
		if strings.HasSuffix(path, ".sy") {
			ret++
		}
		return nil
	})
	return
}

func moveDoc(fromBox *Box, fromPath string, toBox *Box, toPath string, luteEngine *lute.Lute, callback interface{}) (newPath string, err error) {
	isSameBox := fromBox.ID == toBox.ID

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

	tree, err := filesys.LoadTree(fromBox.ID, fromPath, luteEngine)
	if nil != err {
		err = ErrBlockNotFound
		return
	}

	moveToRoot := "/" == toPath
	toBlockID := tree.ID
	fromFolder := path.Join(path.Dir(fromPath), tree.ID)
	toFolder := "/"
	if !moveToRoot {
		var toTree *parse.Tree
		if isSameBox {
			toTree, err = filesys.LoadTree(fromBox.ID, toPath, luteEngine)
		} else {
			toTree, err = filesys.LoadTree(toBox.ID, toPath, luteEngine)
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

	needMoveSubDocs := fromBox.Exist(fromFolder)
	if needMoveSubDocs {
		// 移动子文档文件夹

		newFolder := path.Join(toFolder, tree.ID)
		if isSameBox {
			if err = fromBox.Move(fromFolder, newFolder); nil != err {
				return
			}
		} else {
			absFromPath := filepath.Join(util.DataDir, fromBox.ID, fromFolder)
			absToPath := filepath.Join(util.DataDir, toBox.ID, newFolder)
			if filelock.IsExist(absToPath) {
				filelock.Remove(absToPath)
			}
			if err = filelock.Rename(absFromPath, absToPath); nil != err {
				msg := fmt.Sprintf(Conf.Language(5), fromBox.Name, fromPath, err)
				logging.LogErrorf("move [path=%s] in box [%s] failed: %s", fromPath, fromBox.ID, err)
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

		tree, err = filesys.LoadTree(fromBox.ID, newPath, luteEngine)
		if nil != err {
			return
		}

		moveTree(tree)
	} else {
		absFromPath := filepath.Join(util.DataDir, fromBox.ID, fromPath)
		absToPath := filepath.Join(util.DataDir, toBox.ID, newPath)
		if err = filelock.Rename(absFromPath, absToPath); nil != err {
			msg := fmt.Sprintf(Conf.Language(5), fromBox.Name, fromPath, err)
			logging.LogErrorf("move [path=%s] in box [%s] failed: %s", fromPath, fromBox.ID, err)
			err = errors.New(msg)
			return
		}

		tree, err = filesys.LoadTree(toBox.ID, newPath, luteEngine)
		if nil != err {
			return
		}

		moveTree(tree)
		moveSorts(tree.ID, fromBox.ID, toBox.ID)
	}

	if needMoveSubDocs {
		// 将其所有子文档的移动事件推送到前端 https://github.com/siyuan-note/siyuan/issues/11661
		subDocsFolder := path.Join(toFolder, tree.ID)
		syFiles := listSyFiles(path.Join(toBox.ID, subDocsFolder))
		for _, syFile := range syFiles {
			relPath := strings.TrimPrefix(syFile, "/"+path.Join(toBox.ID, toFolder))
			subFromPath := path.Join(path.Dir(fromPath), relPath)
			subToPath := path.Join(toFolder, relPath)

			evt := util.NewCmdResult("moveDoc", 0, util.PushModeBroadcast)
			evt.Data = map[string]interface{}{
				"fromNotebook": fromBox.ID,
				"fromPath":     subFromPath,
				"toNotebook":   toBox.ID,
				"toPath":       path.Dir(subToPath) + ".sy",
				"newPath":      subToPath,
			}
			evt.Callback = callback
			util.PushEvent(evt)
		}
	}

	evt := util.NewCmdResult("moveDoc", 0, util.PushModeBroadcast)
	evt.Data = map[string]interface{}{
		"fromNotebook": fromBox.ID,
		"fromPath":     fromPath,
		"toNotebook":   toBox.ID,
		"toPath":       toPath,
		"newPath":      newPath,
	}
	evt.Callback = callback
	util.PushEvent(evt)
	return
}

func RemoveDoc(boxID, p string) {
	box := Conf.Box(boxID)
	if nil == box {
		return
	}

	WaitForWritingFiles()
	luteEngine := util.NewLute()
	removeDoc(box, p, luteEngine)
	IncSync()
	return
}

func RemoveDocs(paths []string) {
	util.PushEndlessProgress(Conf.Language(116))
	defer util.PushClearProgress()

	paths = util.FilterSelfChildDocs(paths)
	pathsBoxes := getBoxesByPaths(paths)
	WaitForWritingFiles()
	luteEngine := util.NewLute()
	for p, box := range pathsBoxes {
		removeDoc(box, p, luteEngine)
	}
	return
}

func removeDoc(box *Box, p string, luteEngine *lute.Lute) {
	tree, _ := filesys.LoadTree(box.ID, p, luteEngine)
	if nil == tree {
		return
	}

	historyDir, err := GetHistoryDir(HistoryOpDelete)
	if nil != err {
		logging.LogErrorf("get history dir failed: %s", err)
		return
	}

	historyPath := filepath.Join(historyDir, box.ID, p)
	absPath := filepath.Join(util.DataDir, box.ID, p)
	if err = filelock.Copy(absPath, historyPath); nil != err {
		logging.LogErrorf("backup [path=%s] to history [%s] failed: %s", absPath, historyPath, err)
		return
	}

	// 关联的属性视图也要复制到历史中 https://github.com/siyuan-note/siyuan/issues/9567
	avNodes := tree.Root.ChildrenByType(ast.NodeAttributeView)
	for _, avNode := range avNodes {
		srcAvPath := filepath.Join(util.DataDir, "storage", "av", avNode.AttributeViewID+".json")
		destAvPath := filepath.Join(historyDir, "storage", "av", avNode.AttributeViewID+".json")
		if copyErr := filelock.Copy(srcAvPath, destAvPath); nil != copyErr {
			logging.LogErrorf("copy av [%s] failed: %s", srcAvPath, copyErr)
		}
	}

	copyDocAssetsToDataAssets(box.ID, p)

	removeIDs := treenode.RootChildIDs(tree.ID)
	dir := path.Dir(p)
	childrenDir := path.Join(dir, tree.ID)
	existChildren := box.Exist(childrenDir)
	if existChildren {
		absChildrenDir := filepath.Join(util.DataDir, tree.Box, childrenDir)
		historyPath = filepath.Join(historyDir, tree.Box, childrenDir)
		if err = filelock.Copy(absChildrenDir, historyPath); nil != err {
			logging.LogErrorf("backup [path=%s] to history [%s] failed: %s", absChildrenDir, historyPath, err)
			return
		}
	}
	indexHistoryDir(filepath.Base(historyDir), util.NewLute())

	allRemoveRootIDs := []string{tree.ID}
	allRemoveRootIDs = append(allRemoveRootIDs, removeIDs...)
	for _, rootID := range allRemoveRootIDs {
		removeTree, _ := LoadTreeByBlockID(rootID)
		if nil == removeTree {
			continue
		}

		// 刷新文档关联的数据库 https://github.com/siyuan-note/siyuan/issues/11731
		syncDelete2AttributeView(removeTree.Root)

		// 解绑数据库关联
		removeAvBlockRel(removeTree.Root)
	}

	if existChildren {
		if err = box.Remove(childrenDir); nil != err {
			logging.LogErrorf("remove children dir [%s%s] failed: %s", box.ID, childrenDir, err)
			return
		}
		logging.LogInfof("removed children dir [%s%s]", box.ID, childrenDir)
	}
	if err = box.Remove(p); nil != err {
		logging.LogErrorf("remove [%s%s] failed: %s", box.ID, p, err)
		return
	}
	logging.LogInfof("removed doc [%s%s]", box.ID, p)

	box.removeSort(removeIDs)
	RemoveRecentDoc(removeIDs)
	if "/" != dir {
		others, err := os.ReadDir(filepath.Join(util.DataDir, box.ID, dir))
		if nil == err && 1 > len(others) {
			box.Remove(dir)
		}
	}

	evt := util.NewCmdResult("removeDoc", 0, util.PushModeBroadcast)
	evt.Data = map[string]interface{}{
		"ids": removeIDs,
	}
	util.PushEvent(evt)

	task.AppendTask(task.DatabaseIndex, removeDoc0, box, p, childrenDir)
}

func removeDoc0(box *Box, p, childrenDir string) {
	treenode.RemoveBlockTreesByPathPrefix(childrenDir)
	sql.RemoveTreePathQueue(box.ID, childrenDir)
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
	luteEngine := util.NewLute()
	tree, err := filesys.LoadTree(box.ID, p, luteEngine)
	if nil != err {
		return
	}

	title = removeInvisibleCharsInTitle(title)
	if 512 < utf8.RuneCountInString(title) {
		// 限制笔记本名和文档名最大长度为 `512` https://github.com/siyuan-note/siyuan/issues/6299
		return errors.New(Conf.Language(106))
	}

	oldTitle := tree.Root.IALAttr("title")
	if oldTitle == title {
		return
	}
	if "" == title {
		title = Conf.language(105)
	}
	title = strings.ReplaceAll(title, "/", "")

	tree.HPath = path.Join(path.Dir(tree.HPath), title)
	tree.Root.SetIALAttr("title", title)
	tree.Root.SetIALAttr("updated", util.CurrentTimeSecondsStr())
	if err = renameWriteJSONQueue(tree); nil != err {
		return
	}

	refText := getNodeRefText(tree.Root)
	evt := util.NewCmdResult("rename", 0, util.PushModeBroadcast)
	evt.Data = map[string]interface{}{
		"box":     boxID,
		"id":      tree.Root.ID,
		"path":    p,
		"title":   title,
		"refText": refText,
	}
	util.PushEvent(evt)

	box.renameSubTrees(tree)
	updateRefTextRenameDoc(tree)
	IncSync()
	return
}

func createDoc(boxID, p, title, dom string) (tree *parse.Tree, err error) {
	title = removeInvisibleCharsInTitle(title)
	if 512 < utf8.RuneCountInString(title) {
		// 限制笔记本名和文档名最大长度为 `512` https://github.com/siyuan-note/siyuan/issues/6299
		err = errors.New(Conf.Language(106))
		return
	}
	title = strings.ReplaceAll(title, "/", "")
	title = strings.TrimSpace(title)
	if "" == title {
		title = Conf.Language(105)
	}

	baseName := strings.TrimSpace(path.Base(p))
	if "" == strings.TrimSuffix(baseName, ".sy") {
		err = errors.New(Conf.Language(16))
		return
	}

	if strings.HasPrefix(baseName, ".") {
		err = errors.New(Conf.Language(13))
		return
	}

	box := Conf.Box(boxID)
	if nil == box {
		err = errors.New(Conf.Language(0))
		return
	}

	id := strings.TrimSuffix(path.Base(p), ".sy")
	var hPath string
	folder := path.Dir(p)
	if "/" != folder {
		parentID := path.Base(folder)
		parentTree, loadErr := LoadTreeByBlockID(parentID)
		if nil != loadErr {
			logging.LogErrorf("get parent tree [%s] failed", parentID)
			err = ErrBlockNotFound
			return
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
			return
		}
	}

	if box.Exist(p) {
		err = errors.New(Conf.Language(1))
		return
	}

	luteEngine := util.NewLute()
	tree = luteEngine.BlockDOM2Tree(dom)
	tree.Box = boxID
	tree.Path = p
	tree.HPath = hPath
	tree.ID = id
	tree.Root.ID = id
	tree.Root.Spec = "1"
	updated := util.TimeFromID(id)
	tree.Root.KramdownIAL = [][]string{{"id", id}, {"title", html.EscapeAttrVal(title)}, {"updated", updated}}
	if nil == tree.Root.FirstChild {
		tree.Root.AppendChild(treenode.NewParagraph())
	}

	// 如果段落块中仅包含一个 mp3/mp4 超链接，则将其转换为音视频块
	// Convert mp3 and mp4 hyperlinks to audio and video when moving cloud inbox to docs https://github.com/siyuan-note/siyuan/issues/9778
	var unlinks []*ast.Node
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		if ast.NodeParagraph == n.Type {
			link := n.FirstChild
			if nil != link && link.IsTextMarkType("a") {
				if strings.HasSuffix(link.TextMarkAHref, ".mp3") {
					unlinks = append(unlinks, n)
					audio := &ast.Node{ID: n.ID, Type: ast.NodeAudio, Tokens: []byte("<audio controls=\"controls\" src=\"" + link.TextMarkAHref + "\" data-src=\"" + link.TextMarkAHref + "\"></audio>")}
					audio.SetIALAttr("id", n.ID)
					audio.SetIALAttr("updated", util.TimeFromID(n.ID))
					n.InsertBefore(audio)
				} else if strings.HasSuffix(link.TextMarkAHref, ".mp4") {
					unlinks = append(unlinks, n)
					video := &ast.Node{ID: n.ID, Type: ast.NodeVideo, Tokens: []byte("<video controls=\"controls\" src=\"" + link.TextMarkAHref + "\" data-src=\"" + link.TextMarkAHref + "\"></video>")}
					video.SetIALAttr("id", n.ID)
					video.SetIALAttr("updated", util.TimeFromID(n.ID))
					n.InsertBefore(video)
				}
			}
		}
		return ast.WalkContinue
	})
	for _, unlink := range unlinks {
		unlink.Unlink()
	}

	transaction := &Transaction{DoOperations: []*Operation{{Action: "create", Data: tree}}}
	PerformTransactions(&[]*Transaction{transaction})
	WaitForWritingFiles()
	return
}

func removeInvisibleCharsInTitle(title string) string {
	// 不要踢掉 零宽连字符，否则有的 Emoji 会变形 https://github.com/siyuan-note/siyuan/issues/11480
	title = strings.ReplaceAll(title, string(gulu.ZWJ), "__@ZWJ@__")
	title = gulu.Str.RemoveInvisible(title)
	title = strings.ReplaceAll(title, "__@ZWJ@__", string(gulu.ZWJ))
	return title
}

func moveSorts(rootID, fromBox, toBox string) {
	root := treenode.GetBlockTree(rootID)
	if nil == root {
		return
	}

	fromRootSorts := map[string]int{}
	ids := treenode.RootChildIDs(rootID)
	fromConfPath := filepath.Join(util.DataDir, fromBox, ".siyuan", "sort.json")
	fromFullSortIDs := map[string]int{}
	if filelock.IsExist(fromConfPath) {
		data, err := filelock.ReadFile(fromConfPath)
		if nil != err {
			logging.LogErrorf("read sort conf failed: %s", err)
			return
		}

		if err = gulu.JSON.UnmarshalJSON(data, &fromFullSortIDs); nil != err {
			logging.LogErrorf("unmarshal sort conf failed: %s", err)
		}
	}
	for _, id := range ids {
		fromRootSorts[id] = fromFullSortIDs[id]
	}

	toConfPath := filepath.Join(util.DataDir, toBox, ".siyuan", "sort.json")
	toFullSortIDs := map[string]int{}
	if filelock.IsExist(toConfPath) {
		data, err := filelock.ReadFile(toConfPath)
		if nil != err {
			logging.LogErrorf("read sort conf failed: %s", err)
			return
		}

		if err = gulu.JSON.UnmarshalJSON(data, &toFullSortIDs); nil != err {
			logging.LogErrorf("unmarshal sort conf failed: %s", err)
			return
		}
	}

	for id, sortVal := range fromRootSorts {
		toFullSortIDs[id] = sortVal
	}

	data, err := gulu.JSON.MarshalJSON(toFullSortIDs)
	if nil != err {
		logging.LogErrorf("marshal sort conf failed: %s", err)
		return
	}
	if err = filelock.WriteFile(toConfPath, data); nil != err {
		logging.LogErrorf("write sort conf failed: %s", err)
		return
	}
}

func ChangeFileTreeSort(boxID string, paths []string) {
	if 1 > len(paths) {
		return
	}

	WaitForWritingFiles()
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
		logging.LogErrorf("read dir [%s] failed: %s", absParentPath, err)
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
		logging.LogErrorf("create conf dir failed: %s", err)
		return
	}
	confPath := filepath.Join(confDir, "sort.json")
	fullSortIDs := map[string]int{}
	var data []byte
	if filelock.IsExist(confPath) {
		data, err = filelock.ReadFile(confPath)
		if nil != err {
			logging.LogErrorf("read sort conf failed: %s", err)
			return
		}

		if err = gulu.JSON.UnmarshalJSON(data, &fullSortIDs); nil != err {
			logging.LogErrorf("unmarshal sort conf failed: %s", err)
		}
	}

	for sortID, sortVal := range sortFolderIDs {
		fullSortIDs[sortID] = sortVal
	}

	data, err = gulu.JSON.MarshalJSON(fullSortIDs)
	if nil != err {
		logging.LogErrorf("marshal sort conf failed: %s", err)
		return
	}
	if err = filelock.WriteFile(confPath, data); nil != err {
		logging.LogErrorf("write sort conf failed: %s", err)
		return
	}

	IncSync()
}

func (box *Box) fillSort(files *[]*File) {
	confPath := filepath.Join(util.DataDir, box.ID, ".siyuan", "sort.json")
	if !filelock.IsExist(confPath) {
		return
	}

	data, err := filelock.ReadFile(confPath)
	if nil != err {
		logging.LogErrorf("read sort conf failed: %s", err)
		return
	}

	fullSortIDs := map[string]int{}
	if err = gulu.JSON.UnmarshalJSON(data, &fullSortIDs); nil != err {
		logging.LogErrorf("unmarshal sort conf failed: %s", err)
		return
	}

	for _, f := range *files {
		id := strings.TrimSuffix(f.ID, ".sy")
		f.Sort = fullSortIDs[id]
	}
}

func (box *Box) removeSort(ids []string) {
	confPath := filepath.Join(util.DataDir, box.ID, ".siyuan", "sort.json")
	if !filelock.IsExist(confPath) {
		return
	}

	data, err := filelock.ReadFile(confPath)
	if nil != err {
		logging.LogErrorf("read sort conf failed: %s", err)
		return
	}

	fullSortIDs := map[string]int{}
	if err = gulu.JSON.UnmarshalJSON(data, &fullSortIDs); nil != err {
		logging.LogErrorf("unmarshal sort conf failed: %s", err)
		return
	}

	for _, toRemove := range ids {
		delete(fullSortIDs, toRemove)
	}

	data, err = gulu.JSON.MarshalJSON(fullSortIDs)
	if nil != err {
		logging.LogErrorf("marshal sort conf failed: %s", err)
		return
	}
	if err = filelock.WriteFile(confPath, data); nil != err {
		logging.LogErrorf("write sort conf failed: %s", err)
		return
	}
}

func (box *Box) addMinSort(parentPath, id string) {
	docs, _, err := ListDocTree(box.ID, parentPath, util.SortModeUnassigned, false, false, 1)
	if nil != err {
		logging.LogErrorf("list doc tree failed: %s", err)
		return
	}

	sortVal := 0
	if 0 < len(docs) {
		sortVal = docs[0].Sort - 1
	}

	confDir := filepath.Join(util.DataDir, box.ID, ".siyuan")
	if err = os.MkdirAll(confDir, 0755); nil != err {
		logging.LogErrorf("create conf dir failed: %s", err)
		return
	}
	confPath := filepath.Join(confDir, "sort.json")
	fullSortIDs := map[string]int{}
	var data []byte
	if filelock.IsExist(confPath) {
		data, err = filelock.ReadFile(confPath)
		if nil != err {
			logging.LogErrorf("read sort conf failed: %s", err)
			return
		}

		if err = gulu.JSON.UnmarshalJSON(data, &fullSortIDs); nil != err {
			logging.LogErrorf("unmarshal sort conf failed: %s", err)
		}
	}

	fullSortIDs[id] = sortVal

	data, err = gulu.JSON.MarshalJSON(fullSortIDs)
	if nil != err {
		logging.LogErrorf("marshal sort conf failed: %s", err)
		return
	}
	if err = filelock.WriteFile(confPath, data); nil != err {
		logging.LogErrorf("write sort conf failed: %s", err)
		return
	}
}
