// SiYuan - From thought to insight, with agents
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
	"errors"
	"fmt"
	"io/fs"
	"maps"
	"math"
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
	Path             string `json:"path"`
	Name             string `json:"name"` // 标题，即 ial["title"]
	TitleEmpty       bool   `json:"titleEmpty,omitempty"`
	Icon             string `json:"icon"`
	Name1            string `json:"name1"` // 命名，即 ial["name"]
	Alias            string `json:"alias"`
	Memo             string `json:"memo"`
	Bookmark         string `json:"bookmark"`
	ID               string `json:"id"`
	Count            int    `json:"count"`
	Size             uint64 `json:"size"`
	HSize            string `json:"hSize"`
	Mtime            int64  `json:"mtime"`
	CTime            int64  `json:"ctime"`
	HMtime           string `json:"hMtime"`
	HCtime           string `json:"hCtime"`
	Sort             int    `json:"sort"`
	SubFileCount     int    `json:"subFileCount"`
	ChildrenSortMode *int   `json:"childrenSortMode"`

	NewFlashcardCount int `json:"newFlashcardCount"`
	DueFlashcardCount int `json:"dueFlashcardCount"`
	FlashcardCount    int `json:"flashcardCount"`
}

func (box *Box) docFromFileInfo(fileInfo *FileInfo, ial map[string]string) (ret *File) {
	ret = &File{}
	ret.Path = fileInfo.path
	ret.Size = uint64(fileInfo.size)
	ret.Name = ial["title"]
	ret.TitleEmpty = ial[NodeAttrTitleEmpty] == "true"
	if icon, ok := util.FilterIconValue(ial["icon"]); ok {
		ret.Icon = icon
	}
	ret.ID = ial["id"]
	ret.Name1 = ial["name"]
	ret.Alias = ial["alias"]
	ret.Memo = ial["memo"]
	ret.Bookmark = ial["bookmark"]
	ret.ChildrenSortMode = docSortModeFromIAL(ial)
	t, _ := time.ParseInLocation("20060102150405", ret.ID[:14], time.Local)
	ret.CTime = t.Unix()
	ret.HCtime = t.Format("2006-01-02 15:04:05") + ", " + util.HumanizeTime(t, Conf.Lang)
	ret.HSize = humanize.BytesCustomCeil(ret.Size, 2)

	mTime := t
	if updated := ial["updated"]; "" != updated {
		if updatedTime, err := time.ParseInLocation("20060102150405", updated, time.Local); err == nil {
			mTime = updatedTime
		}
	}

	ret.Mtime = mTime.Unix()
	ret.HMtime = mTime.Format("2006-01-02 15:04:05") + ", " + util.HumanizeTime(mTime, Conf.Lang)
	return
}

const DocSortModeAttr = "custom-sy-subdoc-sort-mode"

func IsValidDocSortMode(sortMode int) bool {
	return util.SortModeNameASC <= sortMode && sortMode <= util.SortModeSubDocCountDESC
}

func docSortModeFromIAL(ial map[string]string) *int {
	value := ial[DocSortModeAttr]
	if "" == value {
		return nil
	}
	sortMode, err := strconv.Atoi(value)
	if nil != err || !IsValidDocSortMode(sortMode) {
		return nil
	}
	return &sortMode
}

func (box *Box) docIAL(p string) (ret map[string]string) {
	name := strings.ToLower(filepath.Base(p))
	if !strings.HasSuffix(name, ".sy") {
		return nil
	}

	if _, err := box.validateBoxPath(p); err != nil {
		return nil
	}

	if IsEncryptedBox(box.ID) {
		HoldBoxReadLock(box.ID)
		defer ReleaseBoxReadLock(box.ID)
		if _, err := GetDEKIfUnlocked(box.ID); err != nil {
			return nil
		}
	}

	ret = cache.GetDocIALInBox(p, box.ID)
	if nil != ret {
		return ret
	}

	filePath := filepath.Join(util.DataDir, box.ID, p)
	ret = filesys.DocIAL(filePath)
	if 1 > len(ret) {
		// 加密笔记本的 .sy 解密失败（DEK 未缓存或 box 未解锁）时不应视为损坏，
		// 否则文件会被 moveCorruptedData 移走导致数据丢失。
		// 使用解析后的文件路径反查实际 boxID（可能因 symlink 或路径穿越指向加密 box）
		actualBoxID := ExtractBoxIDFromAssetsPath(filePath)
		if (actualBoxID != "" && IsEncryptedBox(actualBoxID)) || IsEncryptedBox(box.ID) {
			logging.LogWarnf("properties not found in encrypted file [%s], skip moveCorruptedData", filePath)
			return nil
		}
		logging.LogWarnf("properties not found in file [%s]", filePath)
		box.moveCorruptedData(filePath)
		return nil
	}
	cache.PutDocIALInBox(p, box.ID, ret)
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

func SearchDocs(keyword string, flashcard bool, excludeIDs []string) (ret []map[string]string) {
	ret = []map[string]string{}
	var results []searchDocResult

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
		if flashcard && IsEncryptedBox(box.ID) {
			continue
		}
		boxes[box.ID] = box
	}
	queryRootBlocks := func(condition, exactKeyword string, limit int, args ...any) (ret []*sql.Block) {
		seen := map[string]struct{}{}
		appendBlocks := func(blocks []*sql.Block) {
			for _, block := range blocks {
				if block == nil {
					continue
				}
				key := block.Box + "\x00" + block.ID
				if _, exists := seen[key]; exists {
					continue
				}
				seen[key] = struct{}{}
				ret = append(ret, block)
				if len(ret) >= limit {
					return
				}
			}
		}
		appendBlocks(sql.QueryRootBlockByCondition(condition, exactKeyword, limit, args...))
		if len(ret) >= limit {
			return ret[:limit]
		}
		for boxID := range boxes {
			if !IsEncryptedBox(boxID) {
				continue
			}
			appendBlocks(sql.QueryRootBlockByConditionInBox(condition, exactKeyword, limit-len(ret), boxID, args...))
			if len(ret) >= limit {
				break
			}
		}
		return
	}

	keyword = strings.TrimSpace(keyword)

	var rootBlocks []*sql.Block
	if ast.IsNodeIDPattern(keyword) {
		rootBlocks = queryRootBlocks("id = ?", keyword, 1, keyword)
	} else {
		keywords := strings.Fields(keyword)
		if 0 < len(keywords) {
			for _, box := range boxes {
				if containsSearchDocKeyword(box.Name, keywords, Conf.Search.CaseSensitive) {
					data := map[string]string{"path": "/", "hPath": box.Name + "/", "box": box.ID, "boxIcon": box.Icon}
					if flashcard {
						newFlashcardCount, dueFlashcardCount, flashcardCount := countBoxFlashcard(box.ID, deck, deckBlockIDs)
						if 1 > flashcardCount {
							continue
						}
						data["newFlashcardCount"] = strconv.Itoa(newFlashcardCount)
						data["dueFlashcardCount"] = strconv.Itoa(dueFlashcardCount)
						data["flashcardCount"] = strconv.Itoa(flashcardCount)
					}
					results = append(results, searchDocResult{data: data, exact: isExactSearchDocMatch(box.Name, keyword, Conf.Search.CaseSensitive)})
				}
			}

			condition, args := buildSearchDocsCondition(keywords, excludeIDs, Conf.Search.Name, Conf.Search.Alias, Conf.Search.Memo)
			rootBlocks = queryRootBlocks(condition, keyword, Conf.Search.Limit, args...)
		} else {
			for _, box := range boxes {
				data := map[string]string{"path": "/", "hPath": box.Name + "/", "box": box.ID, "boxIcon": box.Icon}
				if flashcard {
					newFlashcardCount, dueFlashcardCount, flashcardCount := countBoxFlashcard(box.ID, deck, deckBlockIDs)
					if 1 > flashcardCount {
						continue
					}
					data["newFlashcardCount"] = strconv.Itoa(newFlashcardCount)
					data["dueFlashcardCount"] = strconv.Itoa(dueFlashcardCount)
					data["flashcardCount"] = strconv.Itoa(flashcardCount)
				}
				results = append(results, searchDocResult{data: data})
			}
		}
	}

	for _, rootBlock := range rootBlocks {
		b := boxes[rootBlock.Box]
		if nil == b {
			continue
		}
		if !IsBoxDocEnabled() && IsBoxDoc(rootBlock.Box, rootBlock.RootID) {
			continue
		}
		hPath := b.Name + rootBlock.HPath
		data := map[string]string{"path": rootBlock.Path, "hPath": hPath, "box": rootBlock.Box, "boxIcon": b.Icon}
		if flashcard {
			newFlashcardCount, dueFlashcardCount, flashcardCount := countTreeFlashcard(rootBlock.ID, deck, deckBlockIDs)
			if 1 > flashcardCount {
				continue
			}
			data["newFlashcardCount"] = strconv.Itoa(newFlashcardCount)
			data["dueFlashcardCount"] = strconv.Itoa(dueFlashcardCount)
			data["flashcardCount"] = strconv.Itoa(flashcardCount)
		}
		results = append(results, searchDocResult{data: data, exact: isExactSearchDocMatch(rootBlock.Content, keyword, Conf.Search.CaseSensitive)})
	}

	sortSearchDocResults(results)
	for _, result := range results {
		ret = append(ret, result.data)
	}
	return
}

func sortSearchDocResults(results []searchDocResult) {
	sort.SliceStable(results, func(i, j int) bool {
		if results[i].exact != results[j].exact {
			return results[i].exact
		}
		return results[i].data["hPath"] < results[j].data["hPath"]
	})
}

type searchDocResult struct {
	data  map[string]string
	exact bool
}

func containsSearchDocKeyword(value string, keywords []string, caseSensitive bool) bool {
	if !caseSensitive {
		value = strings.ToLower(value)
	}
	for _, keyword := range keywords {
		if !caseSensitive {
			keyword = strings.ToLower(keyword)
		}
		if strings.Contains(value, keyword) {
			return true
		}
	}
	return false
}

func isExactSearchDocMatch(value, keyword string, caseSensitive bool) bool {
	if caseSensitive {
		return value == keyword
	}
	return strings.EqualFold(value, keyword)
}

func buildSearchDocsCondition(keywords, excludeIDs []string, searchName, searchAlias, searchMemo bool) (condition string, args []any) {
	var ret strings.Builder
	for i, keyword := range keywords {
		pattern := "%" + escapeSearchDocLikePattern(keyword) + "%"
		ret.WriteString("(hpath LIKE ? ESCAPE '\\'")
		args = append(args, pattern)
		if searchName {
			ret.WriteString(" OR name LIKE ? ESCAPE '\\'")
			args = append(args, pattern)
		}
		if searchAlias {
			ret.WriteString(" OR alias LIKE ? ESCAPE '\\'")
			args = append(args, pattern)
		}
		if searchMemo {
			ret.WriteString(" OR memo LIKE ? ESCAPE '\\'")
			args = append(args, pattern)
		}
		ret.WriteString(")")
		if i < len(keywords)-1 {
			ret.WriteString(" AND ")
		}
	}
	for _, excludeID := range excludeIDs {
		ret.WriteString(" AND path NOT LIKE ? ESCAPE '\\'")
		args = append(args, "%"+escapeSearchDocLikePattern(excludeID)+"%")
	}
	return ret.String(), args
}

func escapeSearchDocLikePattern(s string) string {
	var ret strings.Builder
	ret.Grow(len(s))
	for _, r := range s {
		if '%' == r || '_' == r || '\\' == r {
			ret.WriteRune('\\')
		}
		ret.WriteRune(r)
	}
	return ret.String()
}

type FileInfo struct {
	path  string
	name  string
	size  int64
	isdir bool
}

// ResolveDocTreeSortMode 按当前父文档、最近祖先文档、笔记本和全局配置的顺序解析子文档排序方式。
func ResolveDocTreeSortMode(boxID, listPath string) (sortMode int, err error) {
	box := Conf.Box(boxID)
	if nil == box {
		return 0, errors.New(Conf.Language(0))
	}

	normalized, err := box.validateBoxPath(listPath)
	if nil != err {
		return 0, err
	}
	normalized = filepath.ToSlash(normalized)
	if "" != normalized {
		docPath := "/" + strings.TrimPrefix(path.Clean("/"+normalized), "/")
		if !strings.HasSuffix(docPath, ".sy") {
			docPath += ".sy"
		}

		for "" != docPath && !IsBoxDocPath(boxID, docPath) {
			// 仅探测确实存在的文档，避免将同步中的临时缺失误判为损坏数据。
			if box.Exist(docPath) {
				if declared := docSortModeFromIAL(box.docIAL(docPath)); nil != declared {
					return *declared, nil
				}
			}

			docDir := strings.TrimSuffix(docPath, ".sy")
			parentDir := path.Dir(docDir)
			if "/" == parentDir || "." == parentDir {
				break
			}
			docPath = parentDir + ".sy"
		}
	}

	sortMode = Conf.FileTree.Sort
	boxConf := box.GetConf()
	if util.SortModeFileTree != boxConf.SortMode {
		sortMode = boxConf.SortMode
	}
	return
}

func ListDocTree(boxID, listPath string, sortMode int, flashcard, showHidden bool, maxListCount int) (ret []*File, totals int, err error) {
	//os.MkdirAll("pprof", 0755)
	//cpuProfile, _ := os.Create("pprof/cpu_profile_list_doc_tree")
	//pprof.StartCPUProfile(cpuProfile)
	//defer pprof.StopCPUProfile()

	ret = []*File{}
	if flashcard && IsEncryptedBox(boxID) {
		return nil, 0, errors.New(Conf.Language(313))
	}

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

	if util.SortModeUnassigned == sortMode {
		if sortMode, err = ResolveDocTreeSortMode(boxID, listPath); nil != err {
			return
		}
	}

	var files []*FileInfo
	start := time.Now()
	files, totals, err = box.Ls(listPath)
	if err != nil {
		return
	}
	elapsed := time.Since(start).Milliseconds()
	if 100 < elapsed {
		logging.LogWarnf("ls elapsed [%dms]", elapsed)
	}

	start = time.Now()
	boxLocalPath := filepath.Join(util.DataDir, box.ID)
	var docs []*File
	for _, file := range files {
		if "/" == listPath && box.ID == util.GetTreeID(file.path) {
			continue
		}
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
				if !showHidden && "true" == ial[DocHiddenAttr] {
					continue
				}

				doc := box.docFromFileInfo(parentDocFile, ial)
				subFiles, err := os.ReadDir(filepath.Join(boxLocalPath, file.path))
				if err == nil {
					for _, subFile := range subFiles {
						subDocFilePath := path.Join(file.path, subFile.Name())
						if subIAL := box.docIAL(subDocFilePath); "true" == subIAL[DocHiddenAttr] {
							continue
						}

						if strings.HasSuffix(subFile.Name(), ".sy") {
							doc.SubFileCount++
						}
					}
				}

				if flashcard {
					rootID := util.GetTreeID(parentDocPath)
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
		} else {
			if strings.HasSuffix(file.name, ".sy") && !ast.IsNodeIDPattern(strings.TrimSuffix(file.name, ".sy")) {
				// 不以块 ID 命名的 .sy 文件不应该被加载到思源中 https://github.com/siyuan-note/siyuan/issues/16089
				continue
			}
		}

		subFolder := filepath.Join(boxLocalPath, strings.TrimSuffix(file.path, ".sy"))
		if gulu.File.IsDir(subFolder) {
			continue
		}

		if ial := box.docIAL(file.path); nil != ial {
			if !showHidden && "true" == ial[DocHiddenAttr] {
				continue
			}

			doc := box.docFromFileInfo(file, ial)

			if flashcard {
				rootID := util.GetTreeID(file.path)
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
	elapsed = time.Since(start).Milliseconds()
	if 500 < elapsed {
		logging.LogWarnf("list doc tree [%s] build docs [%d] elapsed [%dms]", listPath, len(docs), elapsed)
	}

	start = time.Now()
	refCount := sql.QueryRootBlockRefCount()
	for _, doc := range docs {
		if count := refCount[doc.ID]; 0 < count {
			doc.Count = count
		}
	}
	elapsed = time.Since(start).Milliseconds()
	if 500 < elapsed {
		logging.LogWarnf("query root block ref count elapsed [%dms]", elapsed)
	}

	start = time.Now()
	switch sortMode {
	case util.SortModeNameASC:
		emptyKey := Conf.Language(16)
		sort.Slice(docs, func(i, j int) bool {
			ni, nj := docs[i].Name, docs[j].Name
			if docs[i].TitleEmpty {
				ni = emptyKey
			}
			if docs[j].TitleEmpty {
				nj = emptyKey
			}
			return util.PinYinCompare4FileTree(ni, nj)
		})
	case util.SortModeNameDESC:
		emptyKey := Conf.Language(16)
		sort.Slice(docs, func(i, j int) bool {
			ni, nj := docs[i].Name, docs[j].Name
			if docs[i].TitleEmpty {
				ni = emptyKey
			}
			if docs[j].TitleEmpty {
				nj = emptyKey
			}
			return util.PinYinCompare4FileTree(nj, ni)
		})
	case util.SortModeUpdatedASC:
		sort.Slice(docs, func(i, j int) bool { return docs[i].Mtime < docs[j].Mtime })
	case util.SortModeUpdatedDESC:
		sort.Slice(docs, func(i, j int) bool { return docs[i].Mtime > docs[j].Mtime })
	case util.SortModeAlphanumASC:
		emptyKey := Conf.Language(16)
		sort.Slice(docs, func(i, j int) bool {
			ni, nj := docs[i].Name, docs[j].Name
			if docs[i].TitleEmpty {
				ni = emptyKey
			}
			if docs[j].TitleEmpty {
				nj = emptyKey
			}
			return util.NaturalCompare(ni, nj)
		})
	case util.SortModeAlphanumDESC:
		emptyKey := Conf.Language(16)
		sort.Slice(docs, func(i, j int) bool {
			ni, nj := docs[i].Name, docs[j].Name
			if docs[i].TitleEmpty {
				ni = emptyKey
			}
			if docs[j].TitleEmpty {
				nj = emptyKey
			}
			return util.NaturalCompare(nj, ni)
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

	elapsed = time.Since(start).Milliseconds()
	if 200 < elapsed {
		logging.LogInfof("sort docs elapsed [%dms]", elapsed)
	}
	return
}

func GetDoc(startID, endID, id string, index int, query string, queryTypes, querySubTypes map[string]bool, queryMethod, mode int, size int, isBacklink bool, originalRefBlockIDs map[string]string, highlight, includeDocInfo bool) (
	blockCount int, dom, parentID, parent2ID, rootID, typ string, eof, scroll bool, boxID, docPath string, isBacklinkExpand bool, keywords []string, headingNumbers map[string]string, docInfo *BlockInfo, err error) {
	return GetDocInBox(startID, endID, id, index, query, queryTypes, querySubTypes, queryMethod, mode, size, isBacklink, originalRefBlockIDs, highlight, includeDocInfo, "")
}

// GetDocInBox 与 GetDoc 一致，但按 boxID 路由到加密 db 或全局 db。
// 加密笔记本打开文档时传入 boxID，blocktree/content 查询走加密 db；boxID 为空时 fall-through 全局 db。
func GetDocInBox(startID, endID, id string, index int, query string, queryTypes, querySubTypes map[string]bool, queryMethod, mode int, size int, isBacklink bool, originalRefBlockIDs map[string]string, highlight, includeDocInfo bool, boxID string) (
	blockCount int, dom, parentID, parent2ID, rootID, typ string, eof, scroll bool, boxIDOut, docPath string, isBacklinkExpand bool, keywords []string, headingNumbers map[string]string, docInfo *BlockInfo, err error) {
	//os.MkdirAll("pprof", 0755)
	//cpuProfile, _ := os.Create("pprof/GetDoc")
	//pprof.StartCPUProfile(cpuProfile)
	//defer pprof.StopCPUProfile()

	FlushTxQueue() // 写入数据时阻塞，避免获取到的数据不一致

	inputIndex := index
	tree, err := loadTreeByBlockIDInBox0(id, boxID, false)
	if err != nil {
		if errors.Is(err, ErrBlockNotFound) {
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
	if includeDocInfo {
		docInfo = getDocInfoByTree(tree.Root.ID, tree)
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

	located := false
	isDoc := ast.NodeDocument == node.Type
	isHeading := ast.NodeHeading == node.Type

	boxIDOut = node.Box
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
					if parentFoldedHeading := treenode.GetParentFoldedHeading(node); nil != parentFoldedHeading {
						// 加载到折叠标题下方块的话需要回溯到上方标题块
						node = parentFoldedHeading
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
	if shouldReturnHeadingNumbers(mode, isBacklink) {
		headingNumbers = map[string]string{}
		if headingNumberEnabled(tree, Conf.Editor.HeadingNumber) {
			headingNumbers = headingNumberLabels(tree, Conf.Editor.HeadingNumberFormat)
		}
	}
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
		nodes, isBacklinkExpand = getBacklinkRenderNodes(node, originalRefBlockIDs)
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

	refCount := sql.QueryRootChildrenRefCountInBox(rootID, boxID)
	virtualBlockRefKeywords := getBlockVirtualRefKeywords(tree.Root, tree.Box)

	subTree := &parse.Tree{ID: rootID, Root: &ast.Node{Type: ast.NodeDocument}, Marks: tree.Marks}

	query = filterQueryInvisibleChars(query)
	if "" != query && (0 == queryMethod || 1 == queryMethod || 3 == queryMethod) { // 只有关键字、查询语法和正则表达式搜索支持高亮
		typeFilter := buildTypeFilter(queryTypes, querySubTypes)
		switch queryMethod {
		case 0:
			query = stringQuery(query)
			keywords = highlightByFTSInBox(query, typeFilter, rootID, boxID)
		case 1:
			keywords = highlightByFTSInBox(query, typeFilter, rootID, boxID)
		case 3:
			keywords = highlightByRegexpInBox(query, typeFilter, rootID, boxID)
		}
	}

	existKeywords := 0 < len(keywords)
	// 在 AppendChild 搬移节点前先做完顶层单点查询，避免兄弟链被改写后 IsInFoldedHeading 误判
	topInFoldedHeading := map[string]bool{}
	for _, n := range nodes {
		if treenode.IsInFoldedHeading(n, nil) {
			topInFoldedHeading[n.ID] = true
		}
	}
	for _, n := range nodes {
		var unlinks []*ast.Node

		// 顶层块整体位于折叠标题下方时用单点查询判断（不依赖子块 heading-fold）：
		// 非当前 ID 的悬浮或文档加载场景整块剔除；当前 ID 的悬浮保留
		// The referenced block under the folded heading cannot be hovered to view https://github.com/siyuan-note/siyuan/issues/9582
		nInFoldedHeading := topInFoldedHeading[n.ID]
		if nInFoldedHeading && ((0 != mode && id != n.ID) || isDoc) {
			continue
		}

		// 一次正向扫描收集 n 子树内被折叠标题盖住的后代，避免逐块 O(N²) 回溯 IsInFoldedHeading
		foldHidden := map[*ast.Node]bool{}
		for _, h := range treenode.CollectFoldHiddenNodes(n) {
			foldHidden[h] = true
		}

		ast.Walk(n, func(n *ast.Node, entering bool) ast.WalkStatus {
			if !entering {
				return ast.WalkContinue
			}

			if n.IsBlock() {
				if foldHidden[n] {
					// 被嵌套折叠标题盖住的整棵子树剔除，无需继续递归其内部
					unlinks = append(unlinks, n)
					return ast.WalkSkipChildren
				}

				// 旧版 heading-fold 仅用于兼容读取，不能输出为块自身的折叠状态。
				treenode.ClearLegacyHeadingFold(n)

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

				if existKeywords && id == n.ID {
					inlines := n.ChildrenByType(ast.NodeTextMark)
					for _, inline := range inlines {
						if inline.IsTextMarkType("inline-memo") && util.ContainsSubStr(inline.TextMarkInlineMemoContent, keywords) {
							// 支持行级备注搜索定位 https://github.com/siyuan-note/siyuan/issues/13465
							keywords = append(keywords, inline.TextMarkTextContent)
						}
					}
				}
			} else {
				if highlight && existKeywords {
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
							markedCode, matched := search.EncloseHighlightingRaw(code, keywords, search.SearchMarkLeft, search.SearchMarkRight, Conf.Search.CaseSensitive, false)
							if matched {
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
			}
			return ast.WalkContinue
		})

		for _, unlink := range unlinks {
			unlink.Unlink()
		}

		subTree.Root.AppendChild(n)
	}

	luteEngine.RenderOptions.NodeIndexStart = index
	dom = luteEngine.Tree2BlockDOM(subTree, luteEngine.RenderOptions, luteEngine.ParseOptions)

	if 1 > len(keywords) {
		keywords = []string{}
	}
	for i, keyword := range keywords {
		keyword = strings.TrimPrefix(keyword, "#")
		keyword = strings.TrimSuffix(keyword, "#")
		keywords[i] = keyword
	}
	keywords = gulu.Str.RemoveDuplicatedElem(keywords)
	return
}

func foldedHiddenSiblings(anchor *ast.Node) (hidden map[string]bool) {
	hidden = map[string]bool{}
	if nil == anchor || nil == anchor.Parent {
		return
	}

	var stack treenode.FoldHeadingStack
	for n := anchor.Parent.FirstChild; nil != n; n = n.Next {
		stack.Enter(n)
		if stack.Hidden() {
			hidden[n.ID] = true
		}
	}
	return
}

// foldHeadingStackBefore 通过扫描 node 之前的同级兄弟节点，构造到达 node 之前（不含 node）的折叠层级栈。
func foldHeadingStackBefore(node *ast.Node) (stack treenode.FoldHeadingStack) {
	if nil == node || nil == node.Parent {
		return
	}

	for n := node.Parent.FirstChild; nil != n && n != node; n = n.Next {
		stack.Enter(n)
	}
	return
}

func loadNodesByStartEnd(tree *parse.Tree, startID, endID string) (nodes []*ast.Node, eof bool) {
	node := treenode.GetNodeInTree(tree, startID)
	if nil == node {
		return
	}

	// 用折叠层级栈正向扫描跳过被折叠标题盖住的块
	stack := foldHeadingStackBefore(node)
	stack.Enter(node)
	nodes = append(nodes, node)
	for n := node.Next; nil != n; n = n.Next {
		stack.Enter(n)
		if stack.Hidden() {
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

		if len(nodes) >= Conf.Editor.DynamicLoadBlocks {
			// 如果加载到指定数量的块则停止加载
			break
		}
	}
	return
}

func loadNodesByMode(node *ast.Node, inputIndex, mode, size int, isDoc, isHeading bool) (nodes []*ast.Node, eof bool) {
	if 2 == mode /* 向下 */ {
		next := node.Next
		if ast.NodeHeading == node.Type && treenode.IsSelfFolded(node) {
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

	// 一次正向扫描顶层同级子块，标记被折叠标题盖住的隐藏块，向上 / 双向遍历据此判断，避免逐块 O(N²) 回溯
	hidden := foldedHiddenSiblings(node)

	count := 0
	switch mode {
	case 0: // 仅加载当前 ID
		nodes = append(nodes, node)
		if isDoc {
			// 用折叠层级栈正向扫描顶层同级子块（含 node 自身折叠），避免嵌套折叠漏网
			stack := foldHeadingStackBefore(node)
			stack.Enter(node)
			for n := node.Next; nil != n; n = n.Next {
				stack.Enter(n)
				if stack.Hidden() {
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
			// 聚焦标题：先把当前标题入栈，自身 fold=1 时不摊开下方内容（与旧 IsInFoldedHeading(n, node) 一致）；
			// 未折叠时仍用栈省略更深嵌套折叠 https://github.com/siyuan-note/siyuan/issues/4997
			level := node.HeadingLevel
			var stack treenode.FoldHeadingStack
			stack.Enter(node)
			for n := node.Next; nil != n; n = n.Next {
				if ast.NodeHeading == n.Type && n.HeadingLevel <= level {
					break
				}
				stack.Enter(n)
				if stack.Hidden() {
					continue
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
			if hidden[n.ID] {
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
			if hidden[n.ID] {
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
		// 先恢复到 node 处的折叠栈（含 node 自身），与旧 IsInFoldedHeading(n, node) 一致：
		// 若 node 为折叠标题，则跳过其下方被盖住的块
		stack := foldHeadingStackBefore(node)
		stack.Enter(node)
		for n := node.Next; /* 从下一个节点开始加载 */ nil != n; n = n.Next {
			stack.Enter(n)
			if stack.Hidden() {
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
			if hidden[n.ID] {
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
			if hidden[n.ID] {
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
	isNew := !filelock.IsExist(filepath.Join(util.DataDir, tree.Box, tree.Path))
	size, err := filesys.WriteTree(tree)
	if err != nil {
		return
	}
	sql.UpsertTreeQueue(tree)
	refreshDocInfoWithSize(tree, size)
	if isNew {
		refreshBoxDocInfo(tree)
	}
	return
}

func indexWriteTreeIndexQueue(tree *parse.Tree) (err error) {
	treenode.IndexBlockTree(tree)
	_, err = filesys.WriteTree(tree)
	if err != nil {
		return
	}
	sql.IndexTreeQueue(tree)
	return
}

func indexWriteTreeUpsertQueue(tree *parse.Tree) (err error) {
	treenode.UpsertBlockTree(tree)
	return writeTreeUpsertQueue(tree)
}

func renameWriteJSONQueue(tree *parse.Tree) (err error) {
	size, err := filesys.WriteTree(tree)
	if err != nil {
		return
	}
	sql.RenameTreeQueue(tree)
	treenode.UpsertBlockTree(tree)
	refreshDocInfoWithSize(tree, size)
	return
}

func DuplicateDoc(tree *parse.Tree) {
	msgId := util.PushMsg(Conf.Language(116), 30000)
	defer util.PushClearMsg(msgId)

	isBoxDoc := IsBoxDoc(tree.Box, tree.ID)
	previousPath := tree.Path
	resetTree(tree, "Duplicated", false)
	if isBoxDoc {
		removeBoxDocHiddenAttr(tree)
	}

	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering || !n.IsBlock() {
			return ast.WalkContinue
		}

		// 复制为副本时移除数据库绑定状态 https://github.com/siyuan-note/siyuan/issues/12294
		n.RemoveIALAttr(av.NodeAttrNameAvs)
		n.RemoveIALAttr(av.NodeAttrViewNames)
		n.RemoveIALAttrsByPrefix(av.NodeAttrViewStaticText)

		// 复制为副本时移除闪卡相关属性 https://github.com/siyuan-note/siyuan/issues/13987
		n.RemoveIALAttr(NodeAttrRiffDecks)

		return ast.WalkContinue
	})

	createTreeTx(tree)
	box := Conf.Box(tree.Box)
	if nil != box {
		box.addSort(previousPath, tree.ID)
	}

	FlushTxQueue()
	arg := map[string]any{}
	arg["listDocTree"] = true
	PushCreate(box, tree.Path, arg)
}

func createTreeTx(tree *parse.Tree) {
	transaction := &Transaction{DoOperations: []*Operation{{Action: "create", Data: tree}}}
	PerformTransactions(&[]*Transaction{transaction})
}

var createDocLock = sync.Mutex{}

func CreateDocByMd(boxID, p, title, md string, sorts []string, arg map[string]any) (tree *parse.Tree, err error) {
	createDocLock.Lock()
	defer createDocLock.Unlock()

	box, err := getOpenedBox(boxID)
	if nil != err {
		return
	}

	luteEngine := util.NewLute()
	dom := luteEngine.Md2BlockDOM(md, false)
	tree, err = createDoc(box.ID, p, title, dom, false)
	if err != nil {
		return
	}

	FlushTxQueue()
	if 0 < len(sorts) {
		ChangeFileTreeSort(box.ID, sorts)
	} else {
		box.setSortByConf(path.Dir(tree.Path), tree.ID)
	}

	FlushTxQueue()
	applyRequestedDocCreateTemplate(arg, md, tree.Root.ID)
	PushCreate(box, p, arg)
	return
}

func CreateWithMarkdown(tags, boxID, hPath, md, parentID, id string, withMath bool, clippingHref string, arg map[string]any) (retID string, err error) {
	createDocLock.Lock()
	defer createDocLock.Unlock()

	box := Conf.Box(boxID)
	if nil == box {
		err = errors.New(Conf.Language(0))
		return
	}

	FlushTxQueue()
	luteEngine := util.NewLute()
	if withMath {
		luteEngine.SetInlineMath(true)
	}
	luteEngine.SetHTMLTag2TextMark(true)
	if strings.HasPrefix(clippingHref, "https://ld246.com/article/") || strings.HasPrefix(clippingHref, "https://liuyun.io/article/") {
		// 改进链滴剪藏 https://github.com/siyuan-note/siyuan/issues/13117
		enableLuteInlineSyntax(luteEngine)
	}
	dom := luteEngine.Md2BlockDOM(md, false)
	titleEmpty := false
	if nil != arg {
		if titleEmptyArg, ok := arg["titleEmpty"]; ok {
			titleEmpty = titleEmptyArg.(bool)
		}
	}
	retID, err = createDocsByHPath(box.ID, hPath, dom, parentID, id, titleEmpty)

	nameValues := map[string]string{}
	tags = strings.TrimSpace(tags)
	tags = strings.ReplaceAll(tags, "，", ",")
	tagArray := strings.Split(tags, ",")
	var tmp []string
	for _, tag := range tagArray {
		tmp = append(tmp, strings.TrimSpace(tag))
	}
	tags = strings.Join(tmp, ",")
	nameValues["tags"] = tags
	SetBlockAttrs(retID, nameValues)

	FlushTxQueue()

	bt := treenode.GetBlockTree(retID)
	if nil == bt {
		logging.LogWarnf("get block tree by id [%s] failed after create", retID)
		return
	}
	box.setSortByConf(path.Dir(bt.Path), retID)

	FlushTxQueue()
	applyRequestedDocCreateTemplate(arg, md, retID)
	PushCreate(box, bt.Path, arg)
	return
}

func applyRequestedDocCreateTemplate(arg map[string]any, markdown, docID string) {
	if nil == arg || "" != strings.TrimSpace(markdown) {
		return
	}
	templatePath, _ := arg["docCreateTemplatePath"].(string)
	if "" == strings.TrimSpace(templatePath) {
		return
	}
	if err := applyDocContentTemplateAfterIndex(templatePath, docID); nil != err {
		logging.LogWarnf("apply document creation template [%s] failed: %s", templatePath, err)
		util.PushErrMsg(err.Error(), 7000)
	}
}

// ResolveDocCreateSaveLocation 按笔记本配置和全局配置解析新建文档的存放位置。
func ResolveDocCreateSaveLocation(currentBoxID string) (boxID, pathTemplate string) {
	pathTemplate = Conf.FileTree.DocCreateSavePath
	if box := Conf.Box(currentBoxID); nil != box {
		boxConf := box.GetConf()
		boxID = boxConf.DocCreateSaveBox
		pathTemplate = boxConf.DocCreateSavePath
	}
	if "" == boxID && "" == pathTemplate {
		boxID = Conf.FileTree.DocCreateSaveBox
	}
	if "" != boxID && nil == Conf.Box(boxID) {
		boxID = currentBoxID
	}
	if "" == boxID {
		boxID = currentBoxID
	}
	if "" == pathTemplate {
		pathTemplate = Conf.FileTree.DocCreateSavePath
	}
	return
}

const (
	DailyNoteAttrPrefix = "custom-dailynote-"
	NodeAttrTitleEmpty  = "custom-sy-title-empty"
	DocHiddenAttr       = "custom-hidden"
)

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

	hPath, err := RenderGoTemplateInBox(boxConf.DailyNoteSavePath, box.ID)
	if err != nil {
		return
	}

	FlushTxQueue()

	hPath = util.TrimSpaceInPath(hPath)
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
		if tree.Root.IALAttr(DailyNoteAttrPrefix+date) == "" {
			tree.Root.SetIALAttr(DailyNoteAttrPrefix+date, date)
			if err = indexWriteTreeUpsertQueue(tree); err != nil {
				return
			}
		}
		return
	}

	id, err := createDocsByHPath(box.ID, hPath, "", "", "", false)
	if err != nil {
		return
	}

	if "" != boxConf.DailyNoteTemplatePath {
		sql.FlushQueue()
		if renderErr := applyDocContentTemplate(boxConf.DailyNoteTemplatePath, id); nil != renderErr {
			logging.LogWarnf("render daily note template [%s] failed: %s", boxConf.DailyNoteTemplatePath, renderErr)
		}
	}
	IncSync()

	FlushTxQueue()

	tree, err := LoadTreeByBlockID(id)
	if err != nil {
		logging.LogErrorf("load tree by block id [%s] failed: %v", id, err)
		return
	}
	p = tree.Path
	date := time.Now().Format("20060102")
	tree.Root.SetIALAttr(DailyNoteAttrPrefix+date, date)
	if err = indexWriteTreeUpsertQueue(tree); err != nil {
		return
	}
	if "" != boxConf.DailyNoteTemplatePath {
		sql.FlushQueue()
	}

	return
}

func GetHPathByPath(boxID, p string) (hPath string, err error) {
	if "/" == p {
		hPath = "/"
		return
	}
	if IsBoxDocPath(boxID, p) {
		hPath = "/"
		return
	}

	bt := treenode.GetBlockTreeByBoxPath(boxID, p)
	if nil == bt {
		err = ErrBlockNotFound
		return
	}
	hPath = bt.HPath
	return
}

func GetHPathsByPaths(paths []string) (hPaths []string, err error) {
	pathsBoxes := getBoxesByPaths(paths)
	for p, box := range pathsBoxes {
		if nil == box {
			logging.LogWarnf("box not found by path [%s]", p)
			continue
		}

		bt := treenode.GetBlockTreeByBoxPath(box.ID, p)
		if nil == bt {
			logging.LogWarnf("block tree not found by path [%s]", p)
			continue
		}

		if IsBoxDoc(box.ID, bt.RootID) {
			hPaths = append(hPaths, box.Name)
		} else {
			hPaths = append(hPaths, box.Name+bt.HPath)
		}
	}
	return
}

func GetHPathByID(id string) (hPath string, err error) {
	tree, err := LoadTreeByBlockID(id)
	if err != nil {
		return
	}
	if IsBoxDoc(tree.Box, tree.ID) {
		hPath = "/"
		return
	}
	hPath = tree.HPath
	return
}

func GetPathByID(id string) (path, boxID string, err error) {
	tree, err := loadTreeByBlockIDWithoutNotFoundLog(id)
	if err != nil {
		return
	}

	path = tree.Path
	boxID = tree.Box
	return
}

func GetFullHPathByID(id string) (hPath string, err error) {
	tree, err := LoadTreeByBlockID(id)
	if err != nil {
		return
	}

	box := Conf.Box(tree.Box)
	if nil == box {
		err = ErrBoxNotFound
		return
	}
	if IsBoxDoc(box.ID, tree.ID) {
		hPath = box.Name
		return
	}
	hPath = box.Name + tree.HPath
	return
}

func GetIDsByHPath(hpath, boxID string) (ret []string, err error) {
	ret = []string{}
	if IsBoxDocEnabled() && "/" == hpath {
		if box := Conf.Box(boxID); nil != box {
			return []string{box.ID}, nil
		}
	}
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

type moveDocsRefreshKey struct {
	boxID  string
	rootID string
}

type moveDocsRefresh struct {
	parents   map[moveDocsRefreshKey]*parse.Tree
	notebooks map[string]struct{}
}

type moveDocResult struct {
	FromNotebook string `json:"fromNotebook"`
	FromPath     string `json:"fromPath"`
	ToNotebook   string `json:"toNotebook"`
	ToPath       string `json:"toPath"`
	NewPath      string `json:"newPath"`
}

func newMoveDocsRefresh() *moveDocsRefresh {
	return &moveDocsRefresh{
		parents:   map[moveDocsRefreshKey]*parse.Tree{},
		notebooks: map[string]struct{}{},
	}
}

func (refresh *moveDocsRefresh) addParent(tree *parse.Tree) {
	if nil == refresh || nil == tree {
		return
	}
	key := moveDocsRefreshKey{boxID: tree.Box, rootID: tree.ID}
	refresh.parents[key] = tree
}

func (refresh *moveDocsRefresh) addNotebook(boxID string) {
	if nil == refresh || "" == boxID {
		return
	}
	refresh.notebooks[boxID] = struct{}{}
}

func (refresh *moveDocsRefresh) flush() {
	refresh.flushWith(refreshDocInfo, refreshBoxDocInfoByBoxID)
}

func (refresh *moveDocsRefresh) flushWith(refreshParent func(*parse.Tree), refreshNotebook func(string)) {
	if nil == refresh {
		return
	}
	for _, tree := range refresh.parents {
		refreshParent(tree)
	}
	for boxID := range refresh.notebooks {
		refreshNotebook(boxID)
	}
}

func orderMoveDocPaths(fromPaths []string, pathsBoxes map[string]*Box) (ret []string) {
	canonicalPaths := map[string]string{}
	for canonicalPath := range pathsBoxes {
		canonicalPaths[util.GetTreeID(canonicalPath)] = canonicalPath
	}
	addedPaths := map[string]struct{}{}
	for _, fromPath := range fromPaths {
		canonicalPath := canonicalPaths[util.GetTreeID(fromPath)]
		if "" == canonicalPath {
			continue
		}
		if _, ok := addedPaths[canonicalPath]; ok {
			continue
		}
		ret = append(ret, canonicalPath)
		addedPaths[canonicalPath] = struct{}{}
	}
	return
}

func MoveDocs(fromPaths []string, toBoxID, toPath string, callback any) (err error) {
	toBox := Conf.Box(toBoxID)
	if nil == toBox {
		err = errors.New(Conf.Language(0))
		return
	}
	toPath = normalizeBoxDocTarget(toBoxID, toPath)
	pathsBoxes, err := getBoxesByPathsStrict(fromPaths)
	if err != nil {
		return
	}

	fromPaths = util.FilterMoveDocFromPaths(fromPaths, toPath)
	if 1 > len(fromPaths) {
		return
	}

	fromPaths = orderMoveDocPaths(fromPaths, pathsBoxes)

	for _, fromPath := range fromPaths {
		fromBox := pathsBoxes[fromPath]
		if nil != fromBox && IsBoxDocPath(fromBox.ID, fromPath) {
			return errors.New(Conf.Language(341))
		}
	}

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
	for _, fromPath := range fromPaths {
		fromBox := pathsBoxes[fromPath]
		childDepth := util.GetChildDocDepth(filepath.Join(util.DataDir, fromBox.ID, fromPath))
		if depth := strings.Count(toPath, "/") + childDepth; 6 < depth && !Conf.FileTree.AllowCreateDeeper {
			err = errors.New(Conf.Language(118))
			return
		}
	}

	// 禁止跨加密边界移动文档：加密笔记本是孤岛，不同加密笔记本各有独立 DEK，
	// 跨边界移动（普通↔加密、加密 A↔加密 B）会导致密文用错 DEK 损坏数据
	for _, fromPath := range fromPaths {
		fromBox := pathsBoxes[fromPath]
		if fromBox.ID != toBox.ID && !IsSameCryptoBoundary(fromBox.ID, toBox.ID) {
			err = errors.New(Conf.Language(313))
			return
		}
	}

	// A progress layer appears when moving more than 64 documents at once https://github.com/siyuan-note/siyuan/issues/9356
	subDocsCount := 0
	for _, fromPath := range fromPaths {
		fromBox := pathsBoxes[fromPath]
		subDocsCount += countSubDocs(fromBox.ID, fromPath)
	}
	needShowProgress := 64 < subDocsCount
	if needShowProgress {
		defer util.PushClearProgress()
	}

	FlushTxQueue()
	luteEngine := util.NewLute()
	refresh := newMoveDocsRefresh()
	movedDocs := make([]moveDocResult, 0, len(fromPaths))
	defer func() {
		if 0 < len(movedDocs) {
			evt := util.NewCmdResult("moveDocs", 0, util.PushModeBroadcast)
			evt.Data = map[string]any{"moves": movedDocs}
			evt.Callback = callback
			util.PushEvent(evt)
		}
		refresh.flush()
	}()
	count := 0
	for _, fromPath := range fromPaths {
		fromBox := pathsBoxes[fromPath]
		count++
		if needShowProgress {
			util.PushEndlessProgress(fmt.Sprintf(Conf.Language(70), fmt.Sprintf("%d/%d", count, len(fromPaths))))
		}

		var newPath string
		newPath, err = moveDoc(fromBox, fromPath, toBox, toPath, luteEngine, callback, refresh)
		if err != nil {
			return
		}
		movedDocs = append(movedDocs, moveDocResult{
			FromNotebook: fromBox.ID,
			FromPath:     fromPath,
			ToNotebook:   toBox.ID,
			ToPath:       toPath,
			NewPath:      newPath,
		})
	}
	cache.ClearDocsIAL()
	IncSync()
	return
}

func countSubDocs(box, p string) (ret int) {
	p = strings.TrimSuffix(p, ".sy")
	_ = filelock.Walk(filepath.Join(util.DataDir, box, p), func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		if strings.HasSuffix(path, ".sy") {
			ret++
		}
		return nil
	})
	return
}

func moveDoc(fromBox *Box, fromPath string, toBox *Box, toPath string, luteEngine *lute.Lute, callback any, refresh *moveDocsRefresh) (newPath string, err error) {
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
	if err != nil {
		err = ErrBlockNotFound
		return
	}

	fromParentTree := loadParentTree(tree)
	refresh.addParent(fromParentTree)
	if path.Dir(fromPath) == "/" {
		refresh.addNotebook(fromBox.ID)
	}

	moveToRoot := "/" == toPath
	toBlockID := tree.ID
	fromFolder := path.Join(path.Dir(fromPath), tree.ID)
	toFolder := "/"
	if moveToRoot {
		refresh.addNotebook(toBox.ID)
	} else {
		var toTree *parse.Tree
		if isSameBox {
			toTree, err = filesys.LoadTree(fromBox.ID, toPath, luteEngine)
		} else {
			toTree, err = filesys.LoadTree(toBox.ID, toPath, luteEngine)
		}
		if err != nil {
			err = ErrBlockNotFound
			return
		}

		refresh.addParent(toTree)
		toBlockID = toTree.ID
		toFolder = path.Join(path.Dir(toPath), toBlockID)
	}

	if isSameBox {
		if err = fromBox.MkdirAll(toFolder); err != nil {
			return
		}
	} else {
		if err = toBox.MkdirAll(toFolder); err != nil {
			return
		}
	}

	needMoveSubDocs := fromBox.Exist(fromFolder)
	if needMoveSubDocs {
		// 移动子文档文件夹

		newFolder := path.Join(toFolder, tree.ID)
		if isSameBox {
			if err = fromBox.Move(fromFolder, newFolder); err != nil {
				return
			}
		} else {
			absFromPath := filepath.Join(util.DataDir, fromBox.ID, fromFolder)
			absToPath := filepath.Join(util.DataDir, toBox.ID, newFolder)
			if filelock.IsExist(absToPath) {
				filelock.Remove(absToPath)
			}
			if err = filelock.Rename(absFromPath, absToPath); err != nil {
				msg := fmt.Sprintf(Conf.Language(5), fromBox.Name, fromPath, err)
				logging.LogErrorf("move [path=%s] in box [%s] failed: %s", fromPath, fromBox.ID, err)
				err = errors.New(msg)
				return
			}
		}
	}

	newPath = path.Join(toFolder, tree.ID+".sy")

	if isSameBox {
		if err = fromBox.Move(fromPath, newPath); err != nil {
			return
		}

		tree, err = filesys.LoadTree(fromBox.ID, newPath, luteEngine)
		if err != nil {
			return
		}

		moveTree(tree)
	} else {
		absFromPath := filepath.Join(util.DataDir, fromBox.ID, fromPath)
		absToPath := filepath.Join(util.DataDir, toBox.ID, newPath)
		if err = filelock.Rename(absFromPath, absToPath); err != nil {
			msg := fmt.Sprintf(Conf.Language(5), fromBox.Name, fromPath, err)
			logging.LogErrorf("move [path=%s] in box [%s] failed: %s", fromPath, fromBox.ID, err)
			err = errors.New(msg)
			return
		}

		tree, err = filesys.LoadTree(toBox.ID, newPath, luteEngine)
		if err != nil {
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
			evt.Data = map[string]any{
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
	evt.Data = map[string]any{
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

func RemoveDoc(boxID, p string) error {
	box := Conf.Box(boxID)
	if nil == box {
		return ErrBoxNotFound
	}
	if IsBoxDocPath(boxID, p) {
		return errors.New(Conf.Language(341))
	}

	FlushTxQueue()
	luteEngine := util.NewLute()
	tree, err := removeDoc(box, p, luteEngine)
	if err != nil {
		return err
	}
	IncSync()

	refreshParentDocInfo(tree)
	refreshBoxDocInfo(tree)
	return nil
}

func RemoveDocs(paths []string) error {
	util.PushEndlessProgress(Conf.Language(116))
	defer util.PushClearProgress()

	if _, err := getBoxesByPathsStrict(paths); err != nil {
		return err
	}
	paths = util.FilterSelfChildDocs(paths)
	pathsBoxes := getBoxesByPaths(paths)
	for p, box := range pathsBoxes {
		if nil != box && IsBoxDocPath(box.ID, p) {
			return errors.New(Conf.Language(341))
		}
	}
	FlushTxQueue()
	luteEngine := util.NewLute()

	var trees []*parse.Tree
	for p, box := range pathsBoxes {
		tree, removeErr := removeDoc(box, p, luteEngine)
		if removeErr != nil {
			return removeErr
		}
		trees = append(trees, tree)
	}

	parentTrees := map[string]*parse.Tree{}
	boxDocBoxes := map[string]struct{}{}
	for _, tree := range trees {
		parentTree := loadParentTree(tree)
		if nil != parentTree {
			parentTrees[parentTree.ID] = parentTree
		}
		if path.Dir(tree.Path) == "/" && !IsBoxDoc(tree.Box, tree.ID) {
			boxDocBoxes[tree.Box] = struct{}{}
		}
	}
	for _, parentTree := range parentTrees {
		refreshDocInfo(parentTree)
	}
	for boxID := range boxDocBoxes {
		refreshBoxDocInfoByBoxID(boxID)
	}
	return nil
}

func removeDoc(box *Box, p string, luteEngine *lute.Lute) (ret *parse.Tree, err error) {
	ret, err = filesys.LoadTree(box.ID, p, luteEngine)
	if err != nil || nil == ret {
		return nil, ErrBlockNotFound
	}

	historyDir, err := getHistoryDir(HistoryOpDelete)
	if err != nil {
		logging.LogErrorf("get history dir failed: %s", err)
		return
	}

	historyPath := filepath.Join(historyDir, box.ID, p)
	absPath := filepath.Join(util.DataDir, box.ID, p)
	if err = filelock.Copy(absPath, historyPath); err != nil {
		logging.LogErrorf("backup [path=%s] to history [%s] failed: %s", absPath, historyPath, err)
		return
	}

	generateAvHistoryInTree(ret, historyDir)
	// 加密笔记本的 assets 不提升到全局
	if !IsEncryptedBox(box.ID) {
		copyDocAssetsToDataAssets(box.ID, p)
	}

	removeIDs := treenode.RootChildIDs(ret.ID)
	dir := path.Dir(p)
	childrenDir := path.Join(dir, ret.ID)
	removedBlockTrees := treenode.GetBlockTreesByPathPrefix(box.ID, childrenDir)
	removedRootPaths := map[string]string{ret.ID: ret.Path}
	for _, blockTree := range removedBlockTrees {
		if blockTree.ID == blockTree.RootID {
			removedRootPaths[blockTree.RootID] = blockTree.Path
		}
	}
	existChildren := box.Exist(childrenDir)
	if existChildren {
		absChildrenDir := filepath.Join(util.DataDir, ret.Box, childrenDir)
		historyPath = filepath.Join(historyDir, ret.Box, childrenDir)
		if err = filelock.Copy(absChildrenDir, historyPath); err != nil {
			logging.LogErrorf("backup [path=%s] to history [%s] failed: %s", absChildrenDir, historyPath, err)
			return
		}
	}
	indexHistoryDir(filepath.Base(historyDir), util.NewLute())

	allRemoveRootIDs := []string{ret.ID}
	allRemoveRootIDs = append(allRemoveRootIDs, removeIDs...)
	allRemoveRootIDs = gulu.Str.RemoveDuplicatedElem(allRemoveRootIDs)
	for _, rootID := range allRemoveRootIDs {
		removeTree, _ := LoadTreeByBlockID(rootID)
		if nil == removeTree {
			continue
		}

		removedRootPaths[removeTree.ID] = removeTree.Path
		syncDelete2AvBlock(removeTree.Root, removeTree, true, nil)
	}

	if existChildren {
		if err = box.Remove(childrenDir); err != nil {
			logging.LogErrorf("remove children dir [%s%s] failed: %s", box.ID, childrenDir, err)
			return
		}
		logging.LogInfof("removed children dir [%s%s]", box.ID, childrenDir)
	}
	if err = box.Remove(p); err != nil {
		logging.LogErrorf("remove [%s%s] failed: %s", box.ID, p, err)
		return
	}
	logging.LogInfof("removed doc [%s%s]", box.ID, p)

	box.removeSort(removeIDs)
	if "/" != dir {
		others, err := os.ReadDir(filepath.Join(util.DataDir, box.ID, dir))
		if err == nil && 1 > len(others) {
			box.Remove(dir)
		}
	}

	for rootID, treePath := range removedRootPaths {
		cache.RemoveTreeData(rootID)
		cache.RemoveDocIAL(treePath)
	}
	for _, blockTree := range removedBlockTrees {
		cache.RemoveBlockIAL(blockTree.ID)
	}
	treenode.RemoveBlockTreesByPathPrefix(box.ID, childrenDir)
	sql.RemoveTreePathQueue(ret.Box, childrenDir)

	evt := util.NewCmdResult("removeDoc", 0, util.PushModeBroadcast)
	evt.Data = map[string]any{
		"ids": removeIDs,
	}
	util.PushEvent(evt)
	task.AppendTask(task.DatabaseIndex, removeDoc0, ret)
	return
}

func removeDoc0(tree *parse.Tree) {
	// 收集引用的定义块 ID
	refDefIDs := getRefDefIDs(tree.Root)
	// 推送定义节点引用计数
	for _, defID := range refDefIDs {
		task.AppendAsyncTaskWithDelay(task.SetDefRefCount, util.SQLFlushInterval, refreshRefCount, defID)
	}
}

func RenameDoc(boxID, p, title string) (err error) {
	if IsBoxDocPath(boxID, p) {
		if err = RenameBox(boxID, title); err != nil {
			return
		}
		box := Conf.Box(boxID)
		if nil != box {
			evt := util.NewCmdResult("renamenotebook", 0, util.PushModeBroadcast)
			evt.Data = map[string]any{"box": boxID, "name": box.Name}
			util.PushEvent(evt)
		}
		return
	}
	return renameDoc0(boxID, p, title)
}

func renameDoc0(boxID, p, title string) (err error) {
	box := Conf.Box(boxID)
	if nil == box {
		err = errors.New(Conf.Language(0))
		return
	}

	FlushTxQueue()
	luteEngine := util.NewLute()
	tree, err := filesys.LoadTree(box.ID, p, luteEngine)
	if err != nil {
		return
	}

	title = normalizeDocTitle(title)
	if 512 < utf8.RuneCountInString(title) {
		// 限制笔记本名和文档名最大长度为 `512` https://github.com/siyuan-note/siyuan/issues/6299
		return errors.New(Conf.Language(106))
	}

	var isEmpty bool
	if "" == title {
		title = Conf.language(16)
		isEmpty = true
	}
	// 先规范化输入得到实际会存储的标题，再与旧标题比较
	titleChanged := tree.Root.IALAttr("title") != title

	var emptyAttrUpdated bool
	if titleChanged {
		tree.HPath = path.Join(path.Dir(tree.HPath), title)
		tree.Root.SetIALAttr("title", title)
	}

	// 按需同步“无标题”标记（仅更新 IAL，不触发子树重命名等）
	isTitleEmpty := tree.Root.IALAttr(NodeAttrTitleEmpty) == "true"
	if isTitleEmpty != isEmpty {
		if isEmpty {
			tree.Root.SetIALAttr(NodeAttrTitleEmpty, "true")
			isTitleEmpty = true
		} else {
			tree.Root.RemoveIALAttr(NodeAttrTitleEmpty)
			isTitleEmpty = false
		}
		emptyAttrUpdated = true
	}

	if titleChanged || emptyAttrUpdated {
		tree.Root.SetIALAttr("updated", util.CurrentTimeSecondsStr())
		if err = renameWriteJSONQueue(tree); err != nil {
			return
		}

		subFiles := box.ListFiles(tree.Path)
		for _, subFile := range subFiles {
			if !strings.HasSuffix(subFile.path, ".sy") {
				continue
			}

			subTree, loadErr := filesys.LoadTree(box.ID, subFile.path, luteEngine) // LoadTree 会重新构造 HPath
			if loadErr != nil {
				continue
			}

			treenode.SetBlockTreePath(subTree)
			sql.RenameTreeQueue(subTree)
		}

		refText := getNodeRefText(tree.Root)
		evt := util.NewCmdResult("rename", 0, util.PushModeBroadcast)
		evt.Data = map[string]any{
			"box":     boxID,
			"id":      tree.Root.ID,
			"path":    p,
			"title":   title,
			"empty":   isTitleEmpty,
			"refText": refText,
		}
		util.PushEvent(evt)
	}
	if titleChanged {
		updateRefTextRenameDoc(tree)
	}
	if titleChanged || emptyAttrUpdated {
		IncSync()
	}
	return
}

type createDocValidation struct {
	box     *Box
	path    string
	title   string
	hPath   string
	id      string
	folder  string
	isEmpty bool
}

// ValidateCreateDoc 校验文档创建参数，不写入文件或索引。
func ValidateCreateDoc(boxID, p, title string) error {
	_, err := validateCreateDoc(boxID, p, title, false)
	return err
}

func validateCreateDoc(boxID, p, title string, titleEmpty bool) (ret *createDocValidation, err error) {
	p = normalizeBoxDocPath(boxID, p)
	title = normalizeDocTitle(title)
	if 512 < utf8.RuneCountInString(title) {
		// 限制笔记本名和文档名最大长度为 `512` https://github.com/siyuan-note/siyuan/issues/6299
		return nil, errors.New(Conf.Language(106))
	}

	isEmpty := false
	if "" == title {
		title = Conf.Language(16)
		isEmpty = true
	} else if titleEmpty {
		isEmpty = true
	}

	baseName := strings.TrimSpace(path.Base(p))
	if "" == util.GetTreeID(baseName) {
		return nil, errors.New(Conf.Language(16))
	}
	if strings.HasPrefix(baseName, ".") {
		return nil, errors.New(Conf.Language(13))
	}

	box, boxErr := getOpenedBox(boxID)
	if nil != boxErr {
		return nil, boxErr
	}

	folder := path.Dir(p)
	hPath := "/" + title
	if "/" != folder {
		parentID := path.Base(folder)
		parentTree, loadErr := LoadTreeByBlockID(parentID)
		if nil != loadErr {
			logging.LogErrorf("get parent tree [%s] failed", parentID)
			return nil, ErrBlockNotFound
		}
		parentPath := strings.TrimSuffix(parentTree.Path, ".sy")
		if parentTree.Box != boxID || cleanBoxDocDir(parentPath) != cleanBoxDocDir(folder) {
			logging.LogErrorf("parent tree [%s] does not match box [%s] and folder [%s]", parentID, boxID, folder)
			return nil, ErrBlockNotFound
		}
		hPath = path.Join(parentTree.HPath, title)
	}

	if depth := strings.Count(p, "/"); 7 < depth && !Conf.FileTree.AllowCreateDeeper {
		return nil, errors.New(Conf.Language(118))
	}
	if box.Exist(p) {
		return nil, errors.New(Conf.Language(1))
	}

	ret = &createDocValidation{
		box:     box,
		path:    p,
		title:   title,
		hPath:   hPath,
		id:      util.GetTreeID(p),
		folder:  folder,
		isEmpty: isEmpty,
	}
	return
}

func cleanBoxDocDir(p string) string {
	return path.Clean("/" + strings.TrimPrefix(p, "/"))
}

func createDoc(boxID, p, title, dom string, titleEmpty bool) (tree *parse.Tree, err error) {
	validation, err := validateCreateDoc(boxID, p, title, titleEmpty)
	if nil != err {
		return
	}

	if !validation.box.Exist(validation.folder) {
		if err = validation.box.MkdirAll(validation.folder); err != nil {
			return
		}
	}

	luteEngine := util.NewLute()
	tree = luteEngine.BlockDOM2Tree(dom)
	tree.Box = boxID
	tree.Path = validation.path
	tree.HPath = validation.hPath
	tree.ID = validation.id
	tree.Root.ID = validation.id
	tree.Root.Spec = treenode.CurrentSpec
	updated := util.TimeFromID(validation.id)
	tree.Root.KramdownIAL = [][]string{{"id", validation.id}, {"title", html.EscapeAttrVal(validation.title)}, {"updated", updated}}
	if validation.isEmpty {
		tree.Root.SetIALAttr(NodeAttrTitleEmpty, "true")
	}
	if nil == tree.Root.FirstChild {
		tree.Root.AppendChild(treenode.NewParagraph(""))
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
	FlushTxQueue()
	return
}

func normalizeDocTitle(title string) string {
	title = strings.ReplaceAll(title, "/", "")
	// 不要踢掉 零宽连字符，否则有的 Emoji 会变形 https://github.com/siyuan-note/siyuan/issues/11480
	title = strings.ReplaceAll(title, string(gulu.ZWJ), "__@ZWJ@__")
	title = util.RemoveInvalid(title)
	title = strings.ReplaceAll(title, "__@ZWJ@__", string(gulu.ZWJ))
	title = strings.TrimSpace(title)
	return title
}

func readSortConfMap(confPath string) (map[string]int, error) {
	if !filelock.IsExist(confPath) {
		return map[string]int{}, nil
	}
	data, err := filelock.ReadFile(confPath)
	if err != nil {
		logging.LogErrorf("read sort conf [%s] failed: %s", confPath, err)
		return nil, err
	}
	ret := map[string]int{}
	if err = gulu.JSON.UnmarshalJSON(data, &ret); err != nil {
		logging.LogWarnf("unmarshal sort conf [%s] failed: %s", confPath, err)
		return map[string]int{}, nil
	}
	return ret, nil
}

func writeSortConfMap(confPath string, fullSortIDs map[string]int) error {
	data, err := gulu.JSON.MarshalJSON(fullSortIDs)
	if err != nil {
		logging.LogErrorf("marshal sort conf [%s] failed: %s", confPath, err)
		return err
	}
	if err = filelock.WriteFile(confPath, data); err != nil {
		logging.LogErrorf("write sort conf [%s] failed: %s", confPath, err)
		return err
	}
	return nil
}

type DocSortModeResult struct {
	Box               string `json:"box"`
	ID                string `json:"id"`
	Path              string `json:"path"`
	SortMode          *int   `json:"sortMode"`
	EffectiveSortMode int    `json:"effectiveSortMode"`
}

// SetDocSortMode 设置文档对子文档列表声明的排序方式，sortMode 为 nil 时恢复继承。
func SetDocSortMode(id string, sortMode *int) (ret *DocSortModeResult, err error) {
	if nil != sortMode && !IsValidDocSortMode(*sortMode) {
		return nil, fmt.Errorf("invalid document sort mode [%d]", *sortMode)
	}

	FlushTxQueue()
	tree, err := LoadTreeByBlockID(id)
	if nil != err {
		return nil, err
	}
	if tree.ID != id || tree.Root.ID != id || ast.NodeDocument != tree.Root.Type || IsBoxDoc(tree.Box, tree.ID) {
		return nil, fmt.Errorf("block [%s] is not a document that can declare a child document sort mode", id)
	}

	value := ""
	if nil != sortMode {
		value = strconv.Itoa(*sortMode)
	}
	if tree.Root.IALAttr(DocSortModeAttr) != value {
		if err = setNodeAttrs(tree.Root, tree, map[string]string{DocSortModeAttr: value}); nil != err {
			return nil, err
		}
	}

	effectiveSortMode, resolveErr := ResolveDocTreeSortMode(tree.Box, tree.Path)
	if nil != resolveErr {
		return nil, resolveErr
	}
	ret = &DocSortModeResult{
		Box:               tree.Box,
		ID:                tree.ID,
		Path:              tree.Path,
		SortMode:          sortMode,
		EffectiveSortMode: effectiveSortMode,
	}
	return
}

func pushDocSortModeChanged(oldAttrs map[string]string, node *ast.Node, tree *parse.Tree) {
	if nil == node || nil == tree || ast.NodeDocument != node.Type || node.ID != tree.ID || IsBoxDoc(tree.Box, tree.ID) {
		return
	}

	oldSortMode := docSortModeFromIAL(oldAttrs)
	newSortMode := docSortModeFromIAL(parse.IAL2Map(node.KramdownIAL))
	if (nil == oldSortMode) == (nil == newSortMode) && (nil == oldSortMode || *oldSortMode == *newSortMode) {
		return
	}

	PushDocSortModeChanged("document", tree.Box, tree.ID, tree.Path, newSortMode)
}

// PushDocSortModeChanged 广播会改变子文档有效排序方式的配置变更。
func PushDocSortModeChanged(scope, boxID, id, p string, sortMode *int) {
	util.BroadcastByType("main", "docSortModeChanged", 0, "", map[string]any{
		"scope":    scope,
		"box":      boxID,
		"id":       id,
		"path":     p,
		"sortMode": sortMode,
	})
}

func moveSorts(rootID, fromBox, toBox string) {
	root := treenode.GetBlockTree(rootID)
	if nil == root {
		return
	}
	fileTreeSortLock.Lock()
	defer fileTreeSortLock.Unlock()

	fromRootSorts := map[string]int{}
	ids := treenode.RootChildIDs(rootID)
	fromConfPath := filepath.Join(util.DataDir, fromBox, ".siyuan", "sort.json")
	fromFullSortIDs, err := readSortConfMap(fromConfPath)
	if err != nil {
		return
	}
	for _, id := range ids {
		fromRootSorts[id] = fromFullSortIDs[id]
	}

	toConfPath := filepath.Join(util.DataDir, toBox, ".siyuan", "sort.json")
	toFullSortIDs, err := readSortConfMap(toConfPath)
	if err != nil {
		return
	}

	maps.Copy(toFullSortIDs, fromRootSorts)

	if err = writeSortConfMap(toConfPath, toFullSortIDs); err != nil {
		return
	}

	sortIDs := map[string]int{}
	bt := treenode.GetBlockTree(rootID)
	if nil != bt {
		parentPath := path.Dir(bt.Path)
		docs, _, listErr := ListDocTree(toBox, parentPath, util.SortModeCustom, false, false, math.MaxInt)
		if listErr != nil {
			logging.LogErrorf("list doc tree failed: %s", listErr)
			return
		}

		for _, doc := range docs {
			sortIDs[doc.ID] = doc.Sort
		}

		pushFiletreeSortChanged(sortIDs)
	}

}

func ChangeFileTreeSort(boxID string, paths []string) {
	if 1 > len(paths) {
		return
	}

	FlushTxQueue()
	fileTreeSortLock.Lock()
	defer fileTreeSortLock.Unlock()
	box := Conf.Box(boxID)
	sortIDs := map[string]int{}
	max := 0
	for i, p := range paths {
		id := util.GetTreeID(p)
		sortIDs[id] = i + 1
		if i == len(paths)-1 {
			max = i + 2
		}
	}

	p := paths[0]
	parentPath := path.Dir(p)
	absParentPath := filepath.Join(util.DataDir, boxID, parentPath)
	files, err := os.ReadDir(absParentPath)
	if err != nil {
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
	if err = os.MkdirAll(confDir, 0755); err != nil {
		logging.LogErrorf("create conf dir failed: %s", err)
		return
	}
	confPath := filepath.Join(confDir, "sort.json")
	fullSortIDs, err := readSortConfMap(confPath)
	if err != nil {
		return
	}

	maps.Copy(fullSortIDs, sortFolderIDs)

	if err = writeSortConfMap(confPath, fullSortIDs); err != nil {
		return
	}

	IncSync()

	pushFiletreeSortChanged(sortFolderIDs)
}

var fileTreeSortLock sync.Mutex

type SortItem struct {
	ID   string `json:"id"`
	Sort int    `json:"sort"`
}

type SetFileTreeSortResult struct {
	NotebookIDs []string `json:"notebookIDs"`
	DocIDs      []string `json:"docIDs"`
}

type notebookSortPlan struct {
	item *SortItem
	box  *Box
}

type docSortPlan struct {
	item       *SortItem
	boxID      string
	parentPath string
}

type docSortGroup struct {
	fullSortIDs  map[string]int
	changed      map[string]int
	parentSorts  map[string]map[string]int
	writeSuccess bool
}

func SetFileTreeSort(notebookSorts, docSorts []*SortItem) (ret *SetFileTreeSortResult, err error) {
	ret = &SetFileTreeSortResult{
		NotebookIDs: []string{},
		DocIDs:      []string{},
	}

	FlushTxQueue()
	fileTreeSortLock.Lock()
	defer fileTreeSortLock.Unlock()
	boxes := map[string]*Box{}
	for _, box := range Conf.GetBoxes() {
		boxes[box.ID] = box
	}
	openedBoxes := map[string]*Box{}
	for _, box := range Conf.GetOpenedBoxes() {
		openedBoxes[box.ID] = box
	}

	notebookPlans := make([]*notebookSortPlan, 0, len(notebookSorts))
	notebookIDs := map[string]struct{}{}
	for _, item := range notebookSorts {
		if nil == item {
			return ret, errors.New("notebook sort item must not be nil")
		}
		if _, ok := notebookIDs[item.ID]; ok {
			return ret, fmt.Errorf("duplicate notebook ID [%s]", item.ID)
		}
		notebookIDs[item.ID] = struct{}{}

		box := boxes[item.ID]
		if nil == box {
			return ret, fmt.Errorf("notebook [%s] not found", item.ID)
		}
		notebookPlans = append(notebookPlans, &notebookSortPlan{item: item, box: box})
	}

	docPlans := make([]*docSortPlan, 0, len(docSorts))
	docIDs := map[string]struct{}{}
	for _, item := range docSorts {
		if nil == item {
			return ret, errors.New("document sort item must not be nil")
		}
		if _, ok := docIDs[item.ID]; ok {
			return ret, fmt.Errorf("duplicate document ID [%s]", item.ID)
		}
		docIDs[item.ID] = struct{}{}

		bt := treenode.GetBlockTree(item.ID)
		if nil == bt || nil == openedBoxes[bt.BoxID] {
			return ret, fmt.Errorf("document [%s] not found in opened and unlocked notebooks", item.ID)
		}
		if bt.ID != bt.RootID || "d" != bt.Type || IsBoxDoc(bt.BoxID, bt.RootID) {
			return ret, fmt.Errorf("block [%s] is not a sortable document", item.ID)
		}
		if nil == boxes[bt.BoxID] {
			return ret, fmt.Errorf("notebook [%s] not found for document [%s]", bt.BoxID, item.ID)
		}
		docPlans = append(docPlans, &docSortPlan{item: item, boxID: bt.BoxID, parentPath: path.Dir(bt.Path)})
	}

	docGroups := map[string]*docSortGroup{}
	for _, plan := range docPlans {
		group := docGroups[plan.boxID]
		if nil == group {
			confPath := filepath.Join(util.DataDir, plan.boxID, ".siyuan", "sort.json")
			fullSortIDs, readErr := readSortConfMap(confPath)
			if readErr != nil {
				return ret, readErr
			}
			group = &docSortGroup{
				fullSortIDs: fullSortIDs,
				changed:     map[string]int{},
				parentSorts: map[string]map[string]int{},
			}
			docGroups[plan.boxID] = group
		}

		if group.fullSortIDs[plan.item.ID] == plan.item.Sort {
			continue
		}
		group.changed[plan.item.ID] = plan.item.Sort
		if nil == group.parentSorts[plan.parentPath] {
			group.parentSorts[plan.parentPath] = map[string]int{}
		}
		group.parentSorts[plan.parentPath][plan.item.ID] = plan.item.Sort
	}

	var writeErr error
	for _, plan := range notebookPlans {
		boxConf := plan.box.GetConf()
		if boxConf.Sort == plan.item.Sort {
			continue
		}
		boxConf.Sort = plan.item.Sort
		if saveErr := plan.box.SaveConf(boxConf); saveErr != nil {
			writeErr = errors.Join(writeErr, saveErr)
			continue
		}
		ret.NotebookIDs = append(ret.NotebookIDs, plan.item.ID)
	}

	for boxID, group := range docGroups {
		if 0 == len(group.changed) {
			continue
		}
		maps.Copy(group.fullSortIDs, group.changed)
		confPath := filepath.Join(util.DataDir, boxID, ".siyuan", "sort.json")
		if writeErr0 := writeSortConfMap(confPath, group.fullSortIDs); writeErr0 != nil {
			writeErr = errors.Join(writeErr, writeErr0)
			continue
		}
		group.writeSuccess = true
	}

	for _, plan := range docPlans {
		group := docGroups[plan.boxID]
		if group.writeSuccess {
			if _, ok := group.changed[plan.item.ID]; ok {
				ret.DocIDs = append(ret.DocIDs, plan.item.ID)
			}
		}
	}

	if 0 < len(ret.NotebookIDs) {
		pushNotebookSortChanged()
	}
	for _, group := range docGroups {
		if !group.writeSuccess {
			continue
		}
		for _, parentSorts := range group.parentSorts {
			pushFiletreeSortChanged(parentSorts)
		}
	}
	if 0 < len(ret.NotebookIDs)+len(ret.DocIDs) {
		IncSync()
	}
	return ret, writeErr
}

func (box *Box) fillSort(files *[]*File) {
	confPath := filepath.Join(util.DataDir, box.ID, ".siyuan", "sort.json")
	fullSortIDs, err := readSortConfMap(confPath)
	if err != nil {
		return
	}

	for _, f := range *files {
		id := strings.TrimSuffix(f.ID, ".sy")
		f.Sort = fullSortIDs[id]
	}
}

func (box *Box) removeSort(ids []string) {
	fileTreeSortLock.Lock()
	defer fileTreeSortLock.Unlock()

	confPath := filepath.Join(util.DataDir, box.ID, ".siyuan", "sort.json")
	if !filelock.IsExist(confPath) {
		return
	}

	fullSortIDs, err := readSortConfMap(confPath)
	if err != nil {
		return
	}

	for _, toRemove := range ids {
		delete(fullSortIDs, toRemove)
	}

	if err = writeSortConfMap(confPath, fullSortIDs); err != nil {
		return
	}
}

func (box *Box) setSortByConf(parentPath, id string) {
	if *Conf.FileTree.CreateDocAtTop {
		box.addMinSort(parentPath, id)
	} else {
		box.addMaxSort(parentPath, id)
	}
}

func (box *Box) addMaxSort(parentPath, id string) {
	docs, _, err := ListDocTree(box.ID, parentPath, util.SortModeCustom, false, false, math.MaxInt)
	if err != nil {
		logging.LogErrorf("list doc tree failed: %s", err)
		return
	}

	sortVal := 0
	if 0 < len(docs) {
		sortVal = docs[len(docs)-1].Sort + 1
	}

	box.setSortVal(id, sortVal)

	sortIDs := map[string]int{}
	for _, doc := range docs {
		sortIDs[doc.ID] = doc.Sort
	}
	sortIDs[id] = sortVal
	pushFiletreeSortChanged(sortIDs)
}

func (box *Box) addMinSort(parentPath, id string) {
	docs, _, err := ListDocTree(box.ID, parentPath, util.SortModeCustom, false, false, 1)
	if err != nil {
		logging.LogErrorf("list doc tree failed: %s", err)
		return
	}

	sortVal := 0
	if 0 < len(docs) {
		sortVal = docs[0].Sort - 1
	}

	box.setSortVal(id, sortVal)

	sortIDs := map[string]int{}
	for _, doc := range docs {
		sortIDs[doc.ID] = doc.Sort
	}
	sortIDs[id] = sortVal
	pushFiletreeSortChanged(sortIDs)
}

func (box *Box) setSortVal(id string, sortVal int) {
	fileTreeSortLock.Lock()
	defer fileTreeSortLock.Unlock()

	var err error
	confDir := filepath.Join(util.DataDir, box.ID, ".siyuan")
	if err = os.MkdirAll(confDir, 0755); err != nil {
		logging.LogErrorf("create conf dir failed: %s", err)
		return
	}
	confPath := filepath.Join(confDir, "sort.json")
	fullSortIDs, err := readSortConfMap(confPath)
	if err != nil {
		return
	}

	fullSortIDs[id] = sortVal
	if err = writeSortConfMap(confPath, fullSortIDs); err != nil {
		return
	}
}

func (box *Box) addSort(previousPath, id string) {
	fileTreeSortLock.Lock()
	defer fileTreeSortLock.Unlock()

	confDir := filepath.Join(util.DataDir, box.ID, ".siyuan")
	if err := os.MkdirAll(confDir, 0755); err != nil {
		logging.LogErrorf("create conf dir failed: %s", err)
		return
	}
	confPath := filepath.Join(confDir, "sort.json")
	fullSortIDs, err := readSortConfMap(confPath)
	if err != nil {
		return
	}

	parentPath := path.Dir(previousPath)
	docs, _, err := ListDocTree(box.ID, parentPath, util.SortModeCustom, false, false, math.MaxInt)
	if err != nil {
		logging.LogErrorf("list doc tree failed: %s", err)
		return
	}

	sortIDs := map[string]int{}
	previousID := util.GetTreeID(previousPath)
	sortVal := 0
	for _, doc := range docs {
		fullSortIDs[doc.ID] = sortVal
		if doc.ID == previousID {
			sortVal++
			fullSortIDs[id] = sortVal
		}
		sortVal++
		sortIDs[doc.ID] = sortVal
	}

	if err = writeSortConfMap(confPath, fullSortIDs); err != nil {
		return
	}

	pushFiletreeSortChanged(sortIDs)
}

func (box *Box) setSort(sortIDVals map[string]int) {
	fileTreeSortLock.Lock()
	defer fileTreeSortLock.Unlock()

	confPath := filepath.Join(util.DataDir, box.ID, ".siyuan", "sort.json")
	if !filelock.IsExist(confPath) {
		return
	}

	fullSortIDs, err := readSortConfMap(confPath)
	if err != nil {
		return
	}

	maps.Copy(fullSortIDs, sortIDVals)

	if err = writeSortConfMap(confPath, fullSortIDs); err != nil {
		return
	}

	pushFiletreeSortChanged(sortIDVals)
}

func pushFiletreeSortChanged(sortIDs map[string]int) {
	if 1 > len(sortIDs) {
		return
	}

	var childIDs []string
	for sortID := range sortIDs {
		childIDs = append(childIDs, sortID)
	}
	sort.Slice(childIDs, func(i, j int) bool {
		return sortIDs[childIDs[i]] < sortIDs[childIDs[j]]
	})

	firstID := childIDs[0]
	bt := treenode.GetBlockTree(firstID)
	if nil == bt {
		return
	}

	parentPath := path.Dir(bt.Path)
	util.BroadcastByType("main", "filetreeSortChanged", 0, "", map[string]any{
		"notebook":   bt.BoxID,
		"parentPath": parentPath,
		"childIDs":   childIDs,
	})
}
