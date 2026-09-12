package model

import (
	"io"
	"os"
	"path/filepath"
)

// collectOptionalSystemLogs 收集崩溃诊断副本和 Windows 安装日志，缺失时不影响导出。
func collectOptionalSystemLogs(crashDir, systemTempDir, exportFolder string, windows bool) {
	for _, name := range []string{"app.crash.log", "app.crash.json"} {
		source := filepath.Join(crashDir, name)
		if _, err := os.Stat(source); os.IsNotExist(err) {
			source = filepath.Join(crashDir, "crash-history", name)
		}
		copyOptionalSystemLog(source, filepath.Join(exportFolder, name), 0)
	}
	if windows {
		copyOptionalSystemLog(filepath.Join(systemTempDir, "SiYuan-install.log"),
			filepath.Join(exportFolder, "SiYuan-install.log"), 1024*1024)
	}
}

// copyOptionalSystemLog 尽力复制可选日志，限制大小时只保留文件末尾，失败时删除不完整的副本。
func copyOptionalSystemLog(source, target string, maxBytes int64) {
	input, err := os.Open(source)
	if err != nil {
		return
	}
	defer input.Close()
	info, err := input.Stat()
	if err != nil || !info.Mode().IsRegular() {
		return
	}
	size := info.Size()
	if maxBytes > 0 && size > maxBytes {
		if _, err = input.Seek(size-maxBytes, io.SeekStart); err != nil {
			return
		}
		size = maxBytes
	}
	output, err := os.Create(target)
	if err != nil {
		return
	}
	_, copyErr := io.CopyN(output, input, size)
	closeErr := output.Close()
	if copyErr != nil || closeErr != nil {
		os.Remove(target)
	}
}
