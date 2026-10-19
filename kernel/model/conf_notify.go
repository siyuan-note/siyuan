package model

import (
	"sync"
	"sync/atomic"

	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var ConfSettingRevision atomic.Uint64
var confNamespaceRevisions sync.Map

func ConfNamespaceRevision(namespace string) uint64 {
	value, ok := confNamespaceRevisions.Load(namespace)
	if !ok {
		return 0
	}
	return value.(*atomic.Uint64).Load()
}

// NotifyConfChanged 统一发布配置提交通知，不在事件中携带配置或凭据。
// 客户端收到通知后按命名空间读取配置段，未知命名空间会让这次读取失败并向用户报错，
// 因此这里只记录日志而不广播。写入独立存储的端点不应走到这里。
func NotifyConfChanged(namespace string) {
	if !confNamespaceReadable(namespace) {
		logging.LogErrorf("skip setting change notification for unknown namespace [%s]", namespace)
		return
	}
	revision := ConfSettingRevision.Add(1)
	value, _ := confNamespaceRevisions.LoadOrStore(namespace, &atomic.Uint64{})
	value.(*atomic.Uint64).Store(revision)
	util.BroadcastByType("main", "settingChanged", 0, "", struct {
		Namespace string `json:"namespace"`
		Revision  uint64 `json:"revision"`
	}{namespace, revision})
}

// confNamespaceReadable 报告命名空间能否被读取配置段的接口解析。
// 这里只查注册表，不构造配置段，避免在配置锁之外触碰段容器。
func confNamespaceReadable(namespace string) bool {
	if "*" == namespace || nil == Conf {
		return true
	}
	_, ok := confSectionSpecFactories[namespace]
	return ok
}
