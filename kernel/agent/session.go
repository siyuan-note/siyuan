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

package agent

import (
	"maps"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func isValidSessionID(id string) bool {
	return ast.IsNodeIDPattern(id)
}

var indexMu sync.Mutex

func sessionsIndexPath() string {
	return filepath.Join(util.DataDir, "storage", "ai", "agent", "sessions", "index.json")
}

func sessionsDir() string {
	return filepath.Join(util.DataDir, "storage", "ai", "agent", "sessions")
}

type SessionIndexItem struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	CreatedAt int64  `json:"createdAt"`
	UpdatedAt int64  `json:"updatedAt"`
}

type SessionListResult struct {
	Sessions []*SessionIndexItem `json:"sessions"`
	Total    int                 `json:"total"`
	Page     int                 `json:"page"`
	PageSize int                 `json:"pageSize"`
}

type sessionMeta struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	CreatedAt int64  `json:"createdAt"`
	UpdatedAt int64  `json:"updatedAt"`
}

func loadSessionIndex() map[string]*SessionIndexItem {
	data, err := os.ReadFile(sessionsIndexPath())
	if err != nil {
		return nil
	}
	var index map[string]*SessionIndexItem
	if gulu.JSON.UnmarshalJSON(data, &index) != nil {
		return nil
	}
	return index
}

func saveSessionIndex(index map[string]*SessionIndexItem) {
	data, err := gulu.JSON.MarshalIndentJSON(index, "", "\t")
	if err != nil {
		return
	}
	_ = os.MkdirAll(filepath.Dir(sessionsIndexPath()), 0755)
	if err := filelock.WriteFile(sessionsIndexPath(), data); err != nil {
		logging.LogErrorf("save session index failed: %s", err)
	}
}

func rebuildSessionIndex() map[string]*SessionIndexItem {
	entries, err := os.ReadDir(sessionsDir())
	if err != nil {
		return nil
	}
	index := map[string]*SessionIndexItem{}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		id := entry.Name()
		sessionPath := filepath.Join(sessionsDir(), id, "session.json")
		sessionData, err := os.ReadFile(sessionPath)
		if err != nil {
			continue
		}
		var meta sessionMeta
		if gulu.JSON.UnmarshalJSON(sessionData, &meta) != nil || meta.ID == "" {
			continue
		}
		title := meta.Title
		if title == "" {
			title = "AI Agent"
		}
		index[id] = &SessionIndexItem{
			ID:        meta.ID,
			Title:     title,
			CreatedAt: meta.CreatedAt,
			UpdatedAt: meta.UpdatedAt,
		}
	}
	saveSessionIndex(index)
	return index
}

func UpdateSessionIndex(id, title string, createdAt, updatedAt int64) {
	if id == "" {
		return
	}
	indexMu.Lock()
	defer indexMu.Unlock()

	index := loadSessionIndex()
	if index == nil {
		index = map[string]*SessionIndexItem{}
	}
	if title == "" {
		title = "AI Agent"
	}
	index[id] = &SessionIndexItem{
		ID:        id,
		Title:     title,
		CreatedAt: createdAt,
		UpdatedAt: updatedAt,
	}
	saveSessionIndex(index)
}

func ListSessions(page, pageSize int, keyword string) *SessionListResult {
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 30
	}

	indexMu.Lock()
	index := loadSessionIndex()
	if index == nil || len(index) == 0 {
		index = rebuildSessionIndex()
	}
	if index == nil {
		indexMu.Unlock()
		return &SessionListResult{
			Sessions: []*SessionIndexItem{},
			Total:    0,
			Page:     page,
			PageSize: pageSize,
		}
	}
	snapshot := make(map[string]*SessionIndexItem, len(index))
	maps.Copy(snapshot, index)
	indexMu.Unlock()

	entries, err := os.ReadDir(sessionsDir())
	if err == nil {
		dirMap := map[string]bool{}
		for _, entry := range entries {
			if entry.IsDir() {
				dirMap[entry.Name()] = true
			}
		}

		needsSave := false

		for id := range snapshot {
			if !dirMap[id] {
				delete(snapshot, id)
				needsSave = true
			}
		}

		for id := range dirMap {
			if _, ok := snapshot[id]; !ok {
				sessionPath := filepath.Join(sessionsDir(), id, "session.json")
				sessionData, err := os.ReadFile(sessionPath)
				if err == nil {
					var meta sessionMeta
					if gulu.JSON.UnmarshalJSON(sessionData, &meta) == nil && meta.ID != "" {
						title := meta.Title
						if title == "" {
							title = "AI Agent"
						}
						snapshot[id] = &SessionIndexItem{
							ID:        meta.ID,
							Title:     title,
							CreatedAt: meta.CreatedAt,
							UpdatedAt: meta.UpdatedAt,
						}
						needsSave = true
					}
				}
			}
		}

		if needsSave {
			indexMu.Lock()
			saveSessionIndex(snapshot)
			indexMu.Unlock()
		}
	}

	index = snapshot

	items := make([]*SessionIndexItem, 0, len(index))
	for _, item := range index {
		if keyword != "" {
			kw := strings.ToLower(keyword)
			title := strings.ToLower(item.Title)
			if !strings.Contains(title, kw) {
				continue
			}
		}
		items = append(items, item)
	}

	sort.Slice(items, func(i, j int) bool {
		return items[i].CreatedAt > items[j].CreatedAt
	})

	total := len(items)

	start := (page - 1) * pageSize
	if start >= total {
		return &SessionListResult{
			Sessions: []*SessionIndexItem{},
			Total:    total,
			Page:     page,
			PageSize: pageSize,
		}
	}
	end := min(start+pageSize, total)

	return &SessionListResult{
		Sessions: items[start:end],
		Total:    total,
		Page:     page,
		PageSize: pageSize,
	}
}

func GetSession(id string) (map[string]any, error) {
	if id == "" || !isValidSessionID(id) {
		return nil, nil
	}
	sessionPath := filepath.Join(sessionsDir(), id, "session.json")
	data, err := os.ReadFile(sessionPath)
	if err != nil {
		return nil, err
	}
	var session map[string]any
	if err := gulu.JSON.UnmarshalJSON(data, &session); err != nil {
		return nil, err
	}
	return session, nil
}

func SaveSession(data []byte) error {
	var meta sessionMeta
	if err := gulu.JSON.UnmarshalJSON(data, &meta); err != nil || meta.ID == "" || !isValidSessionID(meta.ID) {
		return nil
	}

	dir := filepath.Join(sessionsDir(), meta.ID)
	if err := os.MkdirAll(dir, 0755); err != nil {
		logging.LogErrorf("create session dir failed: %s", err)
	}
	path := filepath.Join(dir, "session.json")

	existing, err := os.ReadFile(path)
	if err == nil && len(existing) > 0 {
		var existingData map[string]any
		var newData map[string]any
		if gulu.JSON.UnmarshalJSON(existing, &existingData) == nil &&
			gulu.JSON.UnmarshalJSON(data, &newData) == nil {
			for k, v := range existingData {
				if _, ok := newData[k]; !ok {
					switch k {
					// messages 不再保留：以 entries 为唯一持久化数据源，
					// 前端下次保存时会用 entries 覆盖，老 messages 字段自然清除。
					case "createdAt", "titled", "messageHistory", "entries", "snapshots", "id", "alwaysAllow":
						newData[k] = v
					}
				}
			}
			merged, err := gulu.JSON.MarshalIndentJSON(newData, "", "\t")
			if err == nil {
				data = merged
			}
		}
	} else {
		var newData map[string]any
		if gulu.JSON.UnmarshalJSON(data, &newData) == nil {
			indented, err := gulu.JSON.MarshalIndentJSON(newData, "", "\t")
			if err == nil {
				data = indented
			}
		}
	}

	if err := filelock.WriteFile(path, data); err != nil {
		logging.LogErrorf("save session file failed: %s", err)
	}

	title := meta.Title
	if title == "" {
		title = "AI Agent"
	}
	UpdateSessionIndex(meta.ID, title, meta.CreatedAt, meta.UpdatedAt)

	return nil
}

func DeleteSession(id string) error {
	if id == "" || !isValidSessionID(id) {
		return nil
	}

	dir := filepath.Join(sessionsDir(), id)
	_ = os.RemoveAll(dir)

	indexMu.Lock()
	index := loadSessionIndex()
	if index != nil {
		delete(index, id)
		saveSessionIndex(index)
	}
	indexMu.Unlock()

	return nil
}
