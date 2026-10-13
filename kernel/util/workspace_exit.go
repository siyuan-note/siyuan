package util

import (
	"encoding/json"
	"os"
	"path/filepath"
	"time"

	"github.com/88250/gulu"
	"github.com/siyuan-note/logging"
)

const workspaceExitFile = "kernel-exit.json"

// MarkWorkspaceExiting 记录当前退出请求，供桌面宿主在重新启动时等待旧内核结束。
// 该文件只用于提示，工作空间的独占访问仍由文件锁保证。
func MarkWorkspaceExiting() func() {
	marker := filepath.Join(TempDir, workspaceExitFile)
	data, _ := json.Marshal(struct {
		Version   int   `json:"version"`
		PID       int   `json:"pid"`
		StartedAt int64 `json:"startedAt"`
	}{1, os.Getpid(), time.Now().UnixMilli()})
	if err := gulu.File.WriteFileSafer(marker, data, 0600); err != nil {
		logging.LogWarnf("write workspace exit marker failed: %s", err)
	}
	return func() {
		ClearWorkspaceExitMarker()
	}
}

// ClearWorkspaceExitMarker 仅在持有工作空间锁时清理临时状态，避免删除下一次启动的状态。
func ClearWorkspaceExitMarker() {
	if err := os.Remove(filepath.Join(TempDir, workspaceExitFile)); err != nil && !os.IsNotExist(err) {
		logging.LogWarnf("remove workspace exit marker failed: %s", err)
	}
}
