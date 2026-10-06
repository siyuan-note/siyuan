package util

import (
	"context"
	"sync"
)

var workspaceDrive = workspaceDriveTypeCache{done: make(chan struct{})}

type workspaceDriveTypeCache struct {
	once  sync.Once
	done  chan struct{}
	value string
}

// get 复用内核生命周期内的检测结果，调用者取消等待不会中断或重复启动系统查询。
func (cache *workspaceDriveTypeCache) get(ctx context.Context, detect func() string) string {
	cache.once.Do(func() {
		go func() {
			cache.value = detect()
			close(cache.done)
		}()
	})
	select {
	case <-cache.done:
		return cache.value
	case <-ctx.Done():
		return ""
	}
}
