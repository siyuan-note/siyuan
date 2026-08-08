// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package model

import (
	"errors"
	"path/filepath"

	"github.com/88250/gulu"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type encryptedBoxMetadata struct {
	Icon     string `json:"icon"`
	Sort     int    `json:"sort"`
	SortMode int    `json:"sortMode"`
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
	if err = gulu.JSON.UnmarshalJSON(plaintext, metadata); err != nil {
		return err
	}
	boxConf.Icon = filterBoxIcon(metadata.Icon)
	boxConf.Sort = metadata.Sort
	boxConf.SortMode = metadata.SortMode
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
		if err = decryptBoxMetadata(boxID, decrypted, dek); err == nil &&
			filterBoxIcon(decrypted.Icon) == filterBoxIcon(boxConf.Icon) &&
			decrypted.Sort == boxConf.Sort && decrypted.SortMode == boxConf.SortMode {
			boxConf.BoxCrypt.Metadata = append([]byte(nil), existing.BoxCrypt.Metadata...)
			return nil
		}
	}
	return encryptBoxMetadata(boxID, boxConf, dek)
}

func clearBoxMetadata(boxConf *conf.BoxConf) {
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
