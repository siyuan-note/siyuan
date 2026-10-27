// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"testing"

	"github.com/gin-gonic/gin"
)

func TestAPIContractDeprecatedRoutesRemoved(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	ServeAPI(engine)
	paths := map[string]bool{}
	for _, route := range engine.Routes() {
		paths[route.Path] = true
	}
	for _, path := range []string{"/api/attr/resetBlockAttrs", "/api/av/searchAttributeViewNonRelationKey", "/api/storage/setLocalStorage", "/api/system/reloadUI"} {
		if paths[path] {
			t.Fatalf("deprecated route is still registered: %s", path)
		}
	}
	for _, path := range []string{"/api/storage/setLocalStorageVal", "/api/ui/reloadUI"} {
		if !paths[path] {
			t.Fatalf("active replacement route is missing: %s", path)
		}
	}
}
