// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package documentaddressing

import (
	"encoding/json"
	"path/filepath"
)

// ExportBackup 将已确认的能力下界附在设置导出副本中，不改变普通设置或本机记录。
func ExportBackup(confDir string, configuration []byte) ([]byte, error) {
	storeLock.Lock()
	defer storeLock.Unlock()
	store, err := backupStore(confDir)
	if err != nil {
		return nil, err
	}
	if len(store.Notebooks) == 0 {
		return configuration, nil
	}
	fields, err := object(configuration, false)
	if err != nil {
		return nil, err
	}
	fields["documentAddressing"], err = json.Marshal(store)
	if err != nil {
		return nil, err
	}
	return json.MarshalIndent(fields, "", "  ")
}

// RestoreBackup 在采用设置前合并能力下界；旧设置没有该字段时保持本机记录不变。
// 高版本要求只被记住，不代表当前客户端能够处理对应的笔记本。
func RestoreBackup(confDir string, configuration []byte) error {
	fields, err := object(configuration, true)
	if err != nil {
		return err
	}
	data, exists := fields["documentaddressing"]
	if !exists {
		return nil
	}
	notebooks, err := parseStore(data)
	if err != nil {
		return err
	}
	storeLock.Lock()
	defer storeLock.Unlock()
	store, err := backupStore(confDir)
	if err != nil {
		return err
	}
	for id, mode := range notebooks {
		store.confirm(id, mode)
	}
	return store.save()
}

func backupStore(confDir string) (*localStore, error) {
	if !filepath.IsAbs(confDir) {
		return nil, ErrInvalid
	}
	return readStore(&localStore{Version: 1, Notebooks: map[string]int{}, path: filepath.Join(confDir, "document-addressing.json")})
}
