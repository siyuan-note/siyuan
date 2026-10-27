// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package plugin

import (
	"sync"

	"github.com/siyuan-note/siyuan/kernel/model"
)

// rpcWriteLease 在 RPC Promise 完成或插件运行时停止后释放，而非随请求等待者退出。
type rpcWriteLease struct {
	release func()
}

func (p *KernelPlugin) acquireRPCWrite() (*rpcWriteLease, error) {
	release, err := model.AcquirePluginRPCWrite()
	if err != nil {
		return nil, err
	}
	lease := &rpcWriteLease{}
	lease.release = sync.OnceFunc(func() {
		release()
		p.rpcWriteLeases.Delete(lease)
	})
	p.rpcWriteLeases.Store(lease, struct{}{})
	return lease, nil
}

func (p *KernelPlugin) releaseRPCWrites() {
	p.rpcWriteLeases.Range(func(key, _ any) bool {
		key.(*rpcWriteLease).release()
		return true
	})
}
