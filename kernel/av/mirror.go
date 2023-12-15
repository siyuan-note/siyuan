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
	attributeViewBlocksLock = sync.Mutex{}
)

func GetMirrorBlockIDs(avID string) []string {
	attributeViewBlocksLock.Lock()
	defer attributeViewBlocksLock.Unlock()

	blocks := filepath.Join(util.DataDir, "storage", "av", "blocks.msgpack")
	if !filelock.IsExist(blocks) {
		return nil
	}

	data, err := filelock.ReadFile(blocks)
	if nil != err {
		logging.LogErrorf("read attribute view blocks failed: %s", err)
		return nil
	}

	avBlocks := map[string][]string{}
	if err = msgpack.Unmarshal(data, &avBlocks); nil != err {
		logging.LogErrorf("unmarshal attribute view blocks failed: %s", err)
		return nil
	}

	blockIDs := avBlocks[avID]
	return blockIDs
}

func IsMirror(avID string) bool {
	attributeViewBlocksLock.Lock()
	defer attributeViewBlocksLock.Unlock()

	blocks := filepath.Join(util.DataDir, "storage", "av", "blocks.msgpack")
	if !filelock.IsExist(blocks) {
		return false
	}

	data, err := filelock.ReadFile(blocks)
	if nil != err {
		logging.LogErrorf("read attribute view blocks failed: %s", err)
		return false
	}

	avBlocks := map[string][]string{}
	if err = msgpack.Unmarshal(data, &avBlocks); nil != err {
		logging.LogErrorf("unmarshal attribute view blocks failed: %s", err)
		return false
	}

	blockIDs := avBlocks[avID]
	return nil != blockIDs && 1 < len(blockIDs)
}

func RemoveBlockRel(avID, blockID string) {
	attributeViewBlocksLock.Lock()
	defer attributeViewBlocksLock.Unlock()

	blocks := filepath.Join(util.DataDir, "storage", "av", "blocks.msgpack")
	if !filelock.IsExist(blocks) {
		return
	}

	data, err := filelock.ReadFile(blocks)
	if nil != err {
		logging.LogErrorf("read attribute view blocks failed: %s", err)
		return
	}

	avBlocks := map[string][]string{}
	if err = msgpack.Unmarshal(data, &avBlocks); nil != err {
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
			newBlockIDs = append(newBlockIDs, v)
		}
	}
	avBlocks[avID] = newBlockIDs

	data, err = msgpack.Marshal(avBlocks)
	if nil != err {
		logging.LogErrorf("marshal attribute view blocks failed: %s", err)
		return
	}
	if err = filelock.WriteFile(blocks, data); nil != err {
		logging.LogErrorf("write attribute view blocks failed: %s", err)
		return
	}
}

func UpsertBlockRel(avID, blockID string) {
	attributeViewBlocksLock.Lock()
	defer attributeViewBlocksLock.Unlock()

	avBlocks := map[string][]string{}
	blocks := filepath.Join(util.DataDir, "storage", "av", "blocks.msgpack")
	if !filelock.IsExist(blocks) {
		if err := os.MkdirAll(filepath.Dir(blocks), 0755); nil != err {
			logging.LogErrorf("create attribute view dir failed: %s", err)
			return
		}
	} else {
		data, err := filelock.ReadFile(blocks)
		if nil != err {
			logging.LogErrorf("read attribute view blocks failed: %s", err)
			return
		}

		if err = msgpack.Unmarshal(data, &avBlocks); nil != err {
			logging.LogErrorf("unmarshal attribute view blocks failed: %s", err)
			return
		}
	}

	blockIDs := avBlocks[avID]
	blockIDs = append(blockIDs, blockID)
	blockIDs = gulu.Str.RemoveDuplicatedElem(blockIDs)
	avBlocks[avID] = blockIDs

	data, err := msgpack.Marshal(avBlocks)
	if nil != err {
		logging.LogErrorf("marshal attribute view blocks failed: %s", err)
		return
	}
	if err = filelock.WriteFile(blocks, data); nil != err {
		logging.LogErrorf("write attribute view blocks failed: %s", err)
		return
	}
}
