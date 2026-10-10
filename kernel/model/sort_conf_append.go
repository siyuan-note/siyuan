package model

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const sortConfAppendMaxRecordBytes = 64 * 1024

// sortConfAppendRecord 只保存新增尾部和未改动前缀的摘要，恢复记录留在本机，不参与同步。
type sortConfAppendRecord struct {
	Version      int    `json:"version"`
	Offset       int64  `json:"offset"`
	OriginalSize int64  `json:"originalSize"`
	PrefixHash   string `json:"prefixHash"`
	Suffix       []byte `json:"suffix"`
}

func sortConfAppendDir() string {
	return filepath.Join(filepath.Dir(util.DataDir), "temp", "sort-write")
}

func sortConfAppendPath(confPath string) (string, error) {
	rel, err := filepath.Rel(util.DataDir, confPath)
	if err != nil {
		return "", err
	}
	parts := strings.Split(filepath.ToSlash(rel), "/")
	if len(parts) != 3 || !ast.IsNodeIDPattern(parts[0]) || parts[1] != ".siyuan" || parts[2] != "sort.json" {
		return "", fmt.Errorf("invalid incremental sort conf path [%s]", confPath)
	}
	return filepath.Join(sortConfAppendDir(), parts[0]+".json"), nil
}

func newSortConfAppendRecord(data []byte, additions map[string]int) (*sortConfAppendRecord, error) {
	trimmed := bytes.TrimSpace(data)
	var existing map[string]int
	if len(trimmed) < 2 || trimmed[0] != '{' || trimmed[len(trimmed)-1] != '}' ||
		json.Unmarshal(data, &existing) != nil || existing == nil {
		return nil, errors.New("invalid sort conf for incremental write")
	}
	for id := range additions {
		if !ast.IsNodeIDPattern(id) {
			return nil, fmt.Errorf("invalid sort ID [%s]", id)
		}
		if _, exists := existing[id]; exists {
			return nil, fmt.Errorf("sort ID [%s] already exists", id)
		}
	}
	encoded, err := json.Marshal(additions)
	if err != nil {
		return nil, err
	}
	suffix := encoded[1:]
	if len(existing) > 0 {
		suffix = append([]byte{','}, suffix...)
	}
	offset := bytes.LastIndexByte(data, '}')
	return &sortConfAppendRecord{
		Version: 1, Offset: int64(offset), OriginalSize: int64(len(data)),
		PrefixHash: fmt.Sprintf("%x", sha256.Sum256(data[:offset])), Suffix: suffix,
	}, nil
}

// verifySortConfAppend 校验前缀和长度，不覆盖被替换的配置或未知格式。
func verifySortConfAppend(file *os.File, record *sortConfAppendRecord) error {
	if record.Version != 1 || record.Offset < 1 || record.OriginalSize <= record.Offset ||
		len(record.PrefixHash) != sha256.Size*2 || len(record.Suffix) < 2 ||
		len(record.Suffix) > sortConfAppendMaxRecordBytes {
		return errors.New("invalid sort append recovery record")
	}
	var additions map[string]int
	if err := json.Unmarshal(append([]byte{'{'}, bytes.TrimPrefix(record.Suffix, []byte{','})...), &additions); err != nil || len(additions) == 0 {
		return errors.New("invalid sort append recovery entries")
	}
	for id := range additions {
		if !ast.IsNodeIDPattern(id) {
			return fmt.Errorf("invalid recovery sort ID [%s]", id)
		}
	}
	info, err := file.Stat()
	if err != nil {
		return err
	}
	newSize := record.Offset + int64(len(record.Suffix))
	if info.Size() < record.Offset || info.Size() > max(record.OriginalSize, newSize) {
		return errors.New("sort conf size changed outside incremental write")
	}
	digest := sha256.New()
	if _, err = io.CopyN(digest, io.NewSectionReader(file, 0, record.Offset), record.Offset); err != nil {
		return err
	}
	if fmt.Sprintf("%x", digest.Sum(nil)) != record.PrefixHash {
		return errors.New("sort conf prefix changed outside incremental write")
	}
	decoder := json.NewDecoder(io.NewSectionReader(file, 0, record.Offset))
	token, err := decoder.Token()
	if err != nil || token != json.Delim('{') || decoder.More() != (record.Suffix[0] == ',') {
		return errors.New("sort append separator does not match the source object")
	}
	tail, err := io.ReadAll(io.NewSectionReader(file, record.Offset, info.Size()-record.Offset))
	if err != nil {
		return err
	}
	tail = bytes.TrimSpace(tail)
	if !bytes.Equal(tail, []byte("}")) && !bytes.Equal(tail, record.Suffix) {
		// 完整但不同的 JSON 尾部表示配置已被其他写入替换，不把它当作未完成的写入。
		candidate := append([]byte{'{'}, bytes.TrimPrefix(tail, []byte{','})...)
		if json.Valid(candidate) {
			return errors.New("sort conf entries changed outside incremental write")
		}
	}
	return nil
}

func applySortConfAppend(file *os.File, record *sortConfAppendRecord) error {
	if err := verifySortConfAppend(file, record); err != nil {
		return err
	}
	return writeSortConfAppendTail(file, record)
}

func writeSortConfAppendTail(file *os.File, record *sortConfAppendRecord) error {
	if n, writeErr := file.WriteAt(record.Suffix, record.Offset); writeErr != nil {
		return writeErr
	} else if n != len(record.Suffix) {
		return io.ErrShortWrite
	}
	if err := file.Truncate(record.Offset + int64(len(record.Suffix))); err != nil {
		return err
	}
	return file.Sync()
}

// appendSortConfMap 保持标准 JSON 对象，只有新增条目使用可恢复的尾部写入。
func appendSortConfMap(confPath string, data []byte, additions map[string]int) (err error) {
	if err = recoverSortConfAppend(confPath); err != nil {
		return
	}
	if !filelock.IsExist(confPath) {
		if len(data) != 0 {
			return errors.New("sort conf removed before incremental write")
		}
		return writeSortConfMap(confPath, additions)
	}
	recordPath, err := sortConfAppendPath(confPath)
	if err != nil {
		return
	}
	file, err := filelock.OpenFile(confPath, os.O_RDWR, 0644)
	if err != nil {
		return
	}
	defer func() { err = errors.Join(err, filelock.CloseFile(file)) }()
	info, err := file.Stat()
	if err != nil {
		return
	}
	if info.Size() != int64(len(data)) {
		return errors.New("sort conf changed before incremental write")
	}
	record, err := newSortConfAppendRecord(data, additions)
	if err != nil {
		return
	}
	encoded, err := json.Marshal(record)
	if err != nil {
		return
	}
	if len(encoded) > sortConfAppendMaxRecordBytes {
		return errors.New("sort append recovery record exceeds size limit")
	}
	if err = verifySortConfAppend(file, record); err != nil {
		return
	}
	if err = os.MkdirAll(filepath.Dir(recordPath), 0700); err != nil {
		return
	}
	if err = syncSortConfAppendDir(filepath.Dir(filepath.Dir(recordPath))); err != nil {
		return
	}
	if err = filelock.WriteFile(recordPath, encoded); err != nil {
		return
	}
	// 刷新重命名后的恢复文件及支持目录刷新平台上的目录项，再开始修改源文件。
	if err = syncSortConfAppendRecord(recordPath); err != nil {
		return
	}
	if err = writeSortConfAppendTail(file, record); err != nil {
		// 写入失败时保留恢复记录和未改动的前缀，后续读取或启动时重放。
		return
	}
	return removeSortConfAppendRecord(recordPath)
}

func syncSortConfAppendDir(dir string) error {
	if runtime.GOOS == "windows" {
		return nil
	}
	file, err := os.Open(dir)
	if err != nil {
		return err
	}
	return errors.Join(file.Sync(), file.Close())
}

func syncSortConfAppendRecord(recordPath string) error {
	file, err := os.OpenFile(recordPath, os.O_RDWR, 0600)
	if err != nil {
		return err
	}
	if err = errors.Join(file.Sync(), file.Close()); err != nil {
		return err
	}
	return syncSortConfAppendDir(filepath.Dir(recordPath))
}

func removeSortConfAppendRecord(recordPath string) error {
	if err := os.Remove(recordPath); err != nil {
		return err
	}
	return syncSortConfAppendDir(filepath.Dir(recordPath))
}

func recoverSortConfAppend(confPath string) (err error) {
	recordPath, pathErr := sortConfAppendPath(confPath)
	if pathErr != nil {
		return nil
	}
	if _, err = os.Stat(recordPath); os.IsNotExist(err) {
		return nil
	} else if err != nil {
		return
	}
	file, err := filelock.OpenFile(confPath, os.O_RDWR, 0644)
	if err != nil {
		return
	}
	defer func() { err = errors.Join(err, filelock.CloseFile(file)) }()
	info, err := os.Stat(recordPath)
	if os.IsNotExist(err) {
		return nil
	} else if err != nil {
		return
	}
	if info.Size() > sortConfAppendMaxRecordBytes {
		return errors.New("sort append recovery record exceeds size limit")
	}
	data, err := filelock.ReadFile(recordPath)
	if err != nil {
		return
	}
	var record sortConfAppendRecord
	if err = json.Unmarshal(data, &record); err != nil {
		return
	}
	if err = applySortConfAppend(file, &record); err != nil {
		return
	}
	if err = removeSortConfAppendRecord(recordPath); err != nil {
		return
	}
	logging.LogInfof("recovered incremental sort conf [%s]", confPath)
	if Conf != nil && Conf.Sync != nil {
		IncSync()
	} else {
		// 启动恢复发生在同步配置加载前，先标记待同步状态。
		syncSameCount.Store(0)
		pendingSync.change(notifySyncPending)
	}
	return nil
}

func recoverSortConfAppends() error {
	entries, err := os.ReadDir(sortConfAppendDir())
	if os.IsNotExist(err) {
		return nil
	} else if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		boxID := strings.TrimSuffix(entry.Name(), ".json")
		if !ast.IsNodeIDPattern(boxID) {
			return fmt.Errorf("invalid sort recovery notebook [%s]", boxID)
		}
		if err = recoverSortConfAppend(filepath.Join(util.DataDir, boxID, ".siyuan", "sort.json")); err != nil {
			return err
		}
	}
	return nil
}
