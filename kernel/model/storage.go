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
	"sync"

	"github.com/88250/gulu"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type RecentDoc struct {
	RootID string `json:"rootID"`
	Icon   string `json:"icon"`
	Title  string `json:"title"`
}

var recentDocLock = sync.Mutex{}

func RemoveRecentDoc(ids []string) {
	recentDocLock.Lock()
	defer recentDocLock.Unlock()

	recentDocs, err := getRecentDocs()
	if nil != err {
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
	if nil != err {
		return
	}
	return
}

func SetRecentDocByTree(tree *parse.Tree) {
	recentDoc := &RecentDoc{
		RootID: tree.Root.ID,
		Icon:   tree.Root.IALAttr("icon"),
		Title:  tree.Root.IALAttr("title"),
	}

	SetRecentDoc(recentDoc)
}

func SetRecentDoc(doc *RecentDoc) (err error) {
	recentDocLock.Lock()
	defer recentDocLock.Unlock()

	recentDocs, err := getRecentDocs()
	if nil != err {
		return
	}

	for i, c := range recentDocs {
		if c.RootID == doc.RootID {
			recentDocs = append(recentDocs[:i], recentDocs[i+1:]...)
			break
		}
	}

	recentDocs = append([]*RecentDoc{doc}, recentDocs...)
	if 32 < len(recentDocs) {
		recentDocs = recentDocs[:32]
	}

	err = setRecentDocs(recentDocs)
	return
}

func GetRecentDocs() (ret []*RecentDoc, err error) {
	recentDocLock.Lock()
	defer recentDocLock.Unlock()
	return getRecentDocs()
}

func setRecentDocs(recentDocs []*RecentDoc) (err error) {
	dirPath := filepath.Join(util.DataDir, "storage")
	if err = os.MkdirAll(dirPath, 0755); nil != err {
		logging.LogErrorf("create storage [recent-doc] dir failed: %s", err)
		return
	}

	data, err := gulu.JSON.MarshalIndentJSON(recentDocs, "", "  ")
	if nil != err {
		logging.LogErrorf("marshal storage [recent-doc] failed: %s", err)
		return
	}

	lsPath := filepath.Join(dirPath, "recent-doc.json")
	err = filelock.WriteFile(lsPath, data)
	if nil != err {
		logging.LogErrorf("write storage [recent-doc] failed: %s", err)
		return
	}
	return
}

func getRecentDocs() (ret []*RecentDoc, err error) {
	tmp := []*RecentDoc{}
	dataPath := filepath.Join(util.DataDir, "storage/recent-doc.json")
	if !gulu.File.IsExist(dataPath) {
		return
	}

	data, err := filelock.ReadFile(dataPath)
	if nil != err {
		logging.LogErrorf("read storage [recent-doc] failed: %s", err)
		return
	}

	if err = gulu.JSON.UnmarshalJSON(data, &tmp); nil != err {
		logging.LogErrorf("unmarshal storage [recent-doc] failed: %s", err)
		return
	}

	var notExists []string
	for _, doc := range tmp {
		if bt := treenode.GetBlockTree(doc.RootID); nil != bt {
			doc.Title = path.Base(bt.HPath) // Recent docs not updated after renaming https://github.com/siyuan-note/siyuan/issues/7827
			ret = append(ret, doc)
		} else {
			notExists = append(notExists, doc.RootID)
		}
	}
	if 0 < len(notExists) {
		setRecentDocs(ret)
	}
	return
}

type Criterion struct {
	Name       string          `json:"name"`
	Sort       int             `json:"sort"`       //  0：按块类型（默认），1：按创建时间升序，2：按创建时间降序，3：按更新时间升序，4：按更新时间降序，5：按内容顺序（仅在按文档分组时）
	Group      int             `json:"group"`      // 0：不分组，1：按文档分组
	HasReplace bool            `json:"hasReplace"` // 是否有替换
	Method     int             `json:"method"`     //  0：文本，1：查询语法，2：SQL，3：正则表达式
	HPath      string          `json:"hPath"`
	IDPath     []string        `json:"idPath"`
	K          string          `json:"k"`     // 搜索关键字
	R          string          `json:"r"`     // 替换关键字
	Types      *CriterionTypes `json:"types"` // 类型过滤选项
}

type CriterionTypes struct {
	MathBlock  bool `json:"mathBlock"`
	Table      bool `json:"table"`
	Blockquote bool `json:"blockquote"`
	SuperBlock bool `json:"superBlock"`
	Paragraph  bool `json:"paragraph"`
	Document   bool `json:"document"`
	Heading    bool `json:"heading"`
	List       bool `json:"list"`
	ListItem   bool `json:"listItem"`
	CodeBlock  bool `json:"codeBlock"`
	HtmlBlock  bool `json:"htmlBlock"`
	EmbedBlock bool `json:"embedBlock"`
}

var criteriaLock = sync.Mutex{}

func RemoveCriterion(name string) (err error) {
	criteriaLock.Lock()
	defer criteriaLock.Unlock()

	criteria, err := getCriteria()
	if nil != err {
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
	if nil != err {
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
	if err = os.MkdirAll(dirPath, 0755); nil != err {
		logging.LogErrorf("create storage [criteria] dir failed: %s", err)
		return
	}

	data, err := gulu.JSON.MarshalIndentJSON(criteria, "", "  ")
	if nil != err {
		logging.LogErrorf("marshal storage [criteria] failed: %s", err)
		return
	}

	lsPath := filepath.Join(dirPath, "criteria.json")
	err = filelock.WriteFile(lsPath, data)
	if nil != err {
		logging.LogErrorf("write storage [criteria] failed: %s", err)
		return
	}
	return
}

func getCriteria() (ret []*Criterion, err error) {
	ret = []*Criterion{}
	dataPath := filepath.Join(util.DataDir, "storage/criteria.json")
	if !gulu.File.IsExist(dataPath) {
		return
	}

	data, err := filelock.ReadFile(dataPath)
	if nil != err {
		logging.LogErrorf("read storage [criteria] failed: %s", err)
		return
	}

	if err = gulu.JSON.UnmarshalJSON(data, &ret); nil != err {
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
	if util.ReadOnly {
		return
	}

	dirPath := filepath.Join(util.DataDir, "storage")
	if err = os.MkdirAll(dirPath, 0755); nil != err {
		logging.LogErrorf("create storage [local] dir failed: %s", err)
		return
	}

	data, err := gulu.JSON.MarshalIndentJSON(val, "", "  ")
	if nil != err {
		logging.LogErrorf("marshal storage [local] failed: %s", err)
		return
	}

	lsPath := filepath.Join(dirPath, "local.json")
	err = filelock.WriteFile(lsPath, data)
	if nil != err {
		logging.LogErrorf("write storage [local] failed: %s", err)
		return
	}
	return
}

func getLocalStorage() (ret map[string]interface{}) {
	// When local.json is corrupted, clear the file to avoid being unable to enter the main interface https://github.com/siyuan-note/siyuan/issues/7911
	ret = map[string]interface{}{}
	lsPath := filepath.Join(util.DataDir, "storage/local.json")
	if !gulu.File.IsExist(lsPath) {
		return
	}

	data, err := filelock.ReadFile(lsPath)
	if nil != err {
		logging.LogErrorf("read storage [local] failed: %s", err)
		return
	}

	if err = gulu.JSON.UnmarshalJSON(data, &ret); nil != err {
		logging.LogErrorf("unmarshal storage [local] failed: %s", err)
		return
	}
	return
}
