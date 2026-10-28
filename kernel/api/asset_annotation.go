// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"sync"

	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/model"
)

// Serialize annotation snapshots and read/merge/write operations across viewers.
var fileAnnotationMu sync.Mutex

var errAnnotationConflict = errors.New("annotation revision conflict")

func parseFileAnnotations(data string) (map[string]fileAnno, error) {
	var annotations map[string]fileAnno
	if err := json.Unmarshal([]byte(data), &annotations); err != nil {
		return nil, err
	}
	if annotations == nil {
		return nil, errors.New("invalid annotation")
	}
	return annotations, nil
}

func readFileAnnotationData(filePath, boxID string) ([]byte, error) {
	data, err := filelock.ReadFile(filePath)
	if err != nil {
		return nil, err
	}
	if boxID != "" && model.IsEncryptedBox(boxID) {
		dek, err := model.GetDEKIfUnlocked(boxID)
		if err != nil {
			return nil, err
		}
		return model.DecryptAsset(boxID, filepath.Base(filePath), dek, data)
	}
	return data, nil
}

func mergeFileAnnotations(filePath, boxID, baseData, data string) (map[string]fileAnno, error) {
	base, err := parseFileAnnotations(baseData)
	if err != nil {
		return nil, err
	}
	desired, err := parseFileAnnotations(data)
	if err != nil {
		return nil, err
	}
	current := map[string]fileAnno{}
	stored, err := readFileAnnotationData(filePath, boxID)
	if err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	if err == nil {
		if current, err = parseFileAnnotations(string(stored)); err != nil {
			return nil, err
		}
	}
	ids := map[string]bool{}
	for id := range base {
		ids[id] = true
	}
	for id := range desired {
		ids[id] = true
	}
	for id := range ids {
		before, hadBefore := base[id]
		after, hasAfter := desired[id]
		if hadBefore == hasAfter && reflect.DeepEqual(before, after) {
			continue
		}
		latest, hasLatest := current[id]
		if hasLatest == hasAfter && reflect.DeepEqual(latest, after) {
			continue
		}
		if hasLatest != hadBefore || !reflect.DeepEqual(latest, before) {
			return nil, errAnnotationConflict
		}
		if hasAfter {
			current[id] = after
		} else {
			delete(current, id)
		}
	}
	return current, nil
}
