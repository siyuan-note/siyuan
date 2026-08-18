// SiYuan - From thought to insight, with agents
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

//go:build darwin && !ios

package util

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Foundation
#include <stdlib.h>
#import <Foundation/Foundation.h>

// siyuanIsUbiquitousItem 通过系统文件资源属性判断路径是否位于 iCloud 存储中。
// 参考 https://developer.apple.com/documentation/foundation/urlresourcevalues/isubiquitousitem
static int siyuanIsUbiquitousItem(const char *path) {
	@autoreleasepool {
		NSString *filePath = [NSString stringWithUTF8String:path];
		if (!filePath) return -2;

		NSURL *url = [NSURL fileURLWithPath:filePath];
		NSNumber *value = nil;
		NSError *error = nil;
		if (![url getResourceValue:&value forKey:NSURLIsUbiquitousItemKey error:&error]) return -1;
		return [value boolValue] ? 1 : 0;
	}
}
*/
import "C"

import (
	"errors"
	"unsafe"
)

func isUbiquitousItem(path string) (bool, error) {
	cPath := C.CString(path)
	defer C.free(unsafe.Pointer(cPath))

	switch C.siyuanIsUbiquitousItem(cPath) {
	case 1:
		return true, nil
	case 0:
		return false, nil
	case -2:
		return false, errors.New("invalid UTF-8 path")
	default:
		return false, errors.New("failed to read iCloud file resource status")
	}
}
