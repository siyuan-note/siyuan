// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build ios || android

package util

func GetOSPlatform() (plat string) {
	if ContainerIOS == Container {
		return "iOS " + MobileOSVer
	}
	if ContainerAndroid == Container {
		return "Android " + MobileOSVer
	}
	if ContainerHarmony == Container {
		return "HarmonyOS " + MobileOSVer
	}
	return "Unknown " + MobileOSVer
}
