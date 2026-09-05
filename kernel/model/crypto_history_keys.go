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
	"bytes"
	"errors"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const historyKEKAAD = "siyuan:history-kek:v1"

// decryptHistoryKEKs 只在当前配置已经完成主密码认证后使用，返回值由调用方在使用结束时清零。
func decryptHistoryKEKs(kek []byte, wrappedKeys [][]byte) (keys [][]byte, err error) {
	defer func() {
		if err != nil {
			clearHistoryKEKs(keys)
			keys = nil
		}
	}()
	for _, wrapped := range wrappedKeys {
		key, decryptErr := util.DecryptWithAAD(kek, wrapped, []byte(historyKEKAAD))
		if decryptErr != nil {
			return keys, decryptErr
		}
		if len(key) != 32 {
			zeroAndClear(key)
			return keys, errors.New("invalid historical notebook encryption key")
		}
		keys = append(keys, key)
	}
	return keys, nil
}

func clearHistoryKEKs(keys [][]byte) {
	for _, key := range keys {
		zeroAndClear(key)
	}
}

// rewrapHistoryKEKs 将历次 KEK 和本次旧 KEK 一起封装到新 KEK 下，恢复不依赖历史所在设备。
func rewrapHistoryKEKs(oldKEK, newKEK []byte, wrappedKeys [][]byte) (ret [][]byte, err error) {
	keys, err := decryptHistoryKEKs(oldKEK, wrappedKeys)
	if err != nil {
		return nil, err
	}
	keys = append(keys, append([]byte(nil), oldKEK...))
	defer clearHistoryKEKs(keys)
	for i, key := range keys {
		if bytes.Equal(key, newKEK) {
			continue
		}
		duplicate := false
		for _, previous := range keys[:i] {
			if bytes.Equal(key, previous) {
				duplicate = true
				break
			}
		}
		if duplicate {
			continue
		}
		wrapped, wrapErr := util.EncryptWithAAD(newKEK, key, []byte(historyKEKAAD))
		if wrapErr != nil {
			return nil, wrapErr
		}
		ret = append(ret, wrapped)
	}
	return ret, nil
}

// decryptWrappedDEKWithHistory 同时支持当前包络和历史包络，不缓存派生或解封出的 KEK。
func decryptWrappedDEKWithHistory(boxID string, enc *conf.BoxEncryption, kek []byte, nc *conf.NotebookCrypto) ([]byte, error) {
	dek, err := decryptWrappedDEK(boxID, enc, kek)
	if err == nil || nc == nil || len(nc.HistoryKEKs) == 0 {
		return dek, err
	}
	keys, keyErr := decryptHistoryKEKs(kek, nc.HistoryKEKs)
	if keyErr != nil {
		return nil, keyErr
	}
	defer clearHistoryKEKs(keys)
	for _, key := range keys {
		if dek, err = decryptWrappedDEK(boxID, enc, key); err == nil {
			return dek, nil
		}
	}
	return nil, err
}

func currentNotebookCrypto() *conf.NotebookCrypto {
	Conf.m.RLock()
	defer Conf.m.RUnlock()
	ret := *Conf.NotebookCrypto
	return &ret
}
