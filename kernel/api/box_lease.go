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

package api

import (
	"errors"
	"sort"

	"github.com/88250/lute/ast"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

const requestBoxLeasesKey = "siyuan-request-box-leases"

func boxLeaseMiddleware(c *gin.Context) {
	defer releaseRequestBoxLeases(c)
	c.Next()
}

func holdEncryptedBoxRequest(c *gin.Context, boxID string) error {
	if boxID == "" || !model.IsEncryptedBox(boxID) {
		return nil
	}
	leases := requestBoxLeases(c)
	for _, heldBoxID := range leases {
		if heldBoxID == boxID {
			return nil
		}
	}

	if err := model.AcquireEncryptedBoxOperation(boxID); err != nil {
		return errors.New("encrypted notebook is locked, please unlock it first")
	}
	leases = append(leases, boxID)
	c.Set(requestBoxLeasesKey, leases)
	return nil
}

// holdEncryptedBlockRequests 按块的实际归属取得响应租约，覆盖省略笔记本参数的通用和批量读取。
func holdEncryptedBlockRequests(c *gin.Context, boxID string, ids []string, allowMissing bool) error {
	if boxID != "" {
		return holdEncryptedBoxRequest(c, boxID)
	}
	boxIDSet := map[string]struct{}{}
	for _, id := range ids {
		if !ast.IsNodeIDPattern(id) {
			continue
		}
		block := treenode.GetBlockTree(id)
		if block == nil {
			if allowMissing {
				continue
			}
			// 查不到的块直接拒绝，防止随后解锁的笔记本在第二次查找时被无租约访问。
			return errors.New("block not found or its encrypted notebook is locked")
		}
		if model.IsEncryptedBox(block.BoxID) {
			boxIDSet[block.BoxID] = struct{}{}
		}
	}
	boxIDs := make([]string, 0, len(boxIDSet))
	for id := range boxIDSet {
		boxIDs = append(boxIDs, id)
	}
	sort.Strings(boxIDs)
	for _, id := range boxIDs {
		if err := holdEncryptedBoxRequest(c, id); err != nil {
			return err
		}
	}
	return nil
}

func requestBoxLeases(c *gin.Context) []string {
	value, ok := c.Get(requestBoxLeasesKey)
	if !ok {
		return nil
	}
	leases, _ := value.([]string)
	return leases
}

func releaseEncryptedBoxRequest(c *gin.Context, boxID string) {
	leases := requestBoxLeases(c)
	for i := len(leases) - 1; i >= 0; i-- {
		if leases[i] != boxID {
			continue
		}
		leases = append(leases[:i], leases[i+1:]...)
		c.Set(requestBoxLeasesKey, leases)
		model.ReleaseEncryptedBoxOperation(boxID)
		return
	}
}

func releaseRequestBoxLeases(c *gin.Context) {
	leases := requestBoxLeases(c)
	for i := len(leases) - 1; i >= 0; i-- {
		model.ReleaseEncryptedBoxOperation(leases[i])
	}
	c.Set(requestBoxLeasesKey, []string{})
}
