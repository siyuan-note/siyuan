// 包 elevator 执行 Windows 提权工具，并等待其返回最终结果。
package elevator

import (
	"errors"
	"fmt"
	"runtime"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	seeMaskNoCloseProcess = 0x00000040
	seeMaskNoAsync        = 0x00000100
	seeMaskFlagNoUI       = 0x00000400
	coInitApartment       = 0x2
	coInitDisableOLE1DDE  = 0x4
)

var shellExecuteEx = windows.NewLazySystemDLL("shell32.dll").NewProc("ShellExecuteExW")

// shellExecuteInfo 按 SHELLEXECUTEINFOW 的字段顺序和平台对齐规则保存原生调用参数。
type shellExecuteInfo struct {
	size       uint32
	mask       uint32
	window     windows.Handle
	verb       *uint16
	file       *uint16
	parameters *uint16
	directory  *uint16
	show       int32
	instance   windows.Handle
	idList     unsafe.Pointer
	class      *uint16
	classKey   windows.Handle
	hotKey     uint32
	icon       windows.Handle
	process    windows.Handle
}

func Run(executable, workingDir, arguments string) error {
	return run(executable, workingDir, arguments, launch)
}

func run(executable, workingDir, arguments string, start func(*shellExecuteInfo) error) error {
	info := shellExecuteInfo{
		mask: seeMaskNoCloseProcess | seeMaskNoAsync | seeMaskFlagNoUI,
		show: windows.SW_HIDE,
	}
	info.size = uint32(unsafe.Sizeof(info))
	var err error
	if info.verb, err = windows.UTF16PtrFromString("runas"); err != nil {
		return err
	}
	if info.file, err = windows.UTF16PtrFromString(executable); err != nil {
		return fmt.Errorf("invalid elevated helper path: %w", err)
	}
	if info.directory, err = windows.UTF16PtrFromString(workingDir); err != nil {
		return fmt.Errorf("invalid elevated helper working directory: %w", err)
	}
	// 参数已按 Windows 命令行语法转义，直接交给提权工具解析，不经过脚本解释器。
	if info.parameters, err = windows.UTF16PtrFromString(arguments); err != nil {
		return fmt.Errorf("invalid elevated helper arguments: %w", err)
	}
	if err = start(&info); err != nil {
		return fmt.Errorf("launch elevated helper: %w", err)
	}
	if info.process == 0 {
		return errors.New("elevated helper process handle unavailable")
	}
	return waitForProcess(info.process, windows.WaitForSingleObject, windows.GetExitCodeProcess)
}

func waitForProcess(process windows.Handle, wait func(windows.Handle, uint32) (uint32, error), getExitCode func(windows.Handle, *uint32) error) error {
	defer windows.CloseHandle(process)

	// 提权调用完成并释放自身的 COM 引用后，等待工具返回最终结果。
	state, err := wait(process, windows.INFINITE)
	if err != nil {
		return fmt.Errorf("wait for elevated helper: %w", err)
	}
	if state != windows.WAIT_OBJECT_0 {
		return fmt.Errorf("unexpected elevated helper wait result: %d", state)
	}
	var exitCode uint32
	if err = getExitCode(process, &exitCode); err != nil {
		return fmt.Errorf("get elevated helper exit code: %w", err)
	}
	if exitCode != 0 {
		return fmt.Errorf("elevated helper failed with exit code %d", exitCode)
	}
	return nil
}

func launch(info *shellExecuteInfo) error {
	// COM 初始化、提权调用和反初始化必须在同一系统线程完成。
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	err := windows.CoInitializeEx(0, coInitApartment|coInitDisableOLE1DDE)
	switch {
	case err == nil, errors.Is(err, syscall.Errno(windows.S_FALSE)):
		defer windows.CoUninitialize()
	case errors.Is(err, syscall.Errno(windows.RPC_E_CHANGED_MODE)):
		// 已初始化为其他单元模型时沿用现有 COM 状态，不释放调用方持有的引用。
	default:
		return fmt.Errorf("initialize COM for elevated helper: %w", err)
	}
	result, _, callErr := shellExecuteEx.Call(uintptr(unsafe.Pointer(info)))
	runtime.KeepAlive(info)
	if result == 0 {
		if callErr == syscall.Errno(0) {
			return errors.New("ShellExecuteExW failed without an error code")
		}
		return fmt.Errorf("ShellExecuteExW: %w", callErr)
	}
	return nil
}
