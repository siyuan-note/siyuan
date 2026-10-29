// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"slices"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// Recovery records retain exact persisted bytes, including ciphertext. They live
// beside the durable SQL queue, outside synchronized notebook sources.
type documentSourceFile struct {
	Kind   string `json:"kind,omitempty"`
	Box    string `json:"box"`
	Path   string `json:"path"`
	Before []byte `json:"before"`
	After  []byte `json:"after"`
}

func (file *documentSourceFile) filename() (string, error) {
	if file.Kind == "flashcard" {
		name := path.Base(file.Path)
		extension := path.Ext(name)
		id := strings.TrimSuffix(name, extension)
		if file.Box != "" || !ast.IsNodeIDPattern(id) || (extension != ".deck" && extension != ".cards") || file.Path != "/storage/riff/"+name {
			return "", errors.New("invalid flashcard recovery path")
		}
		return filepath.Join(util.DataDir, "storage", "riff", name), nil
	}
	if file.Kind == "relations" {
		if (file.Box != "" && !ast.IsNodeIDPattern(file.Box)) || file.Path != "/storage/av/relations.msgpack" {
			return "", errors.New("invalid database relation recovery path")
		}
		return filepath.Join(util.DataDir, file.Box, filepath.FromSlash(file.Path)), nil
	}
	if file.Kind == "database" {
		id := strings.TrimSuffix(strings.TrimPrefix(file.Path, "/storage/av/"), ".json")
		if (file.Box != "" && !ast.IsNodeIDPattern(file.Box)) || !ast.IsNodeIDPattern(id) || file.Path != "/storage/av/"+id+".json" {
			return "", errors.New("invalid database recovery path")
		}
		return filepath.Join(util.DataDir, file.Box, filepath.FromSlash(file.Path)), nil
	}
	if file.Kind != "" {
		return "", errors.New("unknown document recovery source kind")
	}
	return documentSourcePath(file.Box, file.Path, false)
}

type documentSourceMove struct {
	Box  string `json:"box"`
	From string `json:"from"`
	To   string `json:"to"`
}

type documentSourceJournal struct {
	Version   int                   `json:"version"`
	Forward   bool                  `json:"forward,omitempty"`
	ID        string                `json:"id"`
	State     string                `json:"state"`
	Files     []*documentSourceFile `json:"files"`
	Move      *documentSourceMove   `json:"move,omitempty"`
	Recovered []string              `json:"recovered,omitempty"`
}

func documentSourceJournalBase() string { return filepath.Join(util.QueueDir, "document-sources") }

func documentSourcePath(box, p string, directory bool) (string, error) {
	if !ast.IsNodeIDPattern(box) || p == "/" || p != path.Clean(p) || !strings.HasPrefix(p, "/") || strings.Contains(p, "\\") {
		return "", errors.New("invalid document recovery path")
	}
	parts := strings.Split(strings.TrimPrefix(p, "/"), "/")
	for i, part := range parts {
		if !directory && i == len(parts)-1 {
			if !strings.HasSuffix(part, ".sy") {
				return "", errors.New("invalid document recovery source")
			}
			part = strings.TrimSuffix(part, ".sy")
		}
		if !ast.IsNodeIDPattern(part) {
			return "", errors.New("invalid document recovery identity")
		}
	}
	return filepath.Join(util.DataDir, box, filepath.FromSlash(p)), nil
}

func (j *documentSourceJournal) filename() string {
	return filepath.Join(documentSourceJournalBase(), j.ID+".json")
}

func (j *documentSourceJournal) valid() bool {
	if j.Version != 1 || !ast.IsNodeIDPattern(j.ID) || len(j.Files) == 0 ||
		(j.State != "pending" && j.State != "committed" && j.State != "recovered") {
		return false
	}
	if j.Forward && j.Move != nil {
		return false
	}
	seen := map[string]bool{}
	for _, file := range j.Files {
		if file == nil {
			return false
		}
		if j.Forward && file.Kind != "" {
			return false
		}
		name, err := file.filename()
		if err != nil || seen[name] {
			return false
		}
		seen[name] = true
	}
	if j.Move != nil {
		from, err := documentSourcePath(j.Move.Box, j.Move.From, true)
		to, toErr := documentSourcePath(j.Move.Box, j.Move.To, true)
		if err != nil || toErr != nil || from == to || filepath.Dir(from) != filepath.Dir(to) {
			return false
		}
	}
	return true
}

func (j *documentSourceJournal) save() error {
	if util.QueueDir == "" || !j.valid() {
		return errors.New("invalid document source recovery record")
	}
	persisted := *j
	if j.Forward {
		// One atomic document replacement needs only authenticated index recovery on
		// restart. Promote to before-images before any multi-source or database write.
		persisted.Files = make([]*documentSourceFile, 0, len(j.Files))
		for _, file := range j.Files {
			identity := *file
			identity.Before, identity.After = nil, nil
			persisted.Files = append(persisted.Files, &identity)
		}
	}
	data, err := json.Marshal(&persisted)
	if err != nil {
		return err
	}
	digest := sha256.Sum256(data)
	envelope, err := json.Marshal(struct {
		Data   json.RawMessage `json:"data"`
		Digest string          `json:"sha256"`
	}{data, hex.EncodeToString(digest[:])})
	if err != nil {
		return err
	}
	if err = os.MkdirAll(documentSourceJournalBase(), 0700); err != nil {
		return err
	}
	file, err := os.CreateTemp(documentSourceJournalBase(), ".source-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if err = file.Chmod(0600); err == nil {
		_, err = file.Write(envelope)
	}
	if err == nil {
		err = file.Sync()
	}
	err = errors.Join(err, file.Close())
	if err != nil {
		return err
	}
	return os.Rename(file.Name(), j.filename())
}

func readDocumentSourceJournals() ([]*documentSourceJournal, error) {
	if util.QueueDir == "" {
		return nil, nil
	}
	entries, err := os.ReadDir(documentSourceJournalBase())
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var result []*documentSourceJournal
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		data, err := os.ReadFile(filepath.Join(documentSourceJournalBase(), entry.Name()))
		if err != nil {
			return nil, err
		}
		var envelope struct {
			Data   json.RawMessage `json:"data"`
			Digest string          `json:"sha256"`
		}
		if json.Unmarshal(data, &envelope) != nil {
			return nil, errors.New("corrupt document source recovery record")
		}
		digest := sha256.Sum256(envelope.Data)
		j := &documentSourceJournal{}
		if envelope.Digest != hex.EncodeToString(digest[:]) || json.Unmarshal(envelope.Data, j) != nil || !j.valid() || entry.Name() != j.ID+".json" {
			return nil, errors.New("unsupported or corrupt document source recovery record")
		}
		result = append(result, j)
	}
	return result, nil
}

// rollback checks the entire batch before changing anything and conditionally restores
// each source. Unexpected edits and conflicting directories preserve the record and data.
func (j *documentSourceJournal) rollback() error {
	for _, file := range j.Files {
		name, _ := file.filename()
		current, err := os.ReadFile(name)
		if os.IsNotExist(err) {
			current, err = nil, nil
		}
		if err != nil {
			return err
		}
		if !bytes.Equal(current, file.Before) && !bytes.Equal(current, file.After) {
			return fmt.Errorf("%w: %s", util.ErrFileChanged, name)
		}
	}
	if j.Move != nil {
		from, _ := documentSourcePath(j.Move.Box, j.Move.From, true)
		to, _ := documentSourcePath(j.Move.Box, j.Move.To, true)
		fromInfo, fromErr := os.Lstat(from)
		toInfo, toErr := os.Lstat(to)
		if os.IsNotExist(fromErr) && toErr == nil && toInfo.IsDir() {
			if err := os.Rename(to, from); err != nil {
				return err
			}
		} else if fromErr != nil || !fromInfo.IsDir() || !os.IsNotExist(toErr) {
			return errors.New("conflicting document recovery directories")
		}
	}
	for _, file := range j.Files {
		name, _ := file.filename()
		current, err := os.ReadFile(name)
		if os.IsNotExist(err) {
			current, err = nil, nil
		}
		if err != nil {
			return err
		}
		if bytes.Equal(current, file.Before) {
			continue
		}
		if file.Before == nil {
			if err = removeIndexRepairSourceIfUnchanged(name, file.After); err != nil {
				return err
			}
		} else if err = util.WriteFileIfUnchanged(name, current, file.Before); err != nil {
			return err
		}
		if file.Kind == "database" {
			id := strings.TrimSuffix(path.Base(file.Path), ".json")
			cache.RemoveAVDataInBox(id, file.Box)
			av.ClearBlockCollectionIndex(file.Box)
		} else if file.Kind == "" {
			cache.RemoveTreeDataInBox(util.GetTreeID(file.Path), file.Box)
			cache.RemoveDocIALInBox(file.Path, file.Box)
		}
	}
	j.State = "recovered"
	return j.save()
}

func recoverDocumentSources() error {
	entries, err := readDocumentSourceJournals()
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.State == "pending" && !entry.Forward {
			if err = entry.rollback(); err != nil {
				return err
			}
		} else {
			entry.State = "recovered"
			if err = entry.save(); err != nil {
				return err
			}
		}
		if !slices.ContainsFunc(entry.Files, func(file *documentSourceFile) bool { return file.Kind == "" }) {
			if err = os.Remove(entry.filename()); err != nil {
				return err
			}
		}
	}
	return nil
}

func hasDocumentSourceRecovery(box string) bool {
	entries, err := readDocumentSourceJournals()
	if err != nil {
		return true
	}
	for _, j := range entries {
		for _, file := range j.Files {
			if file.Kind == "" && file.Box == box && !slices.Contains(j.Recovered, box) {
				return true
			}
		}
	}
	return false
}

func finishDocumentSourceRecovery(box string) error {
	entries, err := readDocumentSourceJournals()
	if err != nil {
		return err
	}
	for _, j := range entries {
		if j.State != "recovered" {
			continue
		}
		if !slices.Contains(j.Recovered, box) {
			j.Recovered = append(j.Recovered, box)
		}
		complete := true
		for _, file := range j.Files {
			if file.Kind == "" {
				complete = complete && slices.Contains(j.Recovered, file.Box)
			}
		}
		if complete {
			err = os.Remove(j.filename())
		} else {
			err = j.save()
		}
		if err != nil {
			return err
		}
	}
	return nil
}
