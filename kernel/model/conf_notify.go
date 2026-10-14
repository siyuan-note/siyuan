package model

import (
	"sync"
	"sync/atomic"

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
func NotifyConfChanged(namespace string) {
	revision := ConfSettingRevision.Add(1)
	value, _ := confNamespaceRevisions.LoadOrStore(namespace, &atomic.Uint64{})
	value.(*atomic.Uint64).Store(revision)
	util.BroadcastByType("main", "settingChanged", 0, "", struct {
		Namespace string `json:"namespace"`
		Revision  uint64 `json:"revision"`
	}{namespace, revision})
}
