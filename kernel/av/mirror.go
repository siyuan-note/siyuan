// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package av

import (
	"fmt"
	"maps"
	"sync"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/siyuan-note/logging"
)

// AddCopiedBlockRels 在同一存储边界内登记副本的镜像关系，认证失败或写入失败时返回错误。
// 调用方须先写入全部副本文档，并在失败时清理本次新建的文档。
func AddCopiedBlockRels(boxID string, nodes []*ast.Node) error {
	if len(nodes) == 0 {
		return nil
	}
	AttributeViewBlocksLock.Lock()
	defer AttributeViewBlocksLock.Unlock()
	rels, err := readMirrorBlocksWithErr(boxID)
	if err != nil {
		return err
	}
	if rels == nil {
		return fmt.Errorf("invalid database mirror index")
	}
	for _, node := range nodes {
		if node.Type != ast.NodeAttributeView || !ast.IsNodeIDPattern(node.ID) || !ast.IsNodeIDPattern(node.AttributeViewID) {
			return fmt.Errorf("invalid copied database block [%s]", node.ID)
		}
		// 磁盘认证不能由已缓存的数据库定义替代。
		data, readErr := ReadAttributeViewDataInBox(node.AttributeViewID, boxID)
		if readErr != nil {
			return readErr
		}
		if data == nil {
			return fmt.Errorf("database [%s] not found", node.AttributeViewID)
		}
		if _, readErr = ParseAttributeViewData(node.AttributeViewID, data); readErr != nil {
			return readErr
		}
		rels[node.AttributeViewID] = gulu.Str.RemoveDuplicatedElem(append(rels[node.AttributeViewID], node.ID))
	}
	return writeMirrorBlocks(boxID, rels)
}

var (
	AttributeViewBlocksLock = sync.Mutex{}
)

// isSameCryptoBoundary 判断 AV 定义所在 box 与源块所在 box 是否处于同一加密边界。
// 普通↔普通允许；涉及加密时必须为同一 box。与 relation.go 的跨边界校验逻辑一致。
func isSameCryptoBoundary(avBoxID, blockBoxID string) bool {
	if AVIsEncryptedBox == nil {
		return true // hook 未注入（非正常运行），放行避免阻塞
	}
	avEnc := avBoxID != "" && AVIsEncryptedBox(avBoxID)
	blockEnc := blockBoxID != "" && AVIsEncryptedBox(blockBoxID)
	if !avEnc && !blockEnc {
		return true // 普通↔普通：允许
	}
	return avEnc && blockEnc && avBoxID == blockBoxID // 加密：仅同一 box 内允许
}

func GetBlockRels() (ret map[string][]string) {
	AttributeViewBlocksLock.Lock()
	defer AttributeViewBlocksLock.Unlock()

	ret = map[string][]string{}
	// 全局镜像索引（普通 box）
	maps.Copy(ret, readMirrorBlocks(""))
	// 加密笔记本的镜像索引（已打开的）
	if AVEncryptedBoxIDs != nil {
		for _, encBoxID := range AVEncryptedBoxIDs() {
			maps.Copy(ret, readMirrorBlocks(encBoxID))
		}
	}
	return
}

// GetBlockRelsByAVIDs 读取指定属性视图的数据库块关系，读取失败时返回错误。
func GetBlockRelsByAVIDs(avIDs []string) (ret map[string][]string, err error) {
	AttributeViewBlocksLock.Lock()
	defer AttributeViewBlocksLock.Unlock()

	ret = map[string][]string{}
	boxRels := map[string]map[string][]string{}
	for _, avID := range avIDs {
		_, boxID := FindAttributeViewPath(avID)
		rels, loaded := boxRels[boxID]
		if !loaded {
			if rels, err = readMirrorBlocksWithErr(boxID); nil != err {
				return
			}
			boxRels[boxID] = rels
		}
		ret[avID] = rels[avID]
	}
	return
}

func IsMirror(avID string) bool {
	AttributeViewBlocksLock.Lock()
	defer AttributeViewBlocksLock.Unlock()

	_, boxID := FindAttributeViewPath(avID)
	avBlocks := readMirrorBlocks(boxID)
	blockIDs := avBlocks[avID]
	return nil != blockIDs && 1 < len(blockIDs)
}

func RemoveBlockRel(avID, blockID string, existBlockTree func(string) bool) (ret bool) {
	ret, err := RemoveBlockRelWithError(avID, blockID, existBlockTree)
	if err != nil {
		logging.LogErrorf("remove database mirror relation failed: %s", err)
	}
	return ret
}

// RemoveBlockRelWithError 删除数据库块映射，读取或保存失败时由调用方中止事务。
func RemoveBlockRelWithError(avID, blockID string, existBlockTree func(string) bool) (ret bool, err error) {
	AttributeViewBlocksLock.Lock()
	defer AttributeViewBlocksLock.Unlock()

	_, boxID := FindAttributeViewPath(avID)
	avBlocks, err := readMirrorBlocksWithErr(boxID)
	if err != nil {
		return
	}

	blockIDs := avBlocks[avID]
	if nil == blockIDs {
		return
	}

	var newBlockIDs []string
	for _, v := range blockIDs {
		if v != blockID {
			if existBlockTree(v) {
				newBlockIDs = append(newBlockIDs, v)
			}
		}
	}
	avBlocks[avID] = newBlockIDs
	ret = len(newBlockIDs) != len(blockIDs)

	err = writeMirrorBlocks(boxID, avBlocks)
	return
}

// ReconcileBlockRels 按实际源恢复本次事务触及的映射，保留其他数据库和镜像节点。
func ReconcileBlockRels(nodes []BlockRelRecovery, present map[string]string) error {
	AttributeViewBlocksLock.Lock()
	defer AttributeViewBlocksLock.Unlock()
	byBox := map[string][]BlockRelRecovery{}
	for _, node := range nodes {
		_, box := FindAttributeViewPath(node.AttributeViewID)
		if !isSameCryptoBoundary(box, node.BoxID) {
			return fmt.Errorf("cross-boundary database mirror recovery")
		}
		byBox[box] = append(byBox[box], node)
	}
	for box, scoped := range byBox {
		rels, err := readMirrorBlocksWithErr(box)
		if err != nil {
			return err
		}
		for _, node := range scoped {
			ids := gulu.Str.RemoveElem(rels[node.AttributeViewID], node.ID)
			if present[node.ID] == node.AttributeViewID {
				ids = append(ids, node.ID)
			}
			rels[node.AttributeViewID] = ids
		}
		if err = writeMirrorBlocks(box, rels); err != nil {
			return err
		}
	}
	return nil
}

// BlockRelRecovery 保留源笔记本边界，节点已从索引移除时仍可校验恢复目标。
type BlockRelRecovery struct {
	ID              string
	AttributeViewID string
	BoxID           string
}

func BatchUpsertBlockRel(nodes []*ast.Node) {
	AttributeViewBlocksLock.Lock()
	defer AttributeViewBlocksLock.Unlock()

	// 按 boxID 分桶：普通 box 的 avID 写全局镜像，加密笔记本的 avID 写笔记本级镜像
	boxAvBlocks := map[string]map[string][]string{} // boxID → avBlocks

	for _, n := range nodes {
		if ast.NodeAttributeView != n.Type {
			continue
		}

		if "" == n.AttributeViewID || "" == n.ID {
			continue
		}

		_, avBoxID := FindAttributeViewPath(n.AttributeViewID)
		// 跨加密边界校验：源块（AV 块节点本身）的 box 必须与 AV 定义处于同一加密边界，
		// 否则加密块 ID 会泄漏到全局明文镜像索引（或反向）
		if AVGetBlockBoxID != nil {
			blockBoxID := AVGetBlockBoxID(n.ID)
			if !isSameCryptoBoundary(avBoxID, blockBoxID) {
				logging.LogWarnf("skip cross-boundary AV mirror: avID=%s(avBox=%s) block=%s(blockBox=%s)",
					n.AttributeViewID, avBoxID, n.ID, blockBoxID)
				continue
			}
		}
		boxID := avBoxID
		avBlocks, ok := boxAvBlocks[boxID]
		if !ok {
			var err error
			avBlocks, err = readMirrorBlocksWithErr(boxID)
			if err != nil {
				logging.LogErrorf("read attribute view blocks failed: %s", err)
				return
			}
			boxAvBlocks[boxID] = avBlocks
		}

		blockIDs := avBlocks[n.AttributeViewID]
		blockIDs = append(blockIDs, n.ID)
		blockIDs = gulu.Str.RemoveDuplicatedElem(blockIDs)
		avBlocks[n.AttributeViewID] = blockIDs
	}

	for boxID, avBlocks := range boxAvBlocks {
		if err := writeMirrorBlocks(boxID, avBlocks); err != nil {
			logging.LogErrorf("write attribute view blocks failed: %s", err)
		}
	}
}

func UpsertBlockRel(avID, blockID string) (ret bool) {
	AttributeViewBlocksLock.Lock()
	defer AttributeViewBlocksLock.Unlock()

	_, avBoxID := FindAttributeViewPath(avID)
	// 跨加密边界校验：源块的 box 必须与 AV 定义处于同一加密边界
	if AVGetBlockBoxID != nil {
		blockBoxID := AVGetBlockBoxID(blockID)
		if !isSameCryptoBoundary(avBoxID, blockBoxID) {
			logging.LogWarnf("skip cross-boundary AV mirror: avID=%s(avBox=%s) block=%s(blockBox=%s)",
				avID, avBoxID, blockID, blockBoxID)
			return
		}
	}
	boxID := avBoxID
	avBlocks, err := readMirrorBlocksWithErr(boxID)
	if err != nil {
		logging.LogErrorf("read attribute view blocks failed: %s", err)
		return
	}

	blockIDs := avBlocks[avID]
	oldLen := len(blockIDs)
	blockIDs = append(blockIDs, blockID)
	blockIDs = gulu.Str.RemoveDuplicatedElem(blockIDs)
	avBlocks[avID] = blockIDs
	ret = oldLen != len(blockIDs) && 0 != oldLen

	if err := writeMirrorBlocks(boxID, avBlocks); err != nil {
		logging.LogErrorf("write attribute view blocks failed: %s", err)
		return
	}
	return
}
