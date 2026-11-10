// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"

	"github.com/88250/lute/parse"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// 调用方持有 boxDocTitleNameLock，直到源和配置共同提交或补偿完成。
func (recovery *attributeViewHistoryRecovery) writeBoxDocTitleName(tree *parse.Tree, write func(string, []byte, []byte) error) (string, error) {
	_, source, err := filesys.LoadTreeSnapshot(tree.Box, tree.Path, util.NewLute())
	if os.IsNotExist(err) {
		source, err = nil, nil
	}
	if err != nil {
		return "", err
	}
	if _, err = recovery.remember(&documentSourceFile{Box: tree.Box, Path: tree.Path,
		Before: bytes.Clone(source), After: bytes.Clone(source)}); err != nil {
		return "", err
	}
	file := &documentSourceFile{Kind: "notebook", Box: tree.Box, Path: "/.siyuan/conf.json"}
	filename, err := file.filename()
	if err != nil {
		return "", err
	}
	before, err := filelock.ReadFile(filename)
	if err != nil {
		return "", err
	}
	boxConf := conf.NewBoxConf()
	if err = json.Unmarshal(before, boxConf); err != nil {
		return "", err
	}
	if boxConf.Encrypted != IsEncryptedBox(tree.Box) {
		return "", errors.New("notebook history configuration encryption changed")
	}
	if boxConf.Encrypted {
		if err = revealBoxMetadataIfUnlocked(tree.Box, boxConf); err != nil {
			return "", err
		}
	}
	name := treenode.ReadDocumentTitle(tree.Root).Text
	if name == "" {
		name = Conf.Language(16)
	}
	// 只替换名称，保留未知配置字段和认证后的密钥包络、元数据及其备份。
	var fields map[string]json.RawMessage
	if err = json.Unmarshal(before, &fields); err != nil {
		return "", err
	}
	if fields == nil {
		return "", errors.New("notebook configuration is missing")
	}
	after := before
	if boxConf.Name != name {
		fields["name"], err = json.Marshal(name)
		if err != nil {
			return "", err
		}
		if after, err = json.MarshalIndent(fields, "", "  "); err != nil {
			return "", err
		}
	}
	file.Before, file.After = bytes.Clone(before), bytes.Clone(before)
	if file, err = recovery.remember(file); err != nil {
		return "", err
	}
	if err = recovery.record(file, before, after); err != nil {
		return "", err
	}
	if !bytes.Equal(before, after) {
		if err = write(tree.Box, before, after); err != nil {
			return "", err
		}
	}
	return name, nil
}

func writeHistoryNotebookConf(boxID string, before, after []byte) error {
	unlock := filesys.LockDocumentConfiguration()
	defer unlock()
	finish := cache.BeginDocTreeMutation(boxID)
	defer finish()
	if err := checkDocumentAddressingConf(boxID, after); err != nil {
		return err
	}
	filename := filepath.Join(util.DataDir, boxID, ".siyuan", "conf.json")
	if err := util.WriteFileIfUnchanged(filename, before, after); err != nil {
		return err
	}
	invalidateEncryptedPublishAccessCache()
	return nil
}
