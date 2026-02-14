// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

//go:build windows

// 本文件实现 Windows Shell 剪贴板格式 CF_HDROP，用于在剪贴板中传输一组已有文件的路径，使资源管理器等可识别并粘贴为文件。
//
// 参考文档：
//   - Shell 剪贴板与 CF_HDROP：https://learn.microsoft.com/en-us/windows/win32/shell/clipboard
//   - DROPFILES 结构：https://learn.microsoft.com/en-us/windows/win32/api/shlobj_core/ns-shlobj_core-dropfiles
//   - SetClipboardData（hMem 须为 GMEM_MOVEABLE，且 “memory must be unlocked before the Clipboard is closed”）：
//     https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setclipboarddata
//   - 官方示例 “Copy information to the clipboard”（GlobalUnlock 再 SetClipboardData）：
//     https://learn.microsoft.com/en-us/windows/win32/dataxchg/using-the-clipboard
//
// CF_HDROP 为预定义格式，无需 RegisterClipboardFormat。数据为全局内存对象（hGlobal），
// 其内容为 DROPFILES 结构 + 双 null 结尾的路径字符数组。

package util

import (
	"encoding/binary"
	"errors"
	"runtime"
	"syscall"
	"time"
	"unsafe"

	"github.com/gonutz/w32/v2"
)

const (
	// cfHDROP 为 CF_HDROP 剪贴板格式（预定义值 15），用于传输一组已有文件的位置。
	// 见 Standard Clipboard Formats：https://learn.microsoft.com/en-us/windows/win32/dataxchg/standard-clipboard-formats
	cfHDROP       = 15
	dropfilesSize = 20 // DROPFILES 结构体大小（pFiles 4 + pt 8 + fNC 4 + fWide 4），https://learn.microsoft.com/en-us/windows/win32/api/shlobj_core/ns-shlobj_core-dropfiles
)

// WriteFilePaths 将文件路径列表写入系统剪贴板，使资源管理器中可粘贴为文件。
//
// 按文档要求，CF_HDROP 数据为 STGMEDIUM 的 hGlobal 指向的全局内存，内存内容为 DROPFILES 结构。
// 剪贴板 API 要求在同一线程内完成 OpenClipboard、写入、CloseClipboard，故需 LockOSThread。
// 调用顺序：先准备数据（GlobalAlloc → GlobalLock → 写入 → GlobalUnlock），再 OpenClipboard → EmptyClipboard → SetClipboardData → CloseClipboard。
// 与官方示例 “Copy information to the clipboard” 不同，此处将内存准备提前到 OpenClipboard 之前，以缩短占用剪贴板的时间。
func WriteFilePaths(paths []string) error {
	if len(paths) == 0 {
		return nil
	}
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()

	data, err := buildDropfilesData(paths)
	if err != nil {
		return err
	}
	if len(data) == 0 {
		return nil
	}

	// 全局内存对象；SetClipboardData 文档要求 hMem 须由 GlobalAlloc(GMEM_MOVEABLE) 分配
	// https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setclipboarddata
	size := uint32(len(data))
	hMem := w32.GlobalAlloc(w32.GMEM_MOVEABLE, size)
	if hMem == 0 {
		return syscall.Errno(w32.GetLastError())
	}

	ptr := w32.GlobalLock(hMem)
	if ptr == nil {
		w32.GlobalFree(hMem)
		return syscall.Errno(w32.GetLastError())
	}

	w32.MoveMemory(ptr, unsafe.Pointer(&data[0]), size)
	// 必须在 SetClipboardData 之前 Unlock，否则系统无法正确管理已接管的句柄。
	// 文档："The memory must be unlocked before the Clipboard is closed."
	// https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setclipboarddata
	w32.GlobalUnlock(hMem)

	if err := waitOpenClipboard(); err != nil {
		w32.GlobalFree(hMem)
		return err
	}
	defer w32.CloseClipboard()

	if !w32.EmptyClipboard() {
		w32.GlobalFree(hMem)
		return syscall.Errno(w32.GetLastError())
	}
	if w32.SetClipboardData(cfHDROP, w32.HANDLE(hMem)) == 0 {
		w32.GlobalFree(hMem)
		return syscall.Errno(w32.GetLastError())
	}
	// 成功时系统接管 hMem，应用不得再写或 free；失败时由上面分支 GlobalFree。
	// https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setclipboarddata
	return nil
}

// buildDropfilesData 构建 CF_HDROP 格式的字节切片。
//
// 格式遵循 DROPFILES：pFiles 为偏移，指向双 null 结尾的路径字符数组。
// https://learn.microsoft.com/en-us/windows/win32/api/shlobj_core/ns-shlobj_core-dropfiles
// 数组由若干条“完整路径 + 结尾 NULL”组成，最后再跟一个 NULL 结束整表。
// 例如两文件时为：c:\temp1.txt\0 c:\temp2.txt\0 \0
// 此处使用 Unicode（fWide=1），故路径为 UTF-16，每条路径含结尾 null，最后再 2 字节 null。
func buildDropfilesData(paths []string) ([]byte, error) {
	var totalLen = dropfilesSize
	for _, p := range paths {
		u16, err := syscall.UTF16FromString(p)
		if err != nil {
			return nil, err
		}
		totalLen += len(u16) * 2
	}
	totalLen += 2 // 数组末尾的 null（双 null 结尾中的最后一个）

	buf := make([]byte, totalLen)
	// DROPFILES：pFiles=20（路径数组相对本结构起始的偏移）, pt=0,0, fNC=0, fWide=1（Unicode）
	binary.LittleEndian.PutUint32(buf[0:4], 20)
	// pt.x, pt.y, fNC, fWide
	binary.LittleEndian.PutUint32(buf[16:20], 1)

	offset := dropfilesSize
	for _, p := range paths {
		u16, err := syscall.UTF16FromString(p)
		if err != nil {
			return nil, err
		}
		for _, c := range u16 {
			binary.LittleEndian.PutUint16(buf[offset:offset+2], c)
			offset += 2
		}
	}
	return buf, nil
}

// waitOpenClipboard 在限定时间内重试打开剪贴板。
// 同一时刻仅一进程可持有剪贴板（OpenClipboard 成功）。
// https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-openclipboard
func waitOpenClipboard() error {
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if w32.OpenClipboard(0) {
			return nil
		}
		time.Sleep(time.Millisecond)
	}
	return errors.New("open clipboard timeout")
}
