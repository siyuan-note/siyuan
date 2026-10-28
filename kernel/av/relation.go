// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package av

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"github.com/88250/gulu"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
	"github.com/vmihailenco/msgpack/v5"
)

var (
	attributeViewRelationsLock = sync.Mutex{}
)

// relationsPath 返回 relations 索引文件路径，按 AV 归属 box 分箱。
// 加密 box：<DataDir>/<boxID>/storage/av/relations.msgpack（DEK 加密）
// 普通 box：<DataDir>/storage/av/relations.msgpack（明文）
func relationsPath(boxID string) string {
	if boxID != "" {
		return filepath.Join(util.DataDir, boxID, "storage", "av", "relations.msgpack")
	}
	return filepath.Join(util.DataDir, "storage", "av", "relations.msgpack")
}

// readRelations 读取 relations 索引（boxID 非空时自动解密）。
func readRelations(boxID string) (avRels map[string][]string, err error) {
	avRels = map[string][]string{}
	p := relationsPath(boxID)
	if _, err = os.Stat(p); os.IsNotExist(err) {
		return avRels, nil
	} else if err != nil {
		return
	}
	data, err := filelock.ReadFile(p)
	if err != nil {
		return
	}
	if boxID != "" {
		data, err = decryptAVData(boxID, "relation", data)
		if err != nil {
			return
		}
	}
	if err = msgpack.Unmarshal(data, &avRels); err != nil {
		return
	}
	if avRels == nil {
		err = fmt.Errorf("invalid database relation index")
	}
	return
}

// writeRelations 写入 relations 索引（boxID 非空时加密）。
func writeRelations(boxID string, avRels map[string][]string) error {
	p := relationsPath(boxID)
	if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
		logging.LogErrorf("create attribute view dir failed: %s", err)
		return err
	}
	data, err := msgpack.Marshal(avRels)
	if err != nil {
		logging.LogErrorf("marshal attribute view relations failed: %s", err)
		return err
	}
	if boxID != "" {
		enc, encErr := encryptAVData(boxID, "relation", data)
		if encErr != nil {
			logging.LogErrorf("encrypt attribute view relations failed: %s", encErr)
			return encErr
		}
		data = enc
	}
	if value, ok := relationWriteRecorders.Load(boxID); ok {
		before, readErr := filelock.ReadFile(p)
		if os.IsNotExist(readErr) {
			before, readErr = nil, nil
		}
		if readErr != nil {
			return readErr
		}
		if err = value.(SourceWriteRecorder)(boxID, before, data); err != nil {
			return err
		}
		return util.WriteFileIfUnchanged(p, before, data)
	}
	if err = filelock.WriteFile(p, data); err != nil {
		logging.LogErrorf("write attribute view relations failed: %s", err)
		return err
	}
	return nil
}

// relationsBoxIDByAvID 由 destAvID 反查归属 boxID，决定 relations 索引的存储位置。
// 加密笔记本的 AV 返回其 boxID；普通 box 的 AV 返回空串（全局路径）。
func relationsBoxIDByAvID(avID string) string {
	_, boxID := FindAttributeViewPath(avID)
	return boxID
}

func GetSrcAvIDs(destAvID string) []string {
	srcAvIDs, err := GetSrcAvIDsWithErr(destAvID)
	if err != nil {
		logging.LogErrorf("read attribute view relations failed: %s", err)
		return nil
	}
	return srcAvIDs
}

// GetSrcAvIDsWithErr preserves read/authentication errors for destructive callers.
func GetSrcAvIDsWithErr(destAvID string) ([]string, error) {
	attributeViewRelationsLock.Lock()
	defer attributeViewRelationsLock.Unlock()

	boxID := relationsBoxIDByAvID(destAvID)
	avRels, err := readRelations(boxID)
	if err != nil {
		return nil, err
	}
	return avRels[destAvID], nil
}

// GetSrcAvIDsForRefresh 按广度优先顺序收集需要刷新的直接和间接关联源，不包含起始数据库。
func GetSrcAvIDsForRefresh(destAvIDs []string) []string {
	return collectSrcAvIDsForRefresh(destAvIDs, GetSrcAvIDs)
}

func collectSrcAvIDsForRefresh(destAvIDs []string, getSrcAvIDs func(string) []string) (ret []string) {
	visited := map[string]bool{}
	var queue []string
	for _, avID := range destAvIDs {
		if visited[avID] {
			continue
		}
		visited[avID] = true
		queue = append(queue, avID)
	}

	for i := 0; i < len(queue); i++ {
		for _, srcAvID := range getSrcAvIDs(queue[i]) {
			if visited[srcAvID] {
				continue
			}
			visited[srcAvID] = true
			queue = append(queue, srcAvID)
			ret = append(ret, srcAvID)
		}
	}
	return
}

func RemoveAvRel(srcAvID, destAvID string) {
	if err := RemoveAvRelWithErr(srcAvID, destAvID); err != nil {
		logging.LogErrorf("remove attribute view relation failed: %s", err)
	}
}

func RemoveAvRelWithErr(srcAvID, destAvID string) error {
	attributeViewRelationsLock.Lock()
	defer attributeViewRelationsLock.Unlock()

	boxID := relationsBoxIDByAvID(destAvID)
	avRels, err := readRelations(boxID)
	if err != nil {
		return err
	}

	srcAvIDs := avRels[destAvID]
	if nil == srcAvIDs {
		return nil
	}

	var newAvIDs []string
	for _, v := range srcAvIDs {
		if v != srcAvID {
			newAvIDs = append(newAvIDs, v)
		}
	}
	avRels[destAvID] = newAvIDs
	return writeRelations(boxID, avRels)
}

func UpsertAvBackRel(srcAvID, destAvID string) {
	if err := UpsertAvBackRelWithErr(srcAvID, destAvID); err != nil {
		logging.LogErrorf("upsert attribute view relation failed: %s", err)
	}
}

func UpsertAvBackRelWithErr(srcAvID, destAvID string) error {
	attributeViewRelationsLock.Lock()
	defer attributeViewRelationsLock.Unlock()

	// 跨加密边界拒绝：src 和 dest 必须处于同一加密边界（都普通或同一加密 box），
	// 否则关联会把加密 AV 的存在/结构泄漏到普通库或另一个加密 box
	_, srcBox := FindAttributeViewPath(srcAvID)
	_, destBox := FindAttributeViewPath(destAvID)
	if AVIsEncryptedBox != nil {
		srcEnc := srcBox != "" && AVIsEncryptedBox(srcBox)
		destEnc := destBox != "" && AVIsEncryptedBox(destBox)
		if srcEnc != destEnc || (srcEnc && destEnc && srcBox != destBox) {
			logging.LogWarnf("skip cross-boundary AV relation: src=%s(box=%s) dest=%s(box=%s)", srcAvID, srcBox, destAvID, destBox)
			return fmt.Errorf("cross-boundary database relation")
		}
	}

	boxID := destBox
	avRels, err := readRelations(boxID)
	if err != nil {
		return err
	}

	srcAvIDs := avRels[destAvID]
	srcAvIDs = append(srcAvIDs, srcAvID)
	srcAvIDs = gulu.Str.RemoveDuplicatedElem(srcAvIDs)
	avRels[destAvID] = srcAvIDs
	return writeRelations(boxID, avRels)
}
