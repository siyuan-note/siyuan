// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package server

import (
	"net/http"

	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
	"golang.org/x/net/webdav"
)

const webdavPrefix = "/webdav/"

func newWebDAVHandler() http.Handler {
	// 自定义 WebDAV 文件系统包装——拒绝加密笔记本的所有访问
	// 加密笔记本的读写必须通过 assets/serve 路由的 box-aware + 解密流程，
	// WebDAV 直接访问原始文件系统会绕过所有这些安全控制
	encBoxAwareFS := &encryptedBoxAwareWebdavFS{inner: webdav.Dir(util.WorkspaceDir)}
	return &webdav.Handler{
		Prefix:     webdavPrefix,
		FileSystem: encBoxAwareFS,
		LockSystem: webdav.NewMemLS(),
		Logger: func(r *http.Request, err error) {
			if nil != err {
				logging.LogErrorf("WebDAV [%s %s]: %s", r.Method, r.URL.String(), err.Error())
			}
			// logging.LogDebugf("WebDAV [%s %s]", r.Method, r.URL.String())
		},
	}
}
