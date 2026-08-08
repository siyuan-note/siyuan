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

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
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
