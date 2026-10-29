// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import "slices"

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
	return slices.Contains(roles, role)
}

func IsReadOnlyRole(role Role) bool {
	return IsValidRole(role, []Role{
		RoleReader,
		RoleVisitor,
	})
}

// GetGinContextRole 返回请求角色，无上下文或无角色时按最受限的匿名访问者处理。
func GetGinContextRole(c *gin.Context) Role {
	if nil == c {
		return RoleVisitor
	}
	if role, exists := c.Get(RoleContextKey); exists {
		return role.(Role)
	}

	return RoleVisitor
}

func IsAdminRoleContext(c *gin.Context) bool {
	return GetGinContextRole(c) == RoleAdministrator
}

func IsReadOnlyRoleContext(c *gin.Context) bool {
	return IsReadOnlyRole(GetGinContextRole(c))
}
