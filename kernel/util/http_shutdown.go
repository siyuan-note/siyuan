// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"context"
	"errors"
	"net"
	"net/http"
	"sync"

	"github.com/siyuan-note/logging"
)

// ShutdownHTTPServers 并行停止 HTTP 和 HTTPS 服务，等待活跃响应完成，超时后关闭剩余连接。
func ShutdownHTTPServers(ctx context.Context, servers ...*http.Server) {
	var pending sync.WaitGroup
	for _, server := range servers {
		if server == nil {
			continue
		}
		pending.Add(1)
		go func(server *http.Server) {
			defer pending.Done()
			// cmux 的 HTTP/HTTPS listener 共用底层监听器，重复关闭会返回 net.ErrClosed。
			// Shutdown 返回该错误前已等待活跃响应完成，无需再强制关闭。
			if err := server.Shutdown(ctx); err != nil && !errors.Is(err, net.ErrClosed) {
				logging.LogWarnf("graceful HTTP server shutdown failed: %s", err)
				_ = server.Close()
			}
		}(server)
	}
	pending.Wait()
}
