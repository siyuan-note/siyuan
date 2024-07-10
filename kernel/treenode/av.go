// SiYuan - Refactor your thinking
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

package treenode

import (
	"path/filepath"

	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/util"
	"github.com/vmihailenco/msgpack/v5"
)

func GetMirrorAttrViewBlockIDs(avID string) (ret []string) {
	av.AttributeViewBlocksLock.Lock()
	defer av.AttributeViewBlocksLock.Unlock()

	ret = []string{}
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
	bts := GetBlockTrees(blockIDs)
	for blockID := range bts {
		ret = append(ret, blockID)
	}
	return
}

type AvBlock struct {
	AvID     string
	BlockIDs []string
}

func BatchGetMirrorAttrViewBlocks(avIDs []string) (ret []*AvBlock) {
	av.AttributeViewBlocksLock.Lock()
	defer av.AttributeViewBlocksLock.Unlock()

	ret = []*AvBlock{}

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

	for _, avID := range avIDs {
		var blockIDs []string
		bts := GetBlockTrees(avBlocks[avID])
		for blockID := range bts {
			blockIDs = append(blockIDs, blockID)
		}
		avBlock := &AvBlock{
			AvID:     avID,
			BlockIDs: blockIDs,
		}
		ret = append(ret, avBlock)
	}
	return
}
