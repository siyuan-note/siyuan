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
	"context"
	"errors"
	"slices"
	"sort"

	"github.com/88250/lute/ast"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

const requestBoxLeasesKey = "siyuan-request-box-leases"
const requestBoxOperationScopeKey = "siyuan-request-box-operation-scope"

func boxLeaseMiddleware(c *gin.Context) {
	defer releaseRequestBoxLeases(c)
	c.Next()
}

// encryptedBoxRequestScope 将模型层取得的单个租约保留到响应写入完成，避免同一请求重复计数。
func encryptedBoxRequestScope(c *gin.Context) context.Context {
	if _, exists := c.Get(requestBoxOperationScopeKey); !exists {
		ctx, release := model.WithEncryptedBoxOperationScope(c.Request.Context())
		c.Request = c.Request.WithContext(ctx)
		c.Set(requestBoxOperationScopeKey, release)
	}
	return c.Request.Context()
}

func holdEncryptedBoxRequest(c *gin.Context, boxID string) error {
	if boxID == "" || !model.IsEncryptedBox(boxID) {
		return nil
	}
	leases := requestBoxLeases(c)
	if slices.Contains(leases, boxID) {
		return nil
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
			if len(model.ListAllEncryptedBoxIDs()) == 0 {
				return errors.New("block not found")
			}
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
	for i, lease := range slices.Backward(leases) {
		if lease != boxID {
			continue
		}
		leases = append(leases[:i], leases[i+1:]...)
		c.Set(requestBoxLeasesKey, leases)
		model.ReleaseEncryptedBoxOperation(boxID)
		return
	}
}

func releaseRequestBoxLeases(c *gin.Context) {
	if value, exists := c.Get(requestBoxOperationScopeKey); exists {
		if release, ok := value.(func()); ok {
			release()
			c.Set(requestBoxOperationScopeKey, nil)
		}
	}
	leases := requestBoxLeases(c)
	for _, lease := range slices.Backward(leases) {
		model.ReleaseEncryptedBoxOperation(lease)
	}
	c.Set(requestBoxLeasesKey, []string{})
}
