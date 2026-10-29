// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"bytes"
	"errors"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	_ "image/png"
	"io"
	"os"
	"sync"

	"github.com/88250/gulu"
	"github.com/disintegration/imaging"
	_ "golang.org/x/image/webp"
)

const LockScreenWallpaperMaxBytes = 10 << 20
const lockScreenWallpaperMaxPixels = 16_000_000
const lockScreenWallpaperFile = "wallpaper.jpg"

var ErrInvalidLockScreenWallpaper = errors.New("invalid lock screen wallpaper")
var lockScreenWallpaperMu sync.Mutex

// PrepareLockScreenWallpaper 校验实际图片格式和解码尺寸，并移除元数据与透明背景。
func PrepareLockScreenWallpaper(reader io.Reader) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(reader, LockScreenWallpaperMaxBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) > LockScreenWallpaperMaxBytes {
		return nil, ErrInvalidLockScreenWallpaper
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || (format != "jpeg" && format != "png" && format != "webp") ||
		cfg.Width <= 0 || cfg.Height <= 0 || cfg.Width > lockScreenWallpaperMaxPixels/cfg.Height {
		return nil, ErrInvalidLockScreenWallpaper
	}
	img, err := imaging.Decode(bytes.NewReader(data), imaging.AutoOrientation(true))
	if err != nil {
		return nil, ErrInvalidLockScreenWallpaper
	}
	background := image.NewRGBA(img.Bounds())
	draw.Draw(background, background.Bounds(), image.NewUniform(color.White), image.Point{}, draw.Src)
	draw.Draw(background, background.Bounds(), img, img.Bounds().Min, draw.Over)
	var output bytes.Buffer
	if err = jpeg.Encode(&output, background, &jpeg.Options{Quality: 85}); err != nil {
		return nil, err
	}
	if output.Len() > LockScreenWallpaperMaxBytes {
		return nil, ErrInvalidLockScreenWallpaper
	}
	return output.Bytes(), nil
}

// openLockScreenWallpaperRoot 仅访问配置目录下的专用目录，不跟随目录符号链接。
func openLockScreenWallpaperRoot(confDir string, create bool) (*os.Root, error) {
	root, err := os.OpenRoot(confDir)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	if create {
		if err = root.Mkdir("lockscreen", 0700); err != nil && !os.IsExist(err) {
			return nil, err
		}
	}
	info, err := root.Lstat("lockscreen")
	if err != nil {
		return nil, err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return nil, ErrInvalidLockScreenWallpaper
	}
	return root.OpenRoot("lockscreen")
}

// SaveLockScreenWallpaper 原子替换唯一的壁纸，失败时保留原文件。
func SaveLockScreenWallpaper(confDir string, data []byte) error {
	lockScreenWallpaperMu.Lock()
	defer lockScreenWallpaperMu.Unlock()
	root, err := openLockScreenWallpaperRoot(confDir, true)
	if err != nil {
		return err
	}
	defer root.Close()
	name := ".wallpaper-" + gulu.Rand.String(12)
	file, err := root.OpenFile(name, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer root.Remove(name)
	_, err = file.Write(data)
	if err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return root.Rename(name, lockScreenWallpaperFile)
}

// ReadLockScreenWallpaper 不接受客户端路径，并拒绝符号链接、非图片及超限文件。
func ReadLockScreenWallpaper(confDir string) ([]byte, error) {
	lockScreenWallpaperMu.Lock()
	defer lockScreenWallpaperMu.Unlock()
	root, err := openLockScreenWallpaperRoot(confDir, false)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	info, err := root.Lstat(lockScreenWallpaperFile)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() > LockScreenWallpaperMaxBytes {
		return nil, ErrInvalidLockScreenWallpaper
	}
	file, err := root.Open(lockScreenWallpaperFile)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, LockScreenWallpaperMaxBytes+1))
	if err != nil {
		return nil, err
	}
	cfg, err := jpeg.DecodeConfig(bytes.NewReader(data))
	if err != nil || len(data) > LockScreenWallpaperMaxBytes || cfg.Width <= 0 || cfg.Height <= 0 ||
		cfg.Width > lockScreenWallpaperMaxPixels/cfg.Height {
		return nil, ErrInvalidLockScreenWallpaper
	}
	return data, nil
}

// RemoveLockScreenWallpaper 仅删除专用壁纸，重复恢复默认也能成功。
func RemoveLockScreenWallpaper(confDir string) error {
	lockScreenWallpaperMu.Lock()
	defer lockScreenWallpaperMu.Unlock()
	root, err := openLockScreenWallpaperRoot(confDir, false)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	defer root.Close()
	err = root.Remove(lockScreenWallpaperFile)
	if os.IsNotExist(err) {
		return nil
	}
	return err
}
