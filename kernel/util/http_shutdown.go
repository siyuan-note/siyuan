package util

import (
	"context"
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
			if err := server.Shutdown(ctx); err != nil {
				logging.LogWarnf("graceful HTTP server shutdown failed: %s", err)
				_ = server.Close()
			}
		}(server)
	}
	pending.Wait()
}
