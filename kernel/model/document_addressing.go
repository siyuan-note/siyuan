package model

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/documentaddressing"
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
		for _, file := range plan.Upserts {
			upserts = append(upserts, file.Path)
			paths[strings.TrimPrefix(file.Path, "/")] = file.Path
		}
		for _, file := range plan.Removes {
			removes = append(removes, file.Path)
		}
		return documentaddressing.CheckBatch(repo.DataPath, util.ConfDir, upserts, removes,
			func(name string) ([]byte, error) { return plan.ReadFile(paths[name]) })
	}
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
