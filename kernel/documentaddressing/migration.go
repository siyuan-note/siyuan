// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package documentaddressing

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"

	"github.com/siyuan-note/filelock"
)

// 最低读取版本只报告经过验证的兼容性信息，不控制标题功能是否启用。
var minimumReaderVersion string

var defaultMode = 2

var ErrRecovering = errors.New("document addressing recovery is pending")

func MinimumReaderVersion() *string {
	if minimumReaderVersion == "" {
		return nil
	}
	version := minimumReaderVersion
	return &version
}

// DefaultMode 是当前发行版自动采用的内部模式，不暴露为用户可写配置。
func DefaultMode() int {
	return defaultMode
}

// migrationRecord 仅保存身份及阶段；源文件和认证密钥从不进入迁移记录。
type migrationRecord struct {
	Version  int    `json:"version"`
	Notebook string `json:"notebook"`
	Phase    string `json:"phase"`
}

func migrationPath(store *localStore, boxID string) string {
	return filepath.Join(filepath.Dir(store.path), "document-addressing-recovery", boxID+".json")
}

func readMigration(store *localStore, boxID string) (*migrationRecord, error) {
	data, err := filelock.ReadFile(migrationPath(store, boxID))
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	fields, err := versionedObject(data)
	if err != nil || len(fields) != 3 {
		return nil, ErrInvalid
	}
	var record migrationRecord
	if json.Unmarshal(data, &record) != nil || record.Notebook != boxID || record.Phase != "records" {
		return nil, ErrInvalid
	}
	return &record, nil
}

// migrateBoxRecords 在源访问之前自动补齐模式投影。每次只写元数据，不批量读取或重写文档。
// 调用方持有 storeLock；决定先落盘，失败后下次访问继续，已经写入的下界只升不降。
func migrateBoxRecords(dataDir, boxID string, store *localStore, write func(string, []byte) error) error {
	directory := filepath.Join(dataDir, boxID)
	info, err := os.Lstat(directory)
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return ErrInvalid
	}
	name := filepath.Join(directory, ConfigPath)
	data, err := filelock.ReadFile(name)
	if err != nil {
		return err
	}
	// 既有配置已由 ReadMode 严格验证；保留未知字段及密文载荷的原始值。
	fields, err := object(data, false)
	if err != nil {
		return err
	}
	recordPath := migrationPath(store, boxID)
	if err = os.MkdirAll(filepath.Dir(recordPath), 0755); err != nil {
		return err
	}
	decision, _ := json.Marshal(migrationRecord{1, boxID, "records"})
	if err = write(recordPath, decision); err != nil {
		return err
	}
	store.confirm(boxID, 2)
	if err = store.saveUsing(write); err != nil {
		return err
	}
	floor, _ := json.Marshal(struct {
		Version     int    `json:"version"`
		Notebook    string `json:"notebook"`
		MinimumMode int    `json:"minimumMode"`
	}{1, boxID, 2})
	if err = write(filepath.Join(directory, FloorPath), floor); err != nil {
		return err
	}
	for key := range fields {
		if strings.EqualFold(key, "documentAddressingVersion") {
			delete(fields, key)
		}
	}
	fields["documentAddressingVersion"] = json.RawMessage("2")
	data, err = json.MarshalIndent(fields, "", "  ")
	if err != nil {
		return err
	}
	if err = write(name, data); err != nil {
		return err
	}
	return os.Remove(recordPath)
}
