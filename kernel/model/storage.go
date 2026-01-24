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
	"strings"
	"sync"
	"time"

	"github.com/88250/gulu"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type RecentDoc struct {
	RootID   string `json:"rootID"`
	Icon     string `json:"icon,omitempty"`
	Title    string `json:"title,omitempty"`
	ViewedAt int64  `json:"viewedAt,omitempty"` // 浏览时间字段
	ClosedAt int64  `json:"closedAt,omitempty"` // 关闭时间字段
	OpenAt   int64  `json:"openAt,omitempty"`   // 文档第一次从文档树加载到页签的时间
}

type OutlineDoc struct {
	DocID string                 `json:"docID"`
	Data  map[string]interface{} `json:"data"`
}

var recentDocLock = sync.Mutex{}

// normalizeRecentDocs 规范化最近文档列表：去重、清空 Title/Icon、按类型截取配置的最大数量记录
func normalizeRecentDocs(recentDocs []*RecentDoc) []*RecentDoc {
	maxCount := Conf.FileTree.RecentDocsMaxListCount

	// 去重
	seen := make(map[string]struct{}, len(recentDocs))
	deduplicated := make([]*RecentDoc, 0, len(recentDocs))
	for _, doc := range recentDocs {
		if _, ok := seen[doc.RootID]; !ok {
			seen[doc.RootID] = struct{}{}
			deduplicated = append(deduplicated, doc)
		}
	}

	if len(deduplicated) <= maxCount {
		return deduplicated
	}

	// 分别统计三种类型的记录
	var viewedDocs []*RecentDoc
	var openedDocs []*RecentDoc
	var closedDocs []*RecentDoc

	for _, doc := range deduplicated {
		if doc.ViewedAt > 0 {
			viewedDocs = append(viewedDocs, doc)
		}
		if doc.OpenAt > 0 {
			openedDocs = append(openedDocs, doc)
		}
		if doc.ClosedAt > 0 {
			closedDocs = append(closedDocs, doc)
		}
	}

	// 分别按时间排序并截取配置的最大数量记录
	if len(viewedDocs) > maxCount {
		sort.Slice(viewedDocs, func(i, j int) bool {
			return viewedDocs[i].ViewedAt > viewedDocs[j].ViewedAt
		})
		viewedDocs = viewedDocs[:maxCount]
	}
	if len(openedDocs) > maxCount {
		sort.Slice(openedDocs, func(i, j int) bool {
			return openedDocs[i].OpenAt > openedDocs[j].OpenAt
		})
		openedDocs = openedDocs[:maxCount]
	}
	if len(closedDocs) > maxCount {
		sort.Slice(closedDocs, func(i, j int) bool {
			return closedDocs[i].ClosedAt > closedDocs[j].ClosedAt
		})
		closedDocs = closedDocs[:maxCount]
	}

	// 合并三类记录
	docMap := make(map[string]*RecentDoc, maxCount*2)
	for _, doc := range viewedDocs {
		docMap[doc.RootID] = doc
	}
	for _, doc := range openedDocs {
		if _, ok := docMap[doc.RootID]; !ok {
			docMap[doc.RootID] = doc
		}
	}
	for _, doc := range closedDocs {
		if _, ok := docMap[doc.RootID]; !ok {
			docMap[doc.RootID] = doc
		}
	}

	result := make([]*RecentDoc, 0, len(docMap))
	for _, doc := range docMap {
		result = append(result, doc)
	}

	return result
}

// UpdateRecentDocOpenTime 更新文档打开时间（只在第一次从文档树加载到页签时调用）
func UpdateRecentDocOpenTime(rootID string) (err error) {
	recentDocLock.Lock()
	defer recentDocLock.Unlock()

	recentDocs, err := loadRecentDocsRaw()
	if err != nil {
		return
	}

	timeNow := time.Now().Unix()
	// 查找文档并更新打开时间和浏览时间
	found := false
	for _, doc := range recentDocs {
		if doc.RootID == rootID {
			doc.OpenAt = timeNow
			doc.ViewedAt = timeNow
			doc.ClosedAt = 0
			found = true
			break
		}
	}

	// 如果文档不存在，创建新记录
	if !found {
		recentDoc := &RecentDoc{
			RootID:   rootID,
			OpenAt:   timeNow,
			ViewedAt: timeNow,
		}
		recentDocs = append([]*RecentDoc{recentDoc}, recentDocs...)
	}

	err = setRecentDocs(recentDocs)
	return
}

// UpdateRecentDocViewTime 更新文档浏览时间
func UpdateRecentDocViewTime(rootID string) (err error) {
	recentDocLock.Lock()
	defer recentDocLock.Unlock()

	recentDocs, err := loadRecentDocsRaw()
	if err != nil {
		return
	}

	timeNow := time.Now().Unix()
	// 查找文档并更新浏览时间，保留原来的打开时间
	found := false
	for _, doc := range recentDocs {
		if doc.RootID == rootID {
			// OpenAt 保持不变，保留原来的打开时间
			doc.ViewedAt = timeNow
			doc.ClosedAt = 0
			found = true
			break
		}
	}

	// 如果文档不存在，创建新记录
	if !found {
		recentDoc := &RecentDoc{
			RootID: rootID,
			// 新创建的记录不设置 OpenAt，因为这是浏览而不是打开
			ViewedAt: timeNow,
		}
		recentDocs = append([]*RecentDoc{recentDoc}, recentDocs...)
	}

	err = setRecentDocs(recentDocs)
	return
}

// UpdateRecentDocCloseTime 更新文档关闭时间
func UpdateRecentDocCloseTime(rootID string) (err error) {
	return BatchUpdateRecentDocCloseTime([]string{rootID})
}

// BatchUpdateRecentDocCloseTime 批量更新文档关闭时间
func BatchUpdateRecentDocCloseTime(rootIDs []string) (err error) {
	if len(rootIDs) == 0 {
		return
	}

	recentDocLock.Lock()
	defer recentDocLock.Unlock()

	recentDocs, err := loadRecentDocsRaw()
	if err != nil {
		return
	}

	rootIDs = gulu.Str.RemoveDuplicatedElem(rootIDs)
	rootIDsMap := make(map[string]bool, len(rootIDs))
	for _, id := range rootIDs {
		rootIDsMap[id] = true
	}

	closeTime := time.Now().Unix()

	// 更新已存在的文档
	updated := false
	for _, doc := range recentDocs {
		if rootIDsMap[doc.RootID] {
			doc.ClosedAt = closeTime
			updated = true
			delete(rootIDsMap, doc.RootID) // 标记已处理
		}
	}

	// 为不存在的文档创建新记录
	for rootID := range rootIDsMap {
		tree, loadErr := LoadTreeByBlockID(rootID)
		if loadErr != nil {
			continue
		}

		recentDoc := &RecentDoc{
			RootID:   tree.Root.ID,
			ClosedAt: closeTime, // 设置关闭时间
		}

		recentDocs = append([]*RecentDoc{recentDoc}, recentDocs...)
		updated = true
	}

	if updated {
		err = setRecentDocs(recentDocs)
	}
	return
}

func GetRecentDocs(sortBy string) (ret []*RecentDoc, err error) {
	recentDocLock.Lock()
	defer recentDocLock.Unlock()
	return getRecentDocs(sortBy)
}

func setRecentDocs(recentDocs []*RecentDoc) (err error) {
	recentDocs = normalizeRecentDocs(recentDocs)

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

func loadRecentDocsRaw() (ret []*RecentDoc, err error) {
	dataPath := filepath.Join(util.DataDir, "storage/recent-doc.json")
	if !filelock.IsExist(dataPath) {
		return
	}

	data, err := filelock.ReadFile(dataPath)
	if err != nil {
		logging.LogErrorf("read storage [recent-doc] failed: %s", err)
		return
	}

	if err = gulu.JSON.UnmarshalJSON(data, &ret); err != nil {
		logging.LogErrorf("unmarshal storage [recent-doc] failed: %s", err)
		if err = setRecentDocs([]*RecentDoc{}); err != nil {
			logging.LogErrorf("reset storage [recent-doc] failed: %s", err)
		}
		ret = []*RecentDoc{}
		return
	}
	return
}

func getRecentDocs(sortBy string) (ret []*RecentDoc, err error) {
	ret = []*RecentDoc{} // 初始化为空切片，确保 API 始终返回非 nil
	recentDocs, err := loadRecentDocsRaw()
	if err != nil {
		return
	}

	// 去重
	seen := make(map[string]struct{}, len(recentDocs))
	var deduplicated []*RecentDoc
	for _, doc := range recentDocs {
		if _, ok := seen[doc.RootID]; !ok {
			seen[doc.RootID] = struct{}{}
			deduplicated = append(deduplicated, doc)
		}
	}

	var rootIDs []string
	for _, doc := range deduplicated {
		rootIDs = append(rootIDs, doc.RootID)
	}
	bts := treenode.GetBlockTrees(rootIDs)
	var notExists []string
	for _, doc := range deduplicated {
		if bt := bts[doc.RootID]; nil != bt {
			// 获取最新的文档标题和图标
			doc.Title = path.Base(bt.HPath) // Recent docs not updated after renaming https://github.com/siyuan-note/siyuan/issues/7827
			ial := sql.GetBlockAttrs(doc.RootID)
			if "" != ial["icon"] {
				doc.Icon = ial["icon"]
			}
			ret = append(ret, doc)
		} else {
			notExists = append(notExists, doc.RootID)
		}
	}

	if 0 < len(notExists) {
		err = setRecentDocs(ret)
		if err != nil {
			return
		}
	}

	// 根据排序参数进行排序
	switch sortBy {
	case "updated": // 按更新时间排序
		// 从数据库查询最近修改的文档
		sqlBlocks := sql.SelectBlocksRawStmt("SELECT * FROM blocks WHERE type = 'd' ORDER BY updated DESC", 1, Conf.FileTree.RecentDocsMaxListCount)
		ret = []*RecentDoc{}
		if 1 > len(sqlBlocks) {
			return
		}

		// 获取文档树信息
		var rootIDs []string
		for _, sqlBlock := range sqlBlocks {
			rootIDs = append(rootIDs, sqlBlock.ID)
		}
		bts := treenode.GetBlockTrees(rootIDs)

		for _, sqlBlock := range sqlBlocks {
			bt := bts[sqlBlock.ID]
			if nil == bt {
				continue
			}

			// 解析 IAL 获取 icon
			icon := ""
			if sqlBlock.IAL != "" {
				ialStr := strings.TrimPrefix(sqlBlock.IAL, "{:")
				ialStr = strings.TrimSuffix(ialStr, "}")
				ial := parse.Tokens2IAL([]byte(ialStr))
				for _, kv := range ial {
					if kv[0] == "icon" {
						icon = kv[1]
						break
					}
				}
			}
			// 获取文档标题
			title := path.Base(bt.HPath)
			doc := &RecentDoc{
				RootID: sqlBlock.ID,
				Icon:   icon,
				Title:  title,
			}
			ret = append(ret, doc)
		}
	case "closedAt": // 按关闭时间排序
		filtered := []*RecentDoc{} // 初始化为空切片，确保 API 始终返回非 nil
		for _, doc := range ret {
			if doc.ClosedAt > 0 {
				filtered = append(filtered, doc)
			}
		}
		ret = filtered
		if 0 < len(ret) {
			sort.Slice(ret, func(i, j int) bool {
				return ret[i].ClosedAt > ret[j].ClosedAt
			})
		}
	case "openAt": // 按打开时间排序
		filtered := []*RecentDoc{} // 初始化为空切片，确保 API 始终返回非 nil
		for _, doc := range ret {
			if doc.OpenAt > 0 {
				filtered = append(filtered, doc)
			}
		}
		ret = filtered
		if 0 < len(ret) {
			sort.Slice(ret, func(i, j int) bool {
				return ret[i].OpenAt > ret[j].OpenAt
			})
		}
	case "viewedAt": // 按浏览时间排序
		fallthrough
	default:
		filtered := []*RecentDoc{} // 初始化为空切片，确保 API 始终返回非 nil
		for _, doc := range ret {
			if doc.ViewedAt > 0 {
				filtered = append(filtered, doc)
			}
		}
		ret = filtered
		if 0 < len(ret) {
			sort.Slice(ret, func(i, j int) bool {
				return ret[i].ViewedAt > ret[j].ViewedAt
			})
		}
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
