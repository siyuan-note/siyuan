// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package documentaddressing

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"path/filepath"

	"github.com/88250/lute/ast"
)

// ModeSnapshot 描述经过校验的能力要求，不代表当前读取器可以处理该模式。
type ModeSnapshot struct {
	Mode     int
	Revision string
}

// InspectBox 不读取文档或派生索引。合法的高模式与 CheckBox 一样记入本机下界，
// 配置损坏则返回错误，不向调用方伪装成旧服务端或兼容模式。
func InspectBox(dataDir, confDir, boxID string) (*ModeSnapshot, error) {
	if !ast.IsNodeIDPattern(boxID) {
		return nil, ErrInvalid
	}
	storeLock.Lock()
	defer storeLock.Unlock()
	store, err := loadStore(dataDir, confDir)
	if err != nil {
		return nil, err
	}
	read := directoryReader(filepath.Join(dataDir, boxID))
	sources := map[string]string{}
	mode, err := ReadMode(boxID, func(name string) ([]byte, error) {
		data, readErr := read(name)
		if readErr == nil {
			digest := sha256.Sum256(data)
			sources[name] = hex.EncodeToString(digest[:])
		}
		return data, readErr
	})
	if err != nil {
		return nil, fmt.Errorf("notebook [%s]: %w", boxID, err)
	}
	mode = store.confirm(boxID, mode)
	if err = store.save(); err != nil {
		return nil, err
	}
	data, err := json.Marshal([]interface{}{1, boxID, mode, sources})
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256(data)
	return &ModeSnapshot{Mode: mode, Revision: "1:" + hex.EncodeToString(digest[:])}, nil
}
