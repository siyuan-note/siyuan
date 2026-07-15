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
	"errors"
	"fmt"
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
	ID                  string `json:"id"`
	Title               string `json:"title"`
	CreatedAt           int64  `json:"createdAt"`
	UpdatedAt           int64  `json:"updatedAt"`
	Revision            int64  `json:"revision"`
	ExpectedRevision    *int64 `json:"expectedRevision,omitempty"`
	CommitTurnID        string `json:"commitTurnID,omitempty"`
	RecoveryTurnID      string `json:"recoveryTurnID,omitempty"`
	LastCommittedTurnID string `json:"lastCommittedTurnID,omitempty"`
}

var ErrSessionConflict = errors.New("agent session revision conflict")
var ErrRuntimeNotFinalized = errors.New("agent runtime turn is not finalized")

var sessionLocks sync.Map

func sessionLock(id string) *sync.Mutex {
	lock, _ := sessionLocks.LoadOrStore(id, &sync.Mutex{})
	return lock.(*sync.Mutex)
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
	return GetSessionState(id, true)
}

func GetSessionState(id string, includeRuntime bool) (map[string]any, error) {
	if id == "" || !isValidSessionID(id) {
		return nil, fmt.Errorf("invalid session id")
	}
	lock := sessionLock(id)
	lock.Lock()
	defer lock.Unlock()

	sessionPath := filepath.Join(sessionsDir(), id, "session.json")
	data, err := os.ReadFile(sessionPath)
	if err != nil {
		return nil, err
	}
	var session map[string]any
	if err := gulu.JSON.UnmarshalJSON(data, &session); err != nil {
		return nil, err
	}
	if includeRuntime {
		if err := mergeRuntimeIntoSessionLocked(id, session); err != nil {
			return nil, err
		}
	}
	return session, nil
}

func SaveSession(data []byte) (int64, error) {
	revision, _, err := SaveSessionState(data)
	return revision, err
}

func SaveSessionState(data []byte) (int64, map[string]any, error) {
	var meta sessionMeta
	if err := gulu.JSON.UnmarshalJSON(data, &meta); err != nil || meta.ID == "" || !isValidSessionID(meta.ID) {
		return 0, nil, fmt.Errorf("invalid session data")
	}
	lock := sessionLock(meta.ID)
	lock.Lock()
	defer lock.Unlock()

	dir := filepath.Join(sessionsDir(), meta.ID)
	path := filepath.Join(dir, "session.json")

	var newData map[string]any
	if err := gulu.JSON.UnmarshalJSON(data, &newData); err != nil {
		return 0, nil, fmt.Errorf("decode session data failed: %w", err)
	}
	delete(newData, "expectedRevision")
	delete(newData, "commitTurnID")
	delete(newData, "recoveryTurnID")
	delete(newData, "recoveryState")
	delete(newData, "recoveryRevision")
	delete(newData, "agentRunning")
	delete(newData, "lastCommittedTurnID")
	commitTurnID := meta.CommitTurnID
	if commitTurnID == "" {
		commitTurnID = meta.RecoveryTurnID
	}

	currentRevision := int64(0)
	currentCommittedTurnID := ""
	existing, err := os.ReadFile(path)
	if err == nil && len(existing) > 0 {
		var existingData map[string]any
		if err := gulu.JSON.UnmarshalJSON(existing, &existingData); err != nil {
			return 0, nil, fmt.Errorf("decode existing session data failed: %w", err)
		} else {
			currentRevision = numberToInt64(existingData["revision"])
			currentCommittedTurnID, _ = existingData["lastCommittedTurnID"].(string)
			if commitTurnID != "" && currentCommittedTurnID == commitTurnID {
				// 提交响应丢失后，客户端可能原样重试同一个 commitTurnID。此判断要先于修订号校验，
				// 并且不能再用客户端快照覆盖已经由 runtime 生成的权威内容。
				if err := markRuntimeCommittedLocked(meta.ID, commitTurnID); err != nil {
					logging.LogWarnf("clean committed agent runtime failed: %s", err)
				}
				return currentRevision, existingData, nil
			}
			if meta.ExpectedRevision != nil && *meta.ExpectedRevision != currentRevision {
				return currentRevision, nil, ErrSessionConflict
			}
			for k, v := range existingData {
				if _, ok := newData[k]; !ok {
					// messages 是已废弃的旧会话字段，不再带入新格式；其他未知字段原样保留，
					// 避免前后端版本不一致时擦除较新版本写入的数据。
					if k != "messages" && k != "expectedRevision" && k != "commitTurnID" &&
						k != "recoveryTurnID" && k != "recoveryState" && k != "recoveryRevision" && k != "agentRunning" {
						newData[k] = v
					}
				}
			}
		}
	} else if err != nil && !os.IsNotExist(err) {
		return 0, nil, fmt.Errorf("read session file failed: %w", err)
	} else if meta.ExpectedRevision != nil && *meta.ExpectedRevision != 0 {
		return 0, nil, ErrSessionConflict
	}
	if commitTurnID != "" {
		runtime, err := loadRuntimeLocked(meta.ID)
		if err != nil {
			return currentRevision, nil, fmt.Errorf("read agent runtime failed: %w", err)
		}
		if runtime.ActiveTurn != nil {
			if runtime.ActiveTurn.TurnID != commitTurnID {
				return currentRevision, nil, ErrSessionConflict
			}
			if !isRuntimeTurnTerminal(runtime.ActiveTurn) {
				return currentRevision, nil, ErrRuntimeNotFinalized
			}
			if err := applyRuntimeTurnToSessionLocked(newData, runtime.ActiveTurn); err != nil {
				return currentRevision, nil, err
			}
		} else if currentCommittedTurnID != commitTurnID {
			return currentRevision, nil, ErrSessionConflict
		}
	}

	newRevision := currentRevision + 1
	newData["revision"] = newRevision
	if commitTurnID != "" {
		newData["lastCommittedTurnID"] = commitTurnID
	}
	data, err = gulu.JSON.MarshalIndentJSON(newData, "", "\t")
	if err != nil {
		return currentRevision, nil, fmt.Errorf("encode session data failed: %w", err)
	}

	if err := os.MkdirAll(dir, 0755); err != nil {
		return currentRevision, nil, fmt.Errorf("create session dir failed: %w", err)
	}
	if err := filelock.WriteFile(path, data); err != nil {
		return currentRevision, nil, fmt.Errorf("save session file failed: %w", err)
	}
	if commitTurnID != "" {
		if err := markRuntimeCommittedLocked(meta.ID, commitTurnID); err != nil {
			logging.LogWarnf("commit agent runtime failed: %s", err)
		}
	}

	title, _ := newData["title"].(string)
	if title == "" {
		title = "AI Agent"
	}
	createdAt := meta.CreatedAt
	if value := numberToInt64(newData["createdAt"]); value > 0 {
		createdAt = value
	}
	updatedAt := meta.UpdatedAt
	if value := numberToInt64(newData["updatedAt"]); value > 0 {
		updatedAt = value
	}
	UpdateSessionIndex(meta.ID, title, createdAt, updatedAt)

	return newRevision, newData, nil
}

func DeleteSession(id string) error {
	if id == "" || !isValidSessionID(id) {
		return fmt.Errorf("invalid session id")
	}
	lock := sessionLock(id)
	lock.Lock()
	defer lock.Unlock()

	dir := filepath.Join(sessionsDir(), id)
	if err := os.RemoveAll(dir); err != nil {
		return err
	}

	indexMu.Lock()
	index := loadSessionIndex()
	if index != nil {
		delete(index, id)
		saveSessionIndex(index)
	}
	indexMu.Unlock()

	return nil
}

func numberToInt64(value any) int64 {
	switch v := value.(type) {
	case float64:
		return int64(v)
	case int64:
		return v
	case int:
		return int64(v)
	case jsonNumber:
		parsed, _ := v.Int64()
		return parsed
	}
	return 0
}

// jsonNumber 保持与 encoding/json.Number 相同的最小接口，避免会话存储依赖具体解码器实现。
type jsonNumber interface {
	Int64() (int64, error)
}
