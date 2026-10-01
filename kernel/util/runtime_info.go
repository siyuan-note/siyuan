package util

import (
	"context"
	"fmt"
	"os"
	"runtime"
	"runtime/debug"
	"strings"
	"time"

	"github.com/shirou/gopsutil/v4/host"
	"github.com/shirou/gopsutil/v4/mem"
	"github.com/shirou/gopsutil/v4/process"
	"github.com/siyuan-note/logging"
)

// RuntimeInfo 采集当前内核的运行信息，使用统一诊断字段，避免包含路径、主机名和账户信息。
func RuntimeInfo(ctx context.Context) string {
	started := time.Now()
	requestID := started.UnixNano()
	stageStarted := started
	logStage := func(stage string) {
		now := time.Now()
		logging.LogInfof("runtime info [request=%d, stage=%s, elapsed=%dms, total=%dms]",
			requestID, stage, now.Sub(stageStarted).Milliseconds(), now.Sub(started).Milliseconds())
		stageStarted = time.Now()
	}
	logging.LogInfof("runtime info [request=%d, stage=start]", requestID)
	defer func() {
		logging.LogInfof("runtime info [request=%d, stage=complete, total=%dms, canceled=%t]",
			requestID, time.Since(started).Milliseconds(), ctx.Err() != nil)
	}()
	var result strings.Builder
	fmt.Fprintf(&result, "SiYuan %s\nKernel: %s %s/%s\n", Ver, runtime.Version(), runtime.GOOS, runtime.GOARCH)
	if info, ok := debug.ReadBuildInfo(); ok {
		for _, setting := range info.Settings {
			switch setting.Key {
			case "vcs.revision":
				fmt.Fprintf(&result, "Source revision: %s\n", setting.Value)
			case "vcs.time":
				fmt.Fprintf(&result, "Source time: %s\n", setting.Value)
			case "vcs.modified":
				fmt.Fprintf(&result, "Source modified: %s\n", setting.Value)
			}
		}
	}
	logStage("build_info")
	platform := MobileOSVer
	if platform == "" {
		name, _, version, err := host.PlatformInformationWithContext(ctx)
		if err == nil {
			platform = strings.TrimSpace(name + " " + version)
		}
	}
	if platform == "" {
		platform = runtime.GOOS
	}
	logStage("platform")
	fmt.Fprintf(&result, "Kernel OS: %s\nContainer: %s\nRuntime mode: %s\nRead only: %t\nDatabase version: %s\nCPU logical cores: %d\n",
		platform, Container, Mode, ReadOnly, DatabaseVer, runtime.NumCPU())
	if memory, err := mem.VirtualMemoryWithContext(ctx); err == nil {
		fmt.Fprintf(&result, "System memory: %.0f MiB total, %.0f MiB available\n", float64(memory.Total)/(1<<20), float64(memory.Available)/(1<<20))
	} else {
		result.WriteString("System memory: unknown\n")
	}
	logStage("system_memory")
	if proc, err := process.NewProcessWithContext(ctx, int32(os.Getpid())); err == nil {
		if memory, err := proc.MemoryInfoWithContext(ctx); err == nil {
			fmt.Fprintf(&result, "Kernel memory (RSS): %.1f MiB\n", float64(memory.RSS)/(1<<20))
		} else {
			result.WriteString("Kernel memory (RSS): unknown\n")
		}
	} else {
		result.WriteString("Kernel memory (RSS): unknown\n")
	}
	logStage("process_memory")
	var memory runtime.MemStats
	runtime.ReadMemStats(&memory)
	fmt.Fprintf(&result, "Kernel Go heap: %.1f MiB in use, %.1f MiB reserved\n", float64(memory.HeapAlloc)/(1<<20), float64(memory.HeapSys)/(1<<20))
	logStage("go_heap")
	driveType := ""
	if !IsMobileContainer() {
		driveType = detectWorkspaceDriveType()
	}
	logStage("workspace_storage")
	if driveType == "" {
		driveType = "unknown"
	}
	fmt.Fprintf(&result, "Workspace storage: %s", driveType)
	return result.String()
}
