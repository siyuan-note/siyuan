package av

import (
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
func readRelations(boxID string) (avRels map[string][]string) {
	avRels = map[string][]string{}
	p := relationsPath(boxID)
	if !filelock.IsExist(p) {
		return
	}
	data, err := filelock.ReadFile(p)
	if err != nil {
		logging.LogErrorf("read attribute view relations failed: %s", err)
		return
	}
	if boxID != "" {
		dec, decErr := decryptAVData(boxID, "relation", data)
		if decErr != nil {
			logging.LogErrorf("decrypt attribute view relations failed: %s", decErr)
			return
		}
		data = dec
	}
	if err = msgpack.Unmarshal(data, &avRels); err != nil {
		logging.LogErrorf("unmarshal attribute view relations failed: %s", err)
		return
	}
	return
}

// writeRelations 写入 relations 索引（boxID 非空时加密）。
func writeRelations(boxID string, avRels map[string][]string) {
	p := relationsPath(boxID)
	if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
		logging.LogErrorf("create attribute view dir failed: %s", err)
		return
	}
	data, err := msgpack.Marshal(avRels)
	if err != nil {
		logging.LogErrorf("marshal attribute view relations failed: %s", err)
		return
	}
	if boxID != "" {
		enc, encErr := encryptAVData(boxID, "relation", data)
		if encErr != nil {
			logging.LogErrorf("encrypt attribute view relations failed: %s", encErr)
			return
		}
		data = enc
	}
	if err = filelock.WriteFile(p, data); err != nil {
		logging.LogErrorf("write attribute view relations failed: %s", err)
		return
	}
}

// relationsBoxIDByAvID 由 destAvID 反查归属 boxID，决定 relations 索引的存储位置。
// 加密笔记本的 AV 返回其 boxID；普通 box 的 AV 返回空串（全局路径）。
func relationsBoxIDByAvID(avID string) string {
	_, boxID := FindAttributeViewPath(avID)
	return boxID
}

func GetSrcAvIDs(destAvID string) []string {
	attributeViewRelationsLock.Lock()
	defer attributeViewRelationsLock.Unlock()

	boxID := relationsBoxIDByAvID(destAvID)
	avRels := readRelations(boxID)
	srcAvIDs := avRels[destAvID]
	if nil == srcAvIDs {
		return nil
	}
	return srcAvIDs
}

func RemoveAvRel(srcAvID, destAvID string) {
	attributeViewRelationsLock.Lock()
	defer attributeViewRelationsLock.Unlock()

	boxID := relationsBoxIDByAvID(destAvID)
	avRels := readRelations(boxID)

	srcAvIDs := avRels[destAvID]
	if nil == srcAvIDs {
		return
	}

	var newAvIDs []string
	for _, v := range srcAvIDs {
		if v != srcAvID {
			newAvIDs = append(newAvIDs, v)
		}
	}
	avRels[destAvID] = newAvIDs
	writeRelations(boxID, avRels)
}

func UpsertAvBackRel(srcAvID, destAvID string) {
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
			return
		}
	}

	boxID := destBox
	avRels := readRelations(boxID)

	srcAvIDs := avRels[destAvID]
	srcAvIDs = append(srcAvIDs, srcAvID)
	srcAvIDs = gulu.Str.RemoveDuplicatedElem(srcAvIDs)
	avRels[destAvID] = srcAvIDs
	writeRelations(boxID, avRels)
}
