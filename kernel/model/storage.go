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
	"errors"
	"os"
	"path"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/88250/gulu"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type RecentDoc struct {
	RootID   string `json:"rootID"`
	Icon     string `json:"icon"`
	Title    string `json:"title"`
	ViewedAt int64  `json:"viewedAt"` // 浏览时间字段
	ClosedAt int64  `json:"closedAt"` // 关闭时间字段
	OpenAt   int64  `json:"openAt"`   // 文档第一次从文档树加载到页签的时间
}

type OutlineDoc struct {
	DocID string                 `json:"docID"`
	Data  map[string]interface{} `json:"data"`
}

var recentDocLock = sync.Mutex{}

func RemoveRecentDoc(ids []string) {
	recentDocLock.Lock()
	defer recentDocLock.Unlock()

	recentDocs, err := getRecentDocs("")
	if err != nil {
		return
	}

	ids = gulu.Str.RemoveDuplicatedElem(ids)
	for i, doc := range recentDocs {
		if gulu.Str.Contains(doc.RootID, ids) {
			recentDocs = append(recentDocs[:i], recentDocs[i+1:]...)
			break
		}
	}

	err = setRecentDocs(recentDocs)
	if err != nil {
		return
	}
	return
}

func setRecentDocByTree(tree *parse.Tree) {
	recentDoc := &RecentDoc{
		RootID:   tree.Root.ID,
		Icon:     tree.Root.IALAttr("icon"),
		Title:    tree.Root.IALAttr("title"),
		ViewedAt: time.Now().Unix(), // 使用当前时间作为浏览时间
		ClosedAt: 0,                 // 初始化关闭时间为0，表示未关闭
		OpenAt:   time.Now().Unix(), // 设置文档打开时间
	}

	recentDocLock.Lock()
	defer recentDocLock.Unlock()

	recentDocs, err := getRecentDocs("")
	if err != nil {
		return
	}

	for i, c := range recentDocs {
		if c.RootID == recentDoc.RootID {
			recentDocs = append(recentDocs[:i], recentDocs[i+1:]...)
			break
		}
	}

	recentDocs = append([]*RecentDoc{recentDoc}, recentDocs...)
	if 256 < len(recentDocs) {
		recentDocs = recentDocs[:256]
	}

	err = setRecentDocs(recentDocs)
	return
}

// UpdateRecentDocOpenTime 更新文档打开时间（只在第一次从文档树加载到页签时调用）
func UpdateRecentDocOpenTime(rootID string) (err error) {
	recentDocLock.Lock()
	defer recentDocLock.Unlock()

	recentDocs, err := getRecentDocs("")
	if err != nil {
		return
	}

	// 查找文档并更新打开时间
	found := false
	for _, doc := range recentDocs {
		if doc.RootID == rootID {
			doc.OpenAt = time.Now().Unix()
			found = true
			break
		}
	}

	if found {
		err = setRecentDocs(recentDocs)
	}
	return
}

// UpdateRecentDocViewTime 更新文档浏览时间
func UpdateRecentDocViewTime(rootID string) (err error) {
	recentDocLock.Lock()
	defer recentDocLock.Unlock()

	recentDocs, err := getRecentDocs("")
	if err != nil {
		return
	}

	// 查找文档并更新浏览时间
	found := false
	for _, doc := range recentDocs {
		if doc.RootID == rootID {
			doc.ViewedAt = time.Now().Unix()
			found = true
			break
		}
	}

	if found {
		// 按浏览时间降序排序
		sort.Slice(recentDocs, func(i, j int) bool {
			return recentDocs[i].ViewedAt > recentDocs[j].ViewedAt
		})
		err = setRecentDocs(recentDocs)
	}
	return
}

// UpdateRecentDocCloseTime 更新文档关闭时间
func UpdateRecentDocCloseTime(rootID string) (err error) {
	recentDocLock.Lock()
	defer recentDocLock.Unlock()

	recentDocs, err := getRecentDocs("")
	if err != nil {
		return
	}

	// 查找文档并更新关闭时间
	found := false
	for _, doc := range recentDocs {
		if doc.RootID == rootID {
			doc.ClosedAt = time.Now().Unix()
			found = true
			break
		}
	}

	if found {
		err = setRecentDocs(recentDocs)
	}
	return
}

func GetRecentDocs(sortBy string) (ret []*RecentDoc, err error) {
	recentDocLock.Lock()
	defer recentDocLock.Unlock()
	ret, err = getRecentDocs(sortBy)
	if err != nil {
		return
	}
	if len(ret) > Conf.FileTree.RecentDocsMaxListCount {
		ret = ret[:Conf.FileTree.RecentDocsMaxListCount]
	}
	return
}

func setRecentDocs(recentDocs []*RecentDoc) (err error) {
	dirPath := filepath.Join(util.DataDir, "storage")
	if err = os.MkdirAll(dirPath, 0755); err != nil {
		logging.LogErrorf("create storage [recent-doc] dir failed: %s", err)
		return
	}

	data, err := gulu.JSON.MarshalIndentJSON(recentDocs, "", "  ")
	if err != nil {
		logging.LogErrorf("marshal storage [recent-doc] failed: %s", err)
		return
	}

	lsPath := filepath.Join(dirPath, "recent-doc.json")
	err = filelock.WriteFile(lsPath, data)
	if err != nil {
		logging.LogErrorf("write storage [recent-doc] failed: %s", err)
		return
	}
	return
}

func getRecentDocs(sortBy string) (ret []*RecentDoc, err error) {
	tmp := []*RecentDoc{}
	dataPath := filepath.Join(util.DataDir, "storage/recent-doc.json")
	if !filelock.IsExist(dataPath) {
		return
	}

	data, err := filelock.ReadFile(dataPath)
	if err != nil {
		logging.LogErrorf("read storage [recent-doc] failed: %s", err)
		return
	}

	if err = gulu.JSON.UnmarshalJSON(data, &tmp); err != nil {
		logging.LogErrorf("unmarshal storage [recent-doc] failed: %s", err)
		if err = setRecentDocs([]*RecentDoc{}); err != nil {
			logging.LogErrorf("reset storage [recent-doc] failed: %s", err)
		}
		ret = []*RecentDoc{}
		return
	}

	var rootIDs []string
	for _, doc := range tmp {
		rootIDs = append(rootIDs, doc.RootID)
	}
	bts := treenode.GetBlockTrees(rootIDs)
	var notExists []string
	for _, doc := range tmp {
		if bt := bts[doc.RootID]; nil != bt {
			doc.Title = path.Base(bt.HPath) // Recent docs not updated after renaming https://github.com/siyuan-note/siyuan/issues/7827
			ret = append(ret, doc)
		} else {
			notExists = append(notExists, doc.RootID)
		}
	}

	if 0 < len(notExists) {
		setRecentDocs(ret)
	}

	// 根据排序参数进行排序
	switch sortBy {
	case "closedAt": // 按关闭时间排序
		sort.Slice(ret, func(i, j int) bool {
			if ret[i].ClosedAt == 0 && ret[j].ClosedAt == 0 {
				// 如果都没有关闭时间，按浏览时间排序
				return ret[i].ViewedAt > ret[j].ViewedAt
			}
			if ret[i].ClosedAt == 0 {
				return false // 没有关闭时间的排在后面
			}
			if ret[j].ClosedAt == 0 {
				return true // 有关闭时间的排在前面
			}
			return ret[i].ClosedAt > ret[j].ClosedAt
		})
	case "openAt": // 按打开时间排序
		sort.Slice(ret, func(i, j int) bool {
			if ret[i].OpenAt == 0 && ret[j].OpenAt == 0 {
				// 如果都没有打开时间，按ID时间排序（ID包含时间信息）
				return ret[i].RootID > ret[j].RootID
			}
			if ret[i].OpenAt == 0 {
				return false // 没有打开时间的排在后面
			}
			if ret[j].OpenAt == 0 {
				return true // 有打开时间的排在前面
			}
			return ret[i].OpenAt > ret[j].OpenAt
		})
	default: // 默认按浏览时间排序
		sort.Slice(ret, func(i, j int) bool {
			if ret[i].ViewedAt == 0 && ret[j].ViewedAt == 0 {
				// 如果都没有浏览时间，按ID时间排序（ID包含时间信息）
				return ret[i].RootID > ret[j].RootID
			}
			if ret[i].ViewedAt == 0 {
				return false // 没有浏览时间的排在后面
			}
			if ret[j].ViewedAt == 0 {
				return true // 有浏览时间的排在前面
			}
			return ret[i].ViewedAt > ret[j].ViewedAt
		})
	}
	return
}

type Criterion struct {
	Name         string                 `json:"name"`
	Sort         int                    `json:"sort"`       // 0：按块类型（默认），1：按创建时间升序，2：按创建时间降序，3：按更新时间升序，4：按更新时间降序，5：按内容顺序（仅在按文档分组时）
	Group        int                    `json:"group"`      // 0：不分组，1：按文档分组
	HasReplace   bool                   `json:"hasReplace"` // 是否有替换
	Method       int                    `json:"method"`     // 0：文本，1：查询语法，2：SQL，3：正则表达式
	HPath        string                 `json:"hPath"`
	IDPath       []string               `json:"idPath"`
	K            string                 `json:"k"`            // 搜索关键字
	R            string                 `json:"r"`            // 替换关键字
	Types        *CriterionTypes        `json:"types"`        // 类型过滤选项
	ReplaceTypes *CriterionReplaceTypes `json:"replaceTypes"` // 替换类型过滤选项
}

type CriterionTypes struct {
	MathBlock     bool `json:"mathBlock"`
	Table         bool `json:"table"`
	Blockquote    bool `json:"blockquote"`
	SuperBlock    bool `json:"superBlock"`
	Paragraph     bool `json:"paragraph"`
	Document      bool `json:"document"`
	Heading       bool `json:"heading"`
	List          bool `json:"list"`
	ListItem      bool `json:"listItem"`
	CodeBlock     bool `json:"codeBlock"`
	HtmlBlock     bool `json:"htmlBlock"`
	EmbedBlock    bool `json:"embedBlock"`
	DatabaseBlock bool `json:"databaseBlock"`
	AudioBlock    bool `json:"audioBlock"`
	VideoBlock    bool `json:"videoBlock"`
	IFrameBlock   bool `json:"iframeBlock"`
	WidgetBlock   bool `json:"widgetBlock"`
	Callout       bool `json:"callout"`
}

type CriterionReplaceTypes struct {
	Text              bool `json:"text"`
	ImgText           bool `json:"imgText"`
	ImgTitle          bool `json:"imgTitle"`
	ImgSrc            bool `json:"imgSrc"`
	AText             bool `json:"aText"`
	ATitle            bool `json:"aTitle"`
	AHref             bool `json:"aHref"`
	Code              bool `json:"code"`
	Em                bool `json:"em"`
	Strong            bool `json:"strong"`
	InlineMath        bool `json:"inlineMath"`
	InlineMemo        bool `json:"inlineMemo"`
	BlockRef          bool `json:"blockRef"`
	FileAnnotationRef bool `json:"fileAnnotationRef"`
	Kbd               bool `json:"kbd"`
	Mark              bool `json:"mark"`
	S                 bool `json:"s"`
	Sub               bool `json:"sub"`
	Sup               bool `json:"sup"`
	Tag               bool `json:"tag"`
	U                 bool `json:"u"`
	DocTitle          bool `json:"docTitle"`
	CodeBlock         bool `json:"codeBlock"`
	MathBlock         bool `json:"mathBlock"`
	HtmlBlock         bool `json:"htmlBlock"`
}

var criteriaLock = sync.Mutex{}

func RemoveCriterion(name string) (err error) {
	criteriaLock.Lock()
	defer criteriaLock.Unlock()

	criteria, err := getCriteria()
	if err != nil {
		return
	}

	for i, c := range criteria {
		if c.Name == name {
			criteria = append(criteria[:i], criteria[i+1:]...)
			break
		}
	}

	err = setCriteria(criteria)
	return
}

func SetCriterion(criterion *Criterion) (err error) {
	if "" == criterion.Name {
		return errors.New(Conf.Language(142))
	}

	criteriaLock.Lock()
	defer criteriaLock.Unlock()

	criteria, err := getCriteria()
	if err != nil {
		return
	}

	update := false
	for i, c := range criteria {
		if c.Name == criterion.Name {
			criteria[i] = criterion
			update = true
			break
		}
	}
	if !update {
		criteria = append(criteria, criterion)
	}

	err = setCriteria(criteria)
	return
}

func GetCriteria() (ret []*Criterion) {
	criteriaLock.Lock()
	defer criteriaLock.Unlock()
	ret, _ = getCriteria()
	return
}

func setCriteria(criteria []*Criterion) (err error) {
	dirPath := filepath.Join(util.DataDir, "storage")
	if err = os.MkdirAll(dirPath, 0755); err != nil {
		logging.LogErrorf("create storage [criteria] dir failed: %s", err)
		return
	}

	data, err := gulu.JSON.MarshalIndentJSON(criteria, "", "  ")
	if err != nil {
		logging.LogErrorf("marshal storage [criteria] failed: %s", err)
		return
	}

	lsPath := filepath.Join(dirPath, "criteria.json")
	err = filelock.WriteFile(lsPath, data)
	if err != nil {
		logging.LogErrorf("write storage [criteria] failed: %s", err)
		return
	}
	return
}

func getCriteria() (ret []*Criterion, err error) {
	ret = []*Criterion{}
	dataPath := filepath.Join(util.DataDir, "storage/criteria.json")
	if !filelock.IsExist(dataPath) {
		return
	}

	data, err := filelock.ReadFile(dataPath)
	if err != nil {
		logging.LogErrorf("read storage [criteria] failed: %s", err)
		return
	}

	if err = gulu.JSON.UnmarshalJSON(data, &ret); err != nil {
		logging.LogErrorf("unmarshal storage [criteria] failed: %s", err)
		return
	}
	return
}

var localStorageLock = sync.Mutex{}

func RemoveLocalStorageVals(keys []string) (err error) {
	localStorageLock.Lock()
	defer localStorageLock.Unlock()

	localStorage := getLocalStorage()
	for _, key := range keys {
		delete(localStorage, key)
	}
	return setLocalStorage(localStorage)
}

func SetLocalStorageVal(key string, val interface{}) (err error) {
	localStorageLock.Lock()
	defer localStorageLock.Unlock()

	localStorage := getLocalStorage()
	localStorage[key] = val
	return setLocalStorage(localStorage)
}

func SetLocalStorage(val interface{}) (err error) {
	localStorageLock.Lock()
	defer localStorageLock.Unlock()
	return setLocalStorage(val)
}

func GetLocalStorage() (ret map[string]interface{}) {
	localStorageLock.Lock()
	defer localStorageLock.Unlock()
	return getLocalStorage()
}

func setLocalStorage(val interface{}) (err error) {
	dirPath := filepath.Join(util.DataDir, "storage")
	if err = os.MkdirAll(dirPath, 0755); err != nil {
		logging.LogErrorf("create storage [local] dir failed: %s", err)
		return
	}

	data, err := gulu.JSON.MarshalIndentJSON(val, "", "  ")
	if err != nil {
		logging.LogErrorf("marshal storage [local] failed: %s", err)
		return
	}

	lsPath := filepath.Join(dirPath, "local.json")
	err = filelock.WriteFile(lsPath, data)
	if err != nil {
		logging.LogErrorf("write storage [local] failed: %s", err)
		return
	}
	return
}

func getLocalStorage() (ret map[string]interface{}) {
	// When local.json is corrupted, clear the file to avoid being unable to enter the main interface https://github.com/siyuan-note/siyuan/issues/7911
	ret = map[string]interface{}{}
	lsPath := filepath.Join(util.DataDir, "storage/local.json")
	if !filelock.IsExist(lsPath) {
		return
	}

	data, err := filelock.ReadFile(lsPath)
	if err != nil {
		logging.LogErrorf("read storage [local] failed: %s", err)
		return
	}

	if err = gulu.JSON.UnmarshalJSON(data, &ret); err != nil {
		logging.LogErrorf("unmarshal storage [local] failed: %s", err)
		return
	}
	return
}

var outlineStorageLock = sync.Mutex{}

func GetOutlineStorage(docID string) (ret map[string]interface{}, err error) {
	outlineStorageLock.Lock()
	defer outlineStorageLock.Unlock()

	ret = map[string]interface{}{}
	outlineDocs, err := getOutlineDocs()
	if err != nil {
		return
	}

	for _, doc := range outlineDocs {
		if doc.DocID == docID {
			ret = doc.Data
			break
		}
	}
	return
}

func SetOutlineStorage(docID string, val interface{}) (err error) {
	outlineStorageLock.Lock()
	defer outlineStorageLock.Unlock()

	outlineDoc := &OutlineDoc{
		DocID: docID,
		Data:  make(map[string]interface{}),
	}

	if valMap, ok := val.(map[string]interface{}); ok {
		outlineDoc.Data = valMap
	}

	outlineDocs, err := getOutlineDocs()
	if err != nil {
		return
	}

	// 如果文档已存在，先移除旧的
	for i, doc := range outlineDocs {
		if doc.DocID == docID {
			outlineDocs = append(outlineDocs[:i], outlineDocs[i+1:]...)
			break
		}
	}

	// 将新的文档信息添加到最前面
	outlineDocs = append([]*OutlineDoc{outlineDoc}, outlineDocs...)

	// 限制为2000个文档
	if 2000 < len(outlineDocs) {
		outlineDocs = outlineDocs[:2000]
	}

	err = setOutlineDocs(outlineDocs)
	return
}

func RemoveOutlineStorage(docID string) (err error) {
	outlineStorageLock.Lock()
	defer outlineStorageLock.Unlock()

	outlineDocs, err := getOutlineDocs()
	if err != nil {
		return
	}

	for i, doc := range outlineDocs {
		if doc.DocID == docID {
			outlineDocs = append(outlineDocs[:i], outlineDocs[i+1:]...)
			break
		}
	}

	err = setOutlineDocs(outlineDocs)
	return
}

func setOutlineDocs(outlineDocs []*OutlineDoc) (err error) {
	dirPath := filepath.Join(util.DataDir, "storage")
	if err = os.MkdirAll(dirPath, 0755); err != nil {
		logging.LogErrorf("create storage [outline] dir failed: %s", err)
		return
	}

	data, err := gulu.JSON.MarshalJSON(outlineDocs)
	if err != nil {
		logging.LogErrorf("marshal storage [outline] failed: %s", err)
		return
	}

	lsPath := filepath.Join(dirPath, "outline.json")
	err = filelock.WriteFile(lsPath, data)
	if err != nil {
		logging.LogErrorf("write storage [outline] failed: %s", err)
		return
	}
	return
}

func getOutlineDocs() (ret []*OutlineDoc, err error) {
	ret = []*OutlineDoc{}
	dataPath := filepath.Join(util.DataDir, "storage/outline.json")
	if !filelock.IsExist(dataPath) {
		return
	}

	data, err := filelock.ReadFile(dataPath)
	if err != nil {
		logging.LogErrorf("read storage [outline] failed: %s", err)
		return
	}

	if err = gulu.JSON.UnmarshalJSON(data, &ret); err != nil {
		logging.LogErrorf("unmarshal storage [outline] failed: %s", err)
		return
	}
	return
}
