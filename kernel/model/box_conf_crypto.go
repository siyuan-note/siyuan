// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"path/filepath"
	"reflect"
	"strings"

	"github.com/88250/gulu"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type encryptedBoxMetadata struct {
	Version         int                   `json:"version,omitempty"`
	DocumentTargets *conf.DocumentTargets `json:"documentTargets,omitempty"`
	Icon            string                `json:"icon"`
	Sort            int                   `json:"sort"`
	SortMode        int                   `json:"sortMode"`
}

func encryptBoxMetadata(boxID string, boxConf *conf.BoxConf, dek []byte) error {
	if boxConf == nil || boxConf.BoxCrypt == nil {
		return errors.New("encrypted notebook key material is missing")
	}
	metadata := &encryptedBoxMetadata{
		Icon:     filterBoxIcon(boxConf.Icon),
		Sort:     boxConf.Sort,
		SortMode: boxConf.SortMode,
	}
	targets := conf.DocumentTargets{Document: boxConf.DocCreateTarget,
		Reference: boxConf.RefCreateTarget, DailyNote: boxConf.DailyNoteTarget}
	if boxConf.MetadataVersion > 2 {
		return errors.New("unsupported encrypted notebook metadata version")
	}
	if boxConf.MetadataVersion == 2 || !targets.Empty() {
		metadata.Version = 2
		metadata.DocumentTargets = &targets
	}
	plaintext, err := gulu.JSON.MarshalJSON(metadata)
	if err != nil {
		return err
	}
	key := util.DeriveSubKey(dek, "siyuan/box-metadata")
	defer zeroAndClear(key)
	boxConf.BoxCrypt.Metadata, err = util.EncryptWithAAD(key, plaintext, boxMetadataAAD(boxID))
	return err
}

func decryptBoxMetadata(boxID string, boxConf *conf.BoxConf, dek []byte) error {
	if boxConf == nil || boxConf.BoxCrypt == nil || len(boxConf.BoxCrypt.Metadata) == 0 {
		return errors.New("encrypted notebook metadata is missing")
	}
	key := util.DeriveSubKey(dek, "siyuan/box-metadata")
	defer zeroAndClear(key)
	plaintext, err := util.DecryptWithAAD(key, boxConf.BoxCrypt.Metadata, boxMetadataAAD(boxID))
	if err != nil {
		return err
	}
	metadata := &encryptedBoxMetadata{}
	decoder := json.NewDecoder(bytes.NewReader(plaintext))
	if token, err := decoder.Token(); err != nil || token != json.Delim('{') {
		return errors.New("invalid encrypted notebook metadata")
	}
	seen := map[string]bool{}
	for decoder.More() {
		token, err := decoder.Token()
		if err != nil {
			return err
		}
		name := strings.ToLower(token.(string))
		if seen[name] {
			return errors.New("duplicate encrypted notebook metadata field")
		}
		seen[name] = true
		if err = decoder.Decode(new(json.RawMessage)); err != nil {
			return err
		}
	}
	decoder = json.NewDecoder(bytes.NewReader(plaintext))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(metadata); err != nil {
		return err
	}
	if decoder.Decode(new(json.RawMessage)) != io.EOF {
		return errors.New("invalid encrypted notebook metadata suffix")
	}
	if metadata.Version != 0 && metadata.Version != 1 && metadata.Version != 2 ||
		metadata.Version < 2 && metadata.DocumentTargets != nil {
		return errors.New("unsupported encrypted notebook metadata version")
	}
	boxConf.Icon = filterBoxIcon(metadata.Icon)
	boxConf.Sort = metadata.Sort
	boxConf.SortMode = metadata.SortMode
	boxConf.MetadataVersion = max(1, metadata.Version)
	boxConf.DocCreateTarget, boxConf.RefCreateTarget, boxConf.DailyNoteTarget = nil, nil, nil
	if metadata.DocumentTargets != nil {
		boxConf.DocCreateTarget, boxConf.RefCreateTarget, boxConf.DailyNoteTarget =
			metadata.DocumentTargets.Document, metadata.DocumentTargets.Reference, metadata.DocumentTargets.DailyNote
	}
	return nil
}

func revealBoxMetadataIfUnlocked(boxID string, boxConf *conf.BoxConf) error {
	clearBoxMetadata(boxConf)
	dek, ok := cachedDEKCopy(boxID)
	if !ok {
		return nil
	}
	defer zeroAndClear(dek)
	if err := decryptBoxMetadata(boxID, boxConf, dek); err != nil {
		setEncryptedBoxState(boxID, EncryptedBoxStateError)
		return err
	}
	return nil
}

func prepareBoxConfForSave(boxID string, boxConf *conf.BoxConf) (*conf.BoxConf, error) {
	if boxConf == nil {
		return nil, errors.New("notebook configuration is missing")
	}
	persisted := *boxConf
	persisted.BoxCrypt = DeepCopyBoxEncryption(boxConf.BoxCrypt)
	if persisted.Encrypted {
		forgetRuntimeNormalBox(boxID)
	}
	if !persisted.Encrypted {
		if IsEncryptedBox(boxID) {
			return nil, errors.New("encrypted notebook cannot be saved as a normal notebook")
		}
		return &persisted, nil
	}
	if persisted.BoxCrypt == nil {
		clearBoxMetadata(&persisted)
		return &persisted, nil
	}
	if GetEncryptedBoxState(boxID) == EncryptedBoxStateError {
		return nil, errors.New("encrypted notebook is in an error state")
	}

	if dek, ok := cachedDEKCopy(boxID); ok {
		defer zeroAndClear(dek)
		if err := reuseBoxMetadataIfUnchanged(boxID, &persisted, dek); err != nil {
			return nil, err
		}
	} else if persisted.DocCreateTarget != nil || persisted.RefCreateTarget != nil || persisted.DailyNoteTarget != nil {
		return nil, errors.New("unlock the notebook before changing document targets")
	} else if len(persisted.BoxCrypt.Metadata) == 0 {
		existing, err := readRawBoxConf(boxID)
		if err != nil {
			return nil, err
		}
		if existing == nil || existing.BoxCrypt == nil || len(existing.BoxCrypt.Metadata) == 0 {
			return nil, errors.New("encrypted notebook metadata is missing")
		}
		persisted.BoxCrypt.Metadata = append([]byte(nil), existing.BoxCrypt.Metadata...)
	}
	if err := validateBoxEncryption(persisted.BoxCrypt); err != nil {
		return nil, err
	}
	clearBoxMetadata(&persisted)
	return &persisted, nil
}

func reuseBoxMetadataIfUnchanged(boxID string, boxConf *conf.BoxConf, dek []byte) error {
	existing, err := readRawBoxConf(boxID)
	if err != nil {
		return err
	}
	if existing != nil && existing.Encrypted && existing.BoxCrypt != nil && len(existing.BoxCrypt.Metadata) > 0 {
		decrypted := &conf.BoxConf{BoxCrypt: DeepCopyBoxEncryption(existing.BoxCrypt)}
		if err = decryptBoxMetadata(boxID, decrypted, dek); err != nil {
			return err
		}
		boxConf.MetadataVersion = max(boxConf.MetadataVersion, decrypted.MetadataVersion)
		if filterBoxIcon(decrypted.Icon) == filterBoxIcon(boxConf.Icon) &&
			decrypted.Sort == boxConf.Sort && decrypted.SortMode == boxConf.SortMode &&
			reflect.DeepEqual(decrypted.DocCreateTarget, boxConf.DocCreateTarget) &&
			reflect.DeepEqual(decrypted.RefCreateTarget, boxConf.RefCreateTarget) &&
			reflect.DeepEqual(decrypted.DailyNoteTarget, boxConf.DailyNoteTarget) {
			boxConf.BoxCrypt.Metadata = append([]byte(nil), existing.BoxCrypt.Metadata...)
			return nil
		}
	}
	return encryptBoxMetadata(boxID, boxConf, dek)
}

func clearBoxMetadata(boxConf *conf.BoxConf) {
	boxConf.DocCreateTarget, boxConf.RefCreateTarget, boxConf.DailyNoteTarget = nil, nil, nil
	boxConf.MetadataVersion = 0
	boxConf.Icon = ""
	boxConf.Sort = 0
	boxConf.SortMode = util.SortModeFileTree
}

func cachedDEKCopy(boxID string) ([]byte, bool) {
	cachedDEKsLock.RLock()
	defer cachedDEKsLock.RUnlock()
	dek, ok := cachedDEKs[boxID]
	if !ok {
		return nil, false
	}
	return append([]byte(nil), dek...), true
}

func boxMetadataAAD(boxID string) []byte {
	return []byte("siyuan:box-metadata:" + boxID)
}

func readRawBoxConf(boxID string) (*conf.BoxConf, error) {
	confPath := filepath.Join(util.DataDir, boxID, ".siyuan", "conf.json")
	if !filelock.IsExist(confPath) {
		return nil, nil
	}
	data, err := filelock.ReadFile(confPath)
	if err != nil {
		return nil, err
	}
	ret := conf.NewBoxConf()
	if err = gulu.JSON.UnmarshalJSON(data, ret); err != nil {
		return nil, err
	}
	return ret, nil
}
