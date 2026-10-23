// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

// Package documentaddressing 校验笔记本寻址模式，阻止不支持的客户端修复或改写源数据。
package documentaddressing

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/filelock"
)

const (
	ConfigPath = ".siyuan/conf.json"
	FloorPath  = ".siyuan/document-addressing.json"
)

var (
	ErrInvalid     = errors.New("invalid document addressing metadata")
	ErrUnsupported = errors.New("unsupported document addressing mode")
	storeLock      sync.Mutex
)

// Reader 读取相对路径；不存在的文件必须返回 os.ErrNotExist，不能以空内容代替。
type Reader func(string) ([]byte, error)

// ReadMode 只检查源记录，不修改源文件，也不将导入档案的身份记入本机能力下界。
func ReadMode(boxID string, read Reader) (int, error) {
	mode := 1
	data, err := read(ConfigPath)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return 0, err
	}
	if err == nil {
		fields, parseErr := object(data, true)
		if parseErr != nil {
			return 0, parseErr
		}
		if value, exists := fields["documentaddressingversion"]; exists {
			if mode, err = positiveInt(value); err != nil {
				return 0, err
			}
		}
	}
	data, err = read(FloorPath)
	if errors.Is(err, os.ErrNotExist) {
		return mode, nil
	}
	if err != nil {
		return 0, err
	}
	fields, err := versionedObject(data)
	if err != nil || len(fields) != 3 {
		return 0, ErrInvalid
	}
	var notebook string
	if json.Unmarshal(fields["notebook"], &notebook) != nil || !ast.IsNodeIDPattern(notebook) || notebook != boxID {
		return 0, ErrInvalid
	}
	floor, err := positiveInt(fields["minimumMode"])
	if err != nil {
		return 0, err
	}
	return max(mode, floor), nil
}

// CheckSource 检查尚未导入工作空间的笔记本，不确认或改变其本机模式。
func CheckSource(boxID, directory string) error {
	mode, err := ReadMode(boxID, directoryReader(directory))
	if err != nil {
		return err
	}
	return checkSupported(boxID, mode)
}

// CheckImport 采用已经确认的源身份下界，但不因检查未采用的档案而登记新的身份。
func CheckImport(dataDir, confDir, boxID, directory string) error {
	storeLock.Lock()
	defer storeLock.Unlock()
	store, err := loadStore(dataDir, confDir)
	if err != nil {
		return err
	}
	mode, err := ReadMode(boxID, directoryReader(directory))
	if err != nil {
		return err
	}
	if ast.IsNodeIDPattern(boxID) {
		record, readErr := readMigration(store, boxID)
		if readErr != nil {
			return readErr
		}
		if record != nil {
			mode = max(mode, 2)
		}
	}
	return checkSupported(boxID, max(mode, store.Notebooks[boxID]))
}

// CheckBox 在任何源数据修复、索引和读写前确认能力下界。合法的较高要求只升不降。
func CheckBox(dataDir, confDir, boxID string) error {
	_, err := BoxMode(dataDir, confDir, boxID)
	return err
}

// BoxMode 在确认能力下界和完成自动迁移后返回可用模式，避免调用者重复读取元数据。
func BoxMode(dataDir, confDir, boxID string) (int, error) {
	storeLock.Lock()
	defer storeLock.Unlock()
	snapshot, store, err := inspectBox(dataDir, confDir, boxID)
	if err != nil {
		return 0, err
	}
	if err = checkSupported(boxID, snapshot.Mode); err != nil {
		return 0, err
	}
	if DefaultMode() == 2 && (snapshot.Mode == 1 || snapshot.State == "recovering") {
		// 新笔记本尚未创建配置时不生成目录；恢复旧身份时也不能重建已删除的笔记本。
		_, statErr := os.Stat(filepath.Join(dataDir, boxID, ConfigPath))
		if errors.Is(statErr, os.ErrNotExist) && snapshot.Mode == 1 {
			return 1, nil
		}
		if statErr != nil {
			return 0, statErr
		}
		if err = migrateBoxRecords(dataDir, boxID, store, filelock.WriteFile); err != nil {
			return 0, err
		}
		return 2, nil
	}
	if snapshot.State == "conflict" {
		return 0, ErrModeConflict
	}
	if snapshot.State == "recovering" {
		return 0, ErrRecovering
	}
	return snapshot.Mode, nil
}

// CheckBatch 校验一次同步或恢复的完整替换计划；调用者必须在任何源文件变动前调用。
// read 只读取计划中的新文件，不能回读当前工作空间。拒绝批次时仍保留已确认的能力下界。
func CheckBatch(dataDir, confDir string, upserts, removes []string, read Reader) error {
	storeLock.Lock()
	defer storeLock.Unlock()
	store, err := loadStore(dataDir, confDir)
	if err != nil {
		return err
	}
	upsertSet, removeSet, boxes := map[string]bool{}, map[string]bool{}, map[string]bool{}
	for _, group := range []struct {
		paths []string
		set   map[string]bool
	}{{upserts, upsertSet}, {removes, removeSet}} {
		for _, name := range group.paths {
			name = strings.TrimPrefix(filepath.ToSlash(name), "/")
			if name == "" || name == "." || name == ".." || strings.HasPrefix(name, "../") ||
				filepath.IsAbs(name) || filepath.VolumeName(name) != "" ||
				filepath.ToSlash(filepath.Clean(name)) != name || strings.Contains(name, "\\") {
				return ErrInvalid
			}
			group.set[name] = true
			boxID, relative, found := strings.Cut(name, "/")
			if found && ast.IsNodeIDPattern(strings.ToLower(boxID)) {
				// 大小写别名在部分文件系统上会覆盖规范路径，不能绕过元数据预检。
				metadata := strings.ToLower(relative)
				if boxID != strings.ToLower(boxID) ||
					((metadata == ConfigPath || metadata == FloorPath) && relative != metadata) {
					return ErrInvalid
				}
				boxes[boxID] = true
			}
		}
	}
	ids := make([]string, 0, len(boxes))
	for id := range boxes {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	var failures []error
	for _, boxID := range ids {
		current := directoryReader(filepath.Join(dataDir, boxID))
		mode, currentErr := ReadMode(boxID, current)
		record, recoveryErr := readMigration(store, boxID)
		if record != nil {
			mode = max(mode, 2)
		}
		currentErr = errors.Join(currentErr, recoveryErr)
		if currentErr == nil {
			mode = store.confirm(boxID, mode)
		}
		deleted, deleteErr := deletesNotebook(dataDir, boxID, upsertSet, removeSet)
		if deleteErr != nil {
			failures = append(failures, deleteErr)
			continue
		}
		if deleted {
			// 整本删除不要求解释源格式，也不能为了恢复下界而重建已删除的目录。
			continue
		}
		incoming, incomingErr := ReadMode(boxID, func(name string) ([]byte, error) {
			rel := boxID + "/" + name
			if upsertSet[rel] {
				return read(rel)
			}
			if removeSet[rel] {
				return nil, os.ErrNotExist
			}
			return current(name)
		})
		if incomingErr == nil {
			mode = max(mode, store.confirm(boxID, incoming))
		}
		if currentErr != nil || incomingErr != nil {
			failures = append(failures, fmt.Errorf("notebook [%s]: %w", boxID, errors.Join(currentErr, incomingErr)))
		} else if err = checkSupported(boxID, mode); err != nil {
			failures = append(failures, err)
		}
	}
	if err = store.save(); err != nil {
		failures = append(failures, err)
	}
	return errors.Join(failures...)
}

func checkSupported(boxID string, mode int) error {
	if mode > DefaultMode() {
		return fmt.Errorf("%w [%s, mode=%d]", ErrUnsupported, boxID, mode)
	}
	return nil
}

func directoryReader(directory string) Reader {
	return func(name string) ([]byte, error) { return filelock.ReadFile(filepath.Join(directory, name)) }
}

func deletesNotebook(dataDir, boxID string, upserts, removes map[string]bool) (bool, error) {
	prefix := boxID + "/"
	for name := range upserts {
		if strings.HasPrefix(name, prefix) {
			return false, nil
		}
	}
	deleted := true
	err := filepath.WalkDir(filepath.Join(dataDir, boxID), func(name string, entry os.DirEntry, err error) error {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		if err != nil {
			return err
		}
		if !entry.IsDir() {
			rel, relErr := filepath.Rel(dataDir, name)
			if relErr != nil {
				return relErr
			}
			if !removes[filepath.ToSlash(rel)] {
				deleted = false
				return filepath.SkipAll
			}
		}
		return nil
	})
	return deleted, err
}

// object 拒绝重复字段及尾随数据，避免重复的模式字段被后面的低版本遮盖。
func object(data []byte, foldCase bool) (map[string]json.RawMessage, error) {
	decoder := json.NewDecoder(bytes.NewReader(data))
	token, err := decoder.Token()
	if err != nil || token != json.Delim('{') {
		return nil, ErrInvalid
	}
	ret := map[string]json.RawMessage{}
	for decoder.More() {
		token, err = decoder.Token()
		if err != nil {
			return nil, ErrInvalid
		}
		name, ok := token.(string)
		if !ok {
			return nil, ErrInvalid
		}
		if foldCase {
			name = strings.ToLower(name)
		}
		if _, exists := ret[name]; exists {
			return nil, ErrInvalid
		}
		var value json.RawMessage
		if decoder.Decode(&value) != nil {
			return nil, ErrInvalid
		}
		ret[name] = value
	}
	if token, err = decoder.Token(); err != nil || token != json.Delim('}') {
		return nil, ErrInvalid
	}
	if _, err = decoder.Token(); err != io.EOF {
		return nil, ErrInvalid
	}
	return ret, nil
}

func positiveInt(value []byte) (int, error) {
	var ret int
	if json.Unmarshal(value, &ret) != nil || ret < 1 {
		return 0, ErrInvalid
	}
	return ret, nil
}

func versionedObject(data []byte) (map[string]json.RawMessage, error) {
	fields, err := object(data, false)
	if err != nil {
		return nil, err
	}
	version, err := positiveInt(fields["version"])
	if err != nil || version != 1 {
		return nil, ErrInvalid
	}
	return fields, nil
}

type localStore struct {
	Version   int            `json:"version"`
	Notebooks map[string]int `json:"notebooks"`
	path      string
	dirty     bool
}

func loadStore(dataDir, confDir string) (*localStore, error) {
	if !filepath.IsAbs(dataDir) {
		return nil, ErrInvalid
	}
	if confDir == "" {
		confDir = filepath.Join(filepath.Dir(filepath.Clean(dataDir)), "conf")
	}
	if !filepath.IsAbs(confDir) {
		return nil, ErrInvalid
	}
	ret := &localStore{Version: 1, Notebooks: map[string]int{}, path: filepath.Join(confDir, "document-addressing.json")}
	return readStore(ret)
}

func readStore(ret *localStore) (*localStore, error) {
	data, err := filelock.ReadFile(ret.path)
	if errors.Is(err, os.ErrNotExist) {
		return ret, nil
	}
	if err != nil {
		return nil, err
	}
	notebooks, err := parseStore(data)
	if err != nil {
		return nil, err
	}
	ret.Notebooks = notebooks
	return ret, nil
}

func parseStore(data []byte) (map[string]int, error) {
	fields, err := versionedObject(data)
	if err != nil || len(fields) != 2 {
		return nil, ErrInvalid
	}
	notebooks, err := object(fields["notebooks"], false)
	if err != nil {
		return nil, err
	}
	ret := map[string]int{}
	for id, value := range notebooks {
		if !ast.IsNodeIDPattern(id) {
			return nil, ErrInvalid
		}
		mode, err := positiveInt(value)
		if err != nil {
			return nil, err
		}
		ret[id] = mode
	}
	return ret, nil
}

func (store *localStore) confirm(boxID string, mode int) int {
	if mode > 1 && mode > store.Notebooks[boxID] {
		store.Notebooks[boxID], store.dirty = mode, true
	}
	return max(mode, store.Notebooks[boxID])
}

func (store *localStore) save() error {
	return store.saveUsing(filelock.WriteFile)
}

func (store *localStore) saveUsing(write func(string, []byte) error) error {
	if !store.dirty {
		return nil
	}
	data, err := json.MarshalIndent(store, "", "  ")
	if err != nil {
		return err
	}
	if err = os.MkdirAll(filepath.Dir(store.path), 0755); err != nil {
		return err
	}
	return write(store.path, data)
}
