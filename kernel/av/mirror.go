package av

import (
	"os"
	"path/filepath"
	"sync"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
	"github.com/vmihailenco/msgpack/v5"
)

var (
	AttributeViewBlocksLock = sync.Mutex{}
)

func GetBlockRels() (ret map[string][]string) {
	AttributeViewBlocksLock.Lock()
	defer AttributeViewBlocksLock.Unlock()

	ret = map[string][]string{}

	blocks := filepath.Join(util.DataDir, "storage", "av", "blocks.msgpack")
	if !filelock.IsExist(blocks) {
		return
	}

	data, err := filelock.ReadFile(blocks)
	if err != nil {
		logging.LogErrorf("read attribute view blocks failed: %s", err)
		return
	}

	if err = msgpack.Unmarshal(data, &ret); err != nil {
		logging.LogErrorf("unmarshal attribute view blocks failed: %s", err)
		return
	}
	return
}

func IsMirror(avID string) bool {
	AttributeViewBlocksLock.Lock()
	defer AttributeViewBlocksLock.Unlock()

	blocks := filepath.Join(util.DataDir, "storage", "av", "blocks.msgpack")
	if !filelock.IsExist(blocks) {
		return false
	}

	data, err := filelock.ReadFile(blocks)
	if err != nil {
		logging.LogErrorf("read attribute view blocks failed: %s", err)
		return false
	}

	avBlocks := map[string][]string{}
	if err = msgpack.Unmarshal(data, &avBlocks); err != nil {
		logging.LogErrorf("unmarshal attribute view blocks failed: %s", err)
		return false
	}

	blockIDs := avBlocks[avID]
	return nil != blockIDs && 1 < len(blockIDs)
}

func RemoveBlockRel(avID, blockID string, existBlockTree func(string) bool) (ret bool) {
	AttributeViewBlocksLock.Lock()
	defer AttributeViewBlocksLock.Unlock()

	blocks := filepath.Join(util.DataDir, "storage", "av", "blocks.msgpack")
	if !filelock.IsExist(blocks) {
		return
	}

	data, err := filelock.ReadFile(blocks)
	if err != nil {
		logging.LogErrorf("read attribute view blocks failed: %s", err)
		return
	}

	avBlocks := map[string][]string{}
	if err = msgpack.Unmarshal(data, &avBlocks); err != nil {
		logging.LogErrorf("unmarshal attribute view blocks failed: %s", err)
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

	data, err = msgpack.Marshal(avBlocks)
	if err != nil {
		logging.LogErrorf("marshal attribute view blocks failed: %s", err)
		return
	}
	if err = filelock.WriteFile(blocks, data); err != nil {
		logging.LogErrorf("write attribute view blocks failed: %s", err)
		return
	}
	return
}

func BatchUpsertBlockRel(nodes []*ast.Node) {
	AttributeViewBlocksLock.Lock()
	defer AttributeViewBlocksLock.Unlock()

	avBlocks := map[string][]string{}
	blocks := filepath.Join(util.DataDir, "storage", "av", "blocks.msgpack")
	if !filelock.IsExist(blocks) {
		if err := os.MkdirAll(filepath.Dir(blocks), 0755); err != nil {
			logging.LogErrorf("create attribute view dir failed: %s", err)
			return
		}
	} else {
		data, err := filelock.ReadFile(blocks)
		if err != nil {
			logging.LogErrorf("read attribute view blocks failed: %s", err)
			return
		}

		if err = msgpack.Unmarshal(data, &avBlocks); err != nil {
			logging.LogErrorf("unmarshal attribute view blocks failed: %s", err)
			return
		}
	}

	for _, n := range nodes {
		if ast.NodeAttributeView != n.Type {
			continue
		}

		if "" == n.AttributeViewID || "" == n.ID {
			continue
		}

		blockIDs := avBlocks[n.AttributeViewID]
		blockIDs = append(blockIDs, n.ID)
		blockIDs = gulu.Str.RemoveDuplicatedElem(blockIDs)
		avBlocks[n.AttributeViewID] = blockIDs
	}

	data, err := msgpack.Marshal(avBlocks)
	if err != nil {
		logging.LogErrorf("marshal attribute view blocks failed: %s", err)
		return
	}
	if err = filelock.WriteFile(blocks, data); err != nil {
		logging.LogErrorf("write attribute view blocks failed: %s", err)
		return
	}
}

func UpsertBlockRel(avID, blockID string) (ret bool) {
	AttributeViewBlocksLock.Lock()
	defer AttributeViewBlocksLock.Unlock()

	avBlocks := map[string][]string{}
	blocks := filepath.Join(util.DataDir, "storage", "av", "blocks.msgpack")
	if !filelock.IsExist(blocks) {
		if err := os.MkdirAll(filepath.Dir(blocks), 0755); err != nil {
			logging.LogErrorf("create attribute view dir failed: %s", err)
			return
		}
	} else {
		data, err := filelock.ReadFile(blocks)
		if err != nil {
			logging.LogErrorf("read attribute view blocks failed: %s", err)
			return
		}

		if err = msgpack.Unmarshal(data, &avBlocks); err != nil {
			logging.LogErrorf("unmarshal attribute view blocks failed: %s", err)
			return
		}
	}

	blockIDs := avBlocks[avID]
	oldLen := len(blockIDs)
	blockIDs = append(blockIDs, blockID)
	blockIDs = gulu.Str.RemoveDuplicatedElem(blockIDs)
	avBlocks[avID] = blockIDs
	ret = oldLen != len(blockIDs) && 0 != oldLen

	data, err := msgpack.Marshal(avBlocks)
	if err != nil {
		logging.LogErrorf("marshal attribute view blocks failed: %s", err)
		return
	}
	if err = filelock.WriteFile(blocks, data); err != nil {
		logging.LogErrorf("write attribute view blocks failed: %s", err)
		return
	}
	return
}
