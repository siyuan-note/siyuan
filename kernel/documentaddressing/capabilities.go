// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package documentaddressing

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/88250/lute/ast"
)

// ModeSnapshot 描述经过校验的能力要求，不代表当前读取器可以处理该模式。
type ModeSnapshot struct {
	Mode              int
	Revision          string
	State             string
	Phase             string
	RecordsConsistent bool
}

// InspectBox 不读取文档或派生索引。合法的高模式与 CheckBox 一样记入本机下界，
// 配置损坏则返回错误，不向调用方伪装成旧服务端或兼容模式。
func InspectBox(dataDir, confDir, boxID string) (*ModeSnapshot, error) {
	storeLock.Lock()
	defer storeLock.Unlock()
	snapshot, _, err := inspectBox(dataDir, confDir, boxID)
	return snapshot, err
}

func inspectBox(dataDir, confDir, boxID string) (*ModeSnapshot, *localStore, error) {
	if !ast.IsNodeIDPattern(boxID) {
		return nil, nil, ErrInvalid
	}
	store, err := loadStore(dataDir, confDir)
	if err != nil {
		return nil, nil, err
	}
	read := directoryReader(filepath.Join(dataDir, boxID))
	sources := map[string]string{}
	consistent := true
	mode, err := ReadMode(boxID, func(name string) ([]byte, error) {
		data, readErr := read(name)
		if readErr == nil {
			digest := sha256.Sum256(data)
			sources[name] = hex.EncodeToString(digest[:])
			fields, parseErr := object(data, name == ConfigPath)
			key := "minimumMode"
			if name == ConfigPath {
				key = "documentaddressingversion"
			}
			value, valueErr := positiveInt(fields[key])
			consistent = consistent && parseErr == nil && valueErr == nil && value == 2
		} else if errors.Is(readErr, os.ErrNotExist) {
			consistent = false
		}
		return data, readErr
	})
	if err != nil {
		return nil, nil, fmt.Errorf("notebook [%s]: %w", boxID, err)
	}
	mode = store.confirm(boxID, mode)
	if err = store.save(); err != nil {
		return nil, nil, err
	}
	record, err := readMigration(store, boxID)
	if err != nil {
		return nil, nil, err
	}
	snapshot := &ModeSnapshot{Mode: mode, State: "legacy", RecordsConsistent: consistent}
	if record != nil {
		snapshot.Phase = record.Phase
		snapshot.Mode = max(snapshot.Mode, 2)
		snapshot.State = "recovering"
		store.confirm(boxID, snapshot.Mode)
		if err = store.save(); err != nil {
			return nil, nil, err
		}
	}
	if snapshot.Mode > 1 {
		snapshot.State = "structured"
		if record != nil || !consistent {
			snapshot.State = "recovering"
		}
		if snapshot.Mode > DefaultMode() {
			snapshot.State = "conflict"
		}
	}
	data, err := json.Marshal([]interface{}{2, boxID, snapshot.Mode, sources, record})
	if err != nil {
		return nil, nil, err
	}
	digest := sha256.Sum256(data)
	snapshot.Revision = "2:" + hex.EncodeToString(digest[:])
	return snapshot, store, nil
}
