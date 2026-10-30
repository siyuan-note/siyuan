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
	"slices"
	"strings"

	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func documentSourceArchivePath(id string) string {
	return filepath.Join(util.ConfDir, "document-source-recovery", id, "record.json")
}

func archivedDocumentSource(j *documentSourceJournal) (bool, error) {
	if util.ConfDir == "" {
		return false, nil
	}
	data, err := os.ReadFile(documentSourceArchivePath(j.ID))
	if os.IsNotExist(err) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	_, err = parseDocumentSourceJournal(data, j.ID+".json")
	return err == nil, err
}

func archiveDocumentSource(j *documentSourceJournal) error {
	if util.ConfDir == "" {
		return errors.New("document source archive directory is unavailable")
	}
	if exists, err := archivedDocumentSource(j); exists || err != nil {
		return err
	}
	data, err := os.ReadFile(j.filename())
	if err != nil {
		return err
	}
	if _, err = parseDocumentSourceJournal(data, j.ID+".json"); err != nil {
		return err
	}
	directory := filepath.Dir(documentSourceArchivePath(j.ID))
	if err = os.MkdirAll(directory, 0700); err != nil {
		return err
	}
	// 密文快照连同现存密钥配置、备份和笔记本包络一起保留，不生成明文副本。
	private := false
	for _, file := range j.Files {
		private = private || util.IsCiphertext(file.Before) || util.IsCiphertext(file.After)
	}
	if private {
		if err = archiveDocumentSourceKeys(j, directory); err != nil {
			return err
		}
	}
	if err = writeDocumentSourceArchiveFile(documentSourceArchivePath(j.ID), data); err != nil {
		return err
	}
	actual, err := os.ReadFile(documentSourceArchivePath(j.ID))
	if err != nil {
		return err
	}
	if !bytes.Equal(actual, data) {
		return errors.New("document source archive verification failed")
	}
	return nil
}

func archiveDocumentSourceKeys(j *documentSourceJournal, directory string) error {
	paths := map[string]string{
		"backup.json":    dataCryptoBackupPath(),
		"migration.json": masterPasswordMigrationPath(),
		"conf.json":      filepath.Join(util.ConfDir, "conf.json"),
	}
	for _, file := range j.Files {
		if file.Box == "" {
			continue
		}
		paths[file.Box+"/conf.json"] = filepath.Join(util.DataDir, file.Box, ".siyuan", "conf.json")
		paths[file.Box+"/"+notebookCryptoBackupFilename] = filepath.Join(util.DataDir, file.Box, ".siyuan", notebookCryptoBackupFilename)
	}
	for name, source := range paths {
		data, err := os.ReadFile(source)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return err
		}
		if name == "conf.json" {
			var conf map[string]json.RawMessage
			if err = json.Unmarshal(data, &conf); err != nil {
				return err
			}
			data = conf["notebookCrypto"]
			if len(data) == 0 {
				continue
			}
		}
		if err = writeDocumentSourceArchiveFile(filepath.Join(directory, "keys", filepath.FromSlash(name)), data); err != nil {
			return err
		}
	}
	return nil
}

func writeDocumentSourceArchiveFile(name string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(name), 0700); err != nil {
		return err
	}
	file, err := os.CreateTemp(filepath.Dir(name), ".recovery-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if _, err = file.Write(data); err == nil {
		err = file.Sync()
	}
	err = errors.Join(err, file.Close())
	if err != nil {
		return err
	}
	return os.Rename(file.Name(), name)
}

func documentSourceConflicts(entries []*documentSourceJournal) (map[string]bool, error) {
	keep := map[string]bool{}
	for _, j := range entries {
		archived, err := archivedDocumentSource(j)
		if err != nil {
			return nil, err
		}
		if archived {
			keep[j.ID] = true
		}
		if j.State == "pending" && !j.Forward {
			if err = j.checkSources(); err != nil {
				if !errors.Is(err, util.ErrFileChanged) {
					return nil, err
				}
				keep[j.ID] = true
			}
		}
	}
	for changed := true; changed; {
		changed = false
		for _, a := range entries {
			if !keep[a.ID] {
				continue
			}
			for _, b := range entries {
				if !keep[b.ID] && overlappingDocumentSources(a, b) {
					keep[b.ID], changed = true, true
				}
			}
		}
	}
	return keep, nil
}

func overlappingDocumentSources(a, b *documentSourceJournal) bool {
	paths := func(j *documentSourceJournal) []string {
		var ret []string
		for _, file := range j.Files {
			name, _ := file.filename()
			ret = append(ret, name)
		}
		if j.Move != nil {
			for _, p := range []string{j.Move.From, j.Move.To} {
				name, _ := documentSourcePath(j.Move.Box, p, true)
				ret = append(ret, name)
			}
		}
		return ret
	}
	for _, left := range paths(a) {
		for _, right := range paths(b) {
			if left == right || strings.HasPrefix(left, right+string(os.PathSeparator)) || strings.HasPrefix(right, left+string(os.PathSeparator)) {
				return true
			}
		}
	}
	return false
}

// prepareDocumentSourceBootSync 在启动同步之前收敛已打开笔记本，关闭或锁定的笔记本在挂载时处理。
func prepareDocumentSourceBootSync() error {
	entries, err := readDocumentSourceJournals()
	if err != nil {
		return err
	}
	if len(entries) == 0 {
		return nil
	}
	for _, box := range Conf.GetOpenedBoxes() {
		needed := false
		for _, j := range entries {
			archived, err := archivedDocumentSource(j)
			if err != nil {
				return err
			}
			if !archived {
				continue
			}
			for _, file := range j.Files {
				needed = needed || file.Kind == "" && file.Box == box.ID && !slices.Contains(j.Recovered, box.ID)
			}
		}
		if needed {
			indexBox(box.ID)
			if treenode.DocumentMetadataState(box.ID) != "ready" {
				return errors.New("document source recovery indexing failed")
			}
		}
	}
	return nil
}
