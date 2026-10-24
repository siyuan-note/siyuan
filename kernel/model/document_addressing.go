package model

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/documentaddressing"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func checkDocumentAddressingConf(boxID string, data []byte) error {
	return documentaddressing.CheckBatch(util.DataDir, util.ConfDir,
		[]string{boxID + "/" + documentaddressing.ConfigPath}, nil,
		func(string) ([]byte, error) { return data, nil })
}

// documentAddressingPreflight 读取待恢复快照中的记录，在整批写入和删除前检查能力。
func documentAddressingPreflight(repo *dejavu.Repo) func(*dejavu.CheckoutPlan) error {
	return func(plan *dejavu.CheckoutPlan) error {
		upserts := make([]string, 0, len(plan.Upserts))
		removes := make([]string, 0, len(plan.Removes))
		paths := map[string]string{}
		upsertBoxes, removedPaths := map[string]bool{}, map[string]bool{}
		seen := map[string]bool{}
		// 仓库索引统一使用前导斜杠和正斜杠；拒绝别名及重复目标，避免覆盖计划遮盖来源。
		checkPath := func(name string) error {
			if !strings.HasPrefix(name, "/") || strings.Contains(name, "\\") {
				return documentaddressing.ErrInvalid
			}
			key := name
			if runtime.GOOS == "windows" {
				for _, part := range strings.Split(name[1:], "/") {
					if strings.TrimRight(part, ". ") != part || strings.Contains(part, ":") {
						return documentaddressing.ErrInvalid
					}
				}
				key = strings.ToLower(key)
			}
			if seen[key] {
				return documentaddressing.ErrInvalid
			}
			seen[key] = true
			return nil
		}
		for _, file := range plan.Upserts {
			if err := checkPath(file.Path); err != nil {
				return err
			}
			upserts = append(upserts, file.Path)
			name := strings.TrimPrefix(file.Path, "/")
			paths[name] = file.Path
			boxID, _, _ := strings.Cut(name, "/")
			upsertBoxes[boxID] = true
		}
		for _, file := range plan.Removes {
			if err := checkPath(file.Path); err != nil {
				return err
			}
			removes = append(removes, file.Path)
			removedPaths[strings.TrimPrefix(file.Path, "/")] = true
		}
		if err := documentaddressing.CheckBatch(repo.DataPath, util.ConfDir, upserts, removes,
			func(name string) ([]byte, error) { return plan.ReadFile(paths[name]) }); err != nil {
			return err
		}
		for _, file := range plan.Upserts {
			name := strings.TrimPrefix(file.Path, "/")
			if !isDocumentAddressingSource([]string{name}) {
				continue
			}
			data, err := plan.ReadFile(file.Path)
			if err == nil {
				err = checkDocumentAddressingCheckoutSource(data)
			}
			if err != nil {
				return fmt.Errorf("document [%s]: %w", name, err)
			}
			if err = checkDocumentAddressingCheckoutCurrent(repo.DataPath, name); err != nil {
				return err
			}
		}
		deletedBoxes := map[string]bool{}
		for _, file := range plan.Removes {
			name := strings.TrimPrefix(file.Path, "/")
			if !isDocumentAddressingSource([]string{name}) {
				continue
			}
			boxID, _, _ := strings.Cut(name, "/")
			deleted, checked := deletedBoxes[boxID]
			if !checked {
				var err error
				if !upsertBoxes[boxID] {
					deleted, err = documentAddressingCheckoutRemovesNotebook(repo.DataPath, boxID, removedPaths)
				}
				if err != nil {
					return err
				}
				deletedBoxes[boxID] = deleted
			}
			if !deleted {
				if err := checkDocumentAddressingCheckoutCurrent(repo.DataPath, name); err != nil {
					return err
				}
			}
		}
		return nil
	}
}

func checkDocumentAddressingCheckoutCurrent(dataDir, name string) error {
	data, err := filelock.ReadFile(filepath.Join(dataDir, filepath.FromSlash(name)))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	// 已识别的不支持版本或标题不能被覆盖或部分删除；普通损坏源仍可用合法历史恢复。
	if err = checkDocumentAddressingCheckoutSource(data); errors.Is(err, treenode.ErrSpecTooNew) ||
		errors.Is(err, documentaddressing.ErrModeConflict) || errors.Is(err, documentaddressing.ErrInvalidTitle) {
		return fmt.Errorf("document [%s]: %w", name, err)
	}
	return nil
}

// documentAddressingCheckoutRemovesNotebook 仅在整本现存文件全部移除时保留无需解释内容的删除语义。
func documentAddressingCheckoutRemovesNotebook(dataDir, boxID string, removes map[string]bool) (bool, error) {
	deleted := true
	err := filepath.WalkDir(filepath.Join(dataDir, boxID), func(name string, entry os.DirEntry, err error) error {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		if err != nil || entry.IsDir() {
			return err
		}
		relative, err := filepath.Rel(dataDir, name)
		if err != nil {
			return err
		}
		if !removes[filepath.ToSlash(relative)] {
			deleted = false
			return filepath.SkipAll
		}
		return nil
	})
	return deleted, err
}

// checkDocumentAddressingCheckoutSource 只解释普通源；密文同步保持原字节，不要求解锁或声明内容已认证。
// 仓库分块认证不代替笔记本认证，密文的格式及标题仍在解锁读取时检查。
func checkDocumentAddressingCheckoutSource(data []byte) error {
	if util.IsCiphertext(data) {
		return nil
	}
	return treenode.CheckSpecJSONForMode(bytes.TrimPrefix(data, []byte("\xef\xbb\xbf")), documentaddressing.DefaultMode())
}

func documentAddressingCheckoutHooks(repo *dejavu.Repo) dejavu.CheckoutHooks {
	return dejavu.CheckoutHooks{Preflight: documentAddressingPreflight(repo)}
}

// checkImportedDocumentAddressing 在重新生成 ID 或删除档案配置前校验原始笔记本身份和模式。
func checkImportedDocumentAddressing(directory string) error {
	boxID := filepath.Base(directory)
	if !ast.IsNodeIDPattern(boxID) {
		boxID = ""
	}
	data, err := filelock.ReadFile(filepath.Join(directory, ".siyuan", boxDocMetaName))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err == nil {
		var meta boxDocMeta
		if json.Unmarshal(data, &meta) != nil || meta.Spec != boxDocMetaSpec || !ast.IsNodeIDPattern(meta.BoxDocID) {
			return documentaddressing.ErrInvalid
		}
		boxID = meta.BoxDocID
	}
	if boxID == "" {
		// 按名称导出的笔记本可能没有笔记本文档；从寻址记录取得身份后仍校验完整源记录。
		data, err = filelock.ReadFile(filepath.Join(directory, documentaddressing.FloorPath))
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		if err == nil {
			var record struct {
				Notebook string `json:"notebook"`
			}
			if json.Unmarshal(data, &record) != nil || !ast.IsNodeIDPattern(record.Notebook) {
				return documentaddressing.ErrInvalid
			}
			boxID = record.Notebook
		}
	}
	return documentaddressing.CheckImport(util.DataDir, util.ConfDir, boxID, directory)
}

// prepareImportedDocumentAddressing 仅处理已经通过源身份和模式检查的临时档案。
func prepareImportedDocumentAddressing(directory, newBoxID string, wholeNotebook bool) error {
	name := filepath.Join(directory, documentaddressing.FloorPath)
	data, err := filelock.ReadFile(name)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if !wholeNotebook {
		// 文档级导入沿用目标能力，不复制源笔记本的模式记录。
		return filelock.Remove(name)
	}
	var record map[string]json.RawMessage
	if err = json.Unmarshal(data, &record); err != nil {
		return err
	}
	record["notebook"], err = json.Marshal(newBoxID)
	if err != nil {
		return err
	}
	data, err = json.Marshal(record)
	if err != nil {
		return err
	}
	return filelock.WriteFile(name, data)
}

// checkDocumentAddressingCopy 在整批导入或历史恢复开始复制前检查源配置及目标已确认的下界。
func checkDocumentAddressingCopy(sourceRoot, boxID string) error {
	var upserts []string
	err := filepath.WalkDir(sourceRoot, func(name string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(sourceRoot, name)
		if err != nil {
			return err
		}
		if boxID != "" {
			rel = filepath.Join(boxID, rel)
		}
		upserts = append(upserts, filepath.ToSlash(rel))
		return nil
	})
	if err != nil {
		return err
	}
	return documentaddressing.CheckBatch(util.DataDir, util.ConfDir, upserts, nil, func(name string) ([]byte, error) {
		if boxID != "" {
			name = strings.TrimPrefix(name, boxID+"/")
		}
		return filelock.ReadFile(filepath.Join(sourceRoot, filepath.FromSlash(name)))
	})
}

func copyExportedDocumentAddressing(boxID, directory string) error {
	data, err := filelock.ReadFile(filepath.Join(util.DataDir, boxID, documentaddressing.FloorPath))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	return filelock.WriteFile(filepath.Join(directory, documentaddressing.FloorPath), data)
}

// backupUnsupportedNotebookAttributeViews 无法解析源文档时保留共享数据库的原始快照，避免丢失恢复材料。
func backupUnsupportedNotebookAttributeViews(historyDir string) error {
	directory := filepath.Join(util.DataDir, "storage", "av")
	entries, err := os.ReadDir(directory)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		dest := filepath.Join(historyDir, "storage", "av", entry.Name())
		if _, err = os.Stat(dest); err == nil {
			continue
		} else if !errors.Is(err, os.ErrNotExist) {
			return err
		}
		if err = filelock.Copy(filepath.Join(directory, entry.Name()), dest); err != nil {
			return err
		}
	}
	return nil
}
