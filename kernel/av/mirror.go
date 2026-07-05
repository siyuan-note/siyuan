package av

import (
	"sync"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/siyuan-note/logging"
)

var (
	AttributeViewBlocksLock = sync.Mutex{}
)

func GetBlockRels() (ret map[string][]string) {
	AttributeViewBlocksLock.Lock()
	defer AttributeViewBlocksLock.Unlock()

	ret = map[string][]string{}
	// 全局镜像索引（普通 box）
	for k, v := range readMirrorBlocks("") {
		ret[k] = v
	}
	// 加密 box 的镜像索引（已打开的）
	if AVEncryptedBoxIDs != nil {
		for _, encBoxID := range AVEncryptedBoxIDs() {
			for k, v := range readMirrorBlocks(encBoxID) {
				ret[k] = v
			}
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

	// 按 boxID 分桶：普通 box 的 avID 写全局镜像，加密 box 的 avID 写笔记本级镜像
	boxAvBlocks := map[string]map[string][]string{} // boxID → avBlocks

	for _, n := range nodes {
		if ast.NodeAttributeView != n.Type {
			continue
		}

		if "" == n.AttributeViewID || "" == n.ID {
			continue
		}

		_, boxID := FindAttributeViewPath(n.AttributeViewID)
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

	_, boxID := FindAttributeViewPath(avID)
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
