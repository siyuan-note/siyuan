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

package model

import "github.com/gin-gonic/gin"

type Role uint

const (
	RoleContextKey = "role"
)

const (
	RoleAdministrator Role = iota // 管理员
	RoleEditor                    // 编辑者
	RoleReader                    // 读者
	RoleVisitor                   // 匿名访问者
)

func IsValidRole(role Role, roles []Role) bool {
	for _, role_ := range roles {
		if role == role_ {
			return true
		}
	}
	return false
}

func IsReadOnlyRole(role Role) bool {
	return IsValidRole(role, []Role{
		RoleReader,
		RoleVisitor,
	})
}

func GetGinContextRole(c *gin.Context) Role {
	if role, exists := c.Get(RoleContextKey); exists {
		return role.(Role)
	} else {
		return RoleVisitor
	}
}

func IsAdminRoleContext(c *gin.Context) bool {
	return GetGinContextRole(c) == RoleAdministrator
}
