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
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/88250/gulu"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const (
	viewStateVersion        = 1
	maxViewStateCount       = 2000
	maxViewStateDataCount   = 10000
	maxViewStatePatchCount  = 1000
	maxViewStatePatchBytes  = 256 * 1024
	maxViewStateStorageSize = 16 * 1024 * 1024
)

type ViewState struct {
	Updated int64          `json:"updatedAt"`
	Data    map[string]any `json:"data"`
	Order   []string       `json:"fieldOrder,omitempty"`
}

type viewStateStorage struct {
	Version int                   `json:"version"`
	Views   map[string]*ViewState `json:"views"`
}

type viewStatePatch struct {
	Values     map[string]any `json:"values"`
	RemoveKeys []string       `json:"removeKeys"`
}

var viewStateStorageLock = sync.Mutex{}

func GetViewState(key string) (ret map[string]any, err error) {
	if err = validateViewStateKey(key); err != nil {
		return
	}

	viewStateStorageLock.Lock()
	defer viewStateStorageLock.Unlock()

	storage, err := getViewStateStorage()
	if err != nil {
		return nil, err
	}
	state := storage.Views[key]
	if nil == state || nil == state.Data {
		return map[string]any{}, nil
	}
	return cloneViewStateData(state.Data)
}

func PatchViewState(key string, values map[string]any, removeKeys []string) (ret map[string]any, err error) {
	if err = validateViewStateKey(key); err != nil {
		return
	}
	if maxViewStatePatchCount < len(values)+len(removeKeys) {
		return nil, errors.New("view state patch contains too many entries")
	}
	for valueKey := range values {
		if err = validateViewStateDataKey(valueKey); err != nil {
			return nil, err
		}
	}
	for _, removeKey := range removeKeys {
		if err = validateViewStateDataKey(removeKey); err != nil {
			return nil, err
		}
	}
	patch := &viewStatePatch{Values: values, RemoveKeys: removeKeys}
	patchData, marshalErr := gulu.JSON.MarshalJSON(patch)
	if nil != marshalErr {
		return nil, marshalErr
	}
	if maxViewStatePatchBytes < len(patchData) {
		return nil, errors.New("view state patch is too large")
	}
	// 后续合并使用序列化快照，避免调用方在请求执行期间继续修改嵌套值。
	normalizedPatch := &viewStatePatch{}
	if err = gulu.JSON.UnmarshalJSON(patchData, &normalizedPatch); nil != err {
		return nil, err
	}
	values = normalizedPatch.Values
	removeKeys = normalizedPatch.RemoveKeys

	viewStateStorageLock.Lock()
	defer viewStateStorageLock.Unlock()

	storage, err := getViewStateStorage()
	if err != nil {
		return nil, err
	}
	state := storage.Views[key]
	if nil == state {
		state = &ViewState{Data: map[string]any{}, Order: []string{}}
		storage.Views[key] = state
	} else if nil == state.Data {
		state.Data = map[string]any{}
	}
	for valueKey, value := range values {
		state.Data[valueKey] = value
	}
	for _, removeKey := range removeKeys {
		delete(state.Data, removeKey)
	}
	touchViewStateFields(state, values)
	pruneViewStateFields(state)
	if 0 == len(state.Data) {
		delete(storage.Views, key)
	} else {
		state.Updated = nextViewStateUpdated(storage.Views)
	}
	pruneViewStates(storage.Views)
	if err = setViewStateStorage(storage); err != nil {
		return nil, err
	}
	if nil == storage.Views[key] {
		return map[string]any{}, nil
	}
	return cloneViewStateData(storage.Views[key].Data)
}

func cloneViewStateData(data map[string]any) (ret map[string]any, err error) {
	serialized, err := gulu.JSON.MarshalJSON(data)
	if nil != err {
		return nil, err
	}
	if err = gulu.JSON.UnmarshalJSON(serialized, &ret); nil != err {
		return nil, err
	}
	return
}

func RemoveViewState(key string) (err error) {
	if err = validateViewStateKey(key); err != nil {
		return
	}

	viewStateStorageLock.Lock()
	defer viewStateStorageLock.Unlock()

	storage, err := getViewStateStorage()
	if err != nil {
		return err
	}
	delete(storage.Views, key)
	return setViewStateStorage(storage)
}

func nextViewStateUpdated(views map[string]*ViewState) int64 {
	ret := time.Now().UnixMilli()
	for _, state := range views {
		if nil == state {
			continue
		}
		if math.MaxInt64 == state.Updated {
			keys := make([]string, 0, len(views))
			for key, candidate := range views {
				if nil != candidate {
					keys = append(keys, key)
				}
			}
			sort.Slice(keys, func(i, j int) bool {
				left, right := views[keys[i]], views[keys[j]]
				if left.Updated == right.Updated {
					return keys[i] < keys[j]
				}
				return left.Updated < right.Updated
			})
			for i, key := range keys {
				views[key].Updated = int64(i + 1)
			}
			return int64(len(keys) + 1)
		}
		if ret <= state.Updated {
			ret = state.Updated + 1
		}
	}
	return ret
}

func validateViewStateKey(key string) error {
	if "" == strings.TrimSpace(key) || 1024 < len(key) {
		return errors.New("invalid view state key")
	}
	return nil
}

func validateViewStateDataKey(key string) error {
	if "" == strings.TrimSpace(key) || 2048 < len(key) {
		return errors.New("invalid view state data key")
	}
	return nil
}

func pruneViewStates(views map[string]*ViewState) {
	if len(views) <= maxViewStateCount {
		return
	}

	keys := make([]string, 0, len(views))
	for key := range views {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(i, j int) bool {
		left, right := views[keys[i]], views[keys[j]]
		if left.Updated == right.Updated {
			return keys[i] < keys[j]
		}
		return left.Updated < right.Updated
	})
	for _, key := range keys[:len(keys)-maxViewStateCount] {
		delete(views, key)
	}
}

func touchViewStateFields(state *ViewState, values map[string]any) {
	normalizeViewStateFieldOrder(state)
	touched := map[string]bool{}
	for key := range values {
		if _, exists := state.Data[key]; exists {
			touched[key] = true
		}
	}
	order := make([]string, 0, len(state.Order))
	for _, key := range state.Order {
		if !touched[key] {
			order = append(order, key)
		}
	}
	keys := make([]string, 0, len(touched))
	for key := range touched {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	state.Order = append(order, keys...)
}

func normalizeViewStateFieldOrder(state *ViewState) {
	seen := map[string]bool{}
	order := make([]string, 0, len(state.Data))
	for _, key := range state.Order {
		if _, exists := state.Data[key]; exists && !seen[key] {
			seen[key] = true
			order = append(order, key)
		}
	}
	missing := make([]string, 0, len(state.Data)-len(order))
	for key := range state.Data {
		if !seen[key] {
			missing = append(missing, key)
		}
	}
	sort.Strings(missing)
	state.Order = append(order, missing...)
}

func pruneViewStateFields(state *ViewState) {
	normalizeViewStateFieldOrder(state)
	if len(state.Order) <= maxViewStateDataCount {
		return
	}
	for _, key := range state.Order[:len(state.Order)-maxViewStateDataCount] {
		delete(state.Data, key)
	}
	state.Order = state.Order[len(state.Order)-maxViewStateDataCount:]
}

func getViewStateStorage() (ret *viewStateStorage, err error) {
	ret = &viewStateStorage{
		Version: viewStateVersion,
		Views:   map[string]*ViewState{},
	}
	dataPath := filepath.Join(util.DataDir, "storage", "view-state.json")
	if !filelock.IsExist(dataPath) {
		return
	}

	data, err := filelock.ReadFile(dataPath)
	if err != nil {
		logging.LogErrorf("read storage [view-state] failed: %s", err)
		return nil, err
	}
	header := struct {
		Version int `json:"version"`
	}{}
	if err = gulu.JSON.UnmarshalJSON(data, &header); err != nil {
		return backupCorruptedViewState(dataPath, err)
	}
	if viewStateVersion < header.Version {
		return nil, fmt.Errorf("unsupported view state version %d", header.Version)
	}
	if err = gulu.JSON.UnmarshalJSON(data, ret); err != nil {
		return backupCorruptedViewState(dataPath, err)
	}
	if nil == ret.Views {
		ret.Views = map[string]*ViewState{}
	}
	for key, state := range ret.Views {
		if nil == state {
			delete(ret.Views, key)
			continue
		}
		if nil == state.Data {
			state.Data = map[string]any{}
		}
	}
	pruneViewStates(ret.Views)
	for _, state := range ret.Views {
		pruneViewStateFields(state)
	}
	if maxViewStateStorageSize < len(data) {
		if _, err = marshalViewStateStorage(ret); nil != err {
			return nil, err
		}
	}
	ret.Version = viewStateVersion
	return
}

func backupCorruptedViewState(dataPath string, parseErr error) (ret *viewStateStorage, err error) {
	backupPath := filepath.Join(filepath.Dir(dataPath), fmt.Sprintf("view-state-corrupted-%d.json", time.Now().UnixMilli()))
	if err = os.Rename(dataPath, backupPath); nil != err {
		logging.LogErrorf("backup corrupted storage [view-state] failed: %s", err)
		return nil, parseErr
	}
	logging.LogWarnf("unmarshal storage [view-state] failed, moved to [%s]: %s", backupPath, parseErr)
	return &viewStateStorage{Version: viewStateVersion, Views: map[string]*ViewState{}}, nil
}

func setViewStateStorage(storage *viewStateStorage) (err error) {
	storageDir := filepath.Join(util.DataDir, "storage")
	if err = os.MkdirAll(storageDir, 0755); err != nil {
		logging.LogErrorf("create storage [view-state] dir failed: %s", err)
		return err
	}

	data, err := marshalViewStateStorage(storage)
	if err != nil {
		logging.LogErrorf("marshal storage [view-state] failed: %s", err)
		return err
	}

	dataPath := filepath.Join(storageDir, "view-state.json")
	if err = filelock.WriteFile(dataPath, data); err != nil {
		logging.LogErrorf("write storage [view-state] failed: %s", err)
	}
	return
}

func marshalViewStateStorage(storage *viewStateStorage) (data []byte, err error) {
	for {
		data, err = gulu.JSON.MarshalIndentJSON(storage, "", "  ")
		if err != nil {
			return nil, err
		}
		if len(data) <= maxViewStateStorageSize {
			return
		}
		if len(storage.Views) <= 1 {
			key := oldestViewStateKey(storage.Views)
			state := storage.Views[key]
			normalizeViewStateFieldOrder(state)
			if 0 == len(state.Order) {
				return nil, errors.New("view state storage is too large")
			}
			delete(state.Data, state.Order[0])
			state.Order = state.Order[1:]
			if 0 == len(state.Data) {
				delete(storage.Views, key)
			}
			continue
		}
		delete(storage.Views, oldestViewStateKey(storage.Views))
	}
}

func oldestViewStateKey(views map[string]*ViewState) (ret string) {
	for key, state := range views {
		if "" == ret || state.Updated < views[ret].Updated ||
			(state.Updated == views[ret].Updated && key < ret) {
			ret = key
		}
	}
	return
}
