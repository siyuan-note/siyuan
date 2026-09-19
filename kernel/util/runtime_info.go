package util

import (
	"context"
	"fmt"
	"os"
	"runtime"
	"runtime/debug"
	"strings"

	"github.com/shirou/gopsutil/v4/host"
	"github.com/shirou/gopsutil/v4/mem"
	"github.com/shirou/gopsutil/v4/process"
)

// RuntimeInfo 采集当前内核的运行信息，使用统一诊断字段，避免包含路径、主机名和账户信息。
func RuntimeInfo(ctx context.Context) string {
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
	fmt.Fprintf(&result, "Kernel OS: %s\nContainer: %s\nRuntime mode: %s\nRead only: %t\nDatabase version: %s\nCPU logical cores: %d\n",
		platform, Container, Mode, ReadOnly, DatabaseVer, runtime.NumCPU())
	if memory, err := mem.VirtualMemoryWithContext(ctx); err == nil {
		fmt.Fprintf(&result, "System memory: %.0f MiB total, %.0f MiB available\n", float64(memory.Total)/(1<<20), float64(memory.Available)/(1<<20))
	} else {
		result.WriteString("System memory: unknown\n")
	}
	if proc, err := process.NewProcessWithContext(ctx, int32(os.Getpid())); err == nil {
		if memory, err := proc.MemoryInfoWithContext(ctx); err == nil {
			fmt.Fprintf(&result, "Kernel memory (RSS): %.1f MiB\n", float64(memory.RSS)/(1<<20))
		} else {
			result.WriteString("Kernel memory (RSS): unknown\n")
		}
	} else {
		result.WriteString("Kernel memory (RSS): unknown\n")
	}
	var memory runtime.MemStats
	runtime.ReadMemStats(&memory)
	fmt.Fprintf(&result, "Kernel Go heap: %.1f MiB in use, %.1f MiB reserved\n", float64(memory.HeapAlloc)/(1<<20), float64(memory.HeapSys)/(1<<20))
	driveType := ""
	if !IsMobileContainer() {
		driveType = detectWorkspaceDriveType()
	}
	if driveType == "" {
		driveType = "unknown"
	}
	fmt.Fprintf(&result, "Workspace storage: %s", driveType)
	return result.String()
}
