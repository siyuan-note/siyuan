package av

import (
	"maps"
	"sync"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/siyuan-note/logging"
)

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

func IsMirror(avID string) bool {
	AttributeViewBlocksLock.Lock()
	defer AttributeViewBlocksLock.Unlock()

	_, boxID := FindAttributeViewPath(avID)
	avBlocks := readMirrorBlocks(boxID)
	blockIDs := avBlocks[avID]
	return nil != blockIDs && 1 < len(blockIDs)
}

func RemoveBlockRel(avID, blockID string, existBlockTree func(string) bool) (ret bool) {
	AttributeViewBlocksLock.Lock()
	defer AttributeViewBlocksLock.Unlock()

	_, boxID := FindAttributeViewPath(avID)
	avBlocks := readMirrorBlocks(boxID)

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

	if err := writeMirrorBlocks(boxID, avBlocks); err != nil {
		logging.LogErrorf("write attribute view blocks failed: %s", err)
		return
	}
	return
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
			avBlocks = readMirrorBlocks(boxID)
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
	avBlocks := readMirrorBlocks(boxID)

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
