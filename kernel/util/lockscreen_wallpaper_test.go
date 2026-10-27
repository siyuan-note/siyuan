// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"hash/crc32"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"os"
	"path/filepath"
	"testing"
)

func wallpaperPNG(t *testing.T, value uint8) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, 8, 4))
	img.Set(0, 0, color.NRGBA{R: value, A: 255})
	var data bytes.Buffer
	if err := png.Encode(&data, img); err != nil {
		t.Fatal(err)
	}
	return data.Bytes()
}

func TestLockScreenWallpaperLifecycle(t *testing.T) {
	dir := t.TempDir()
	if err := RemoveLockScreenWallpaper(dir); err != nil {
		t.Fatal(err)
	}
	var last []byte
	for _, value := range []uint8{10, 220} {
		data, err := PrepareLockScreenWallpaper(bytes.NewReader(wallpaperPNG(t, value)))
		if err != nil {
			t.Fatal(err)
		}
		decoded, err := jpeg.Decode(bytes.NewReader(data))
		if err != nil || decoded.Bounds() != image.Rect(0, 0, 8, 4) {
			t.Fatalf("JPEG output: %v", err)
		}
		// 透明像素应落在白底，原始元数据和附加内容不会进入副本。
		r, g, b, _ := decoded.At(7, 3).RGBA()
		if r < 60000 || g < 60000 || b < 60000 {
			t.Fatal("transparent background was not flattened")
		}
		if err = SaveLockScreenWallpaper(dir, data); err != nil {
			t.Fatal(err)
		}
		last, err = ReadLockScreenWallpaper(dir)
		if err != nil || !bytes.Equal(data, last) {
			t.Fatalf("saved wallpaper differs: %v", err)
		}
		entries, err := os.ReadDir(filepath.Join(dir, "lockscreen"))
		if err != nil || len(entries) != 1 || entries[0].Name() != lockScreenWallpaperFile {
			t.Fatalf("single wallpaper was not retained: %v %v", entries, err)
		}
	}
	if _, err := PrepareLockScreenWallpaper(bytes.NewBufferString("<svg onload='alert(1)'/>")); err == nil {
		t.Fatal("SVG accepted")
	}
	after, err := ReadLockScreenWallpaper(dir)
	if err != nil || !bytes.Equal(last, after) {
		t.Fatal("rejected image changed existing wallpaper")
	}
	for range 2 {
		if err := RemoveLockScreenWallpaper(dir); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := ReadLockScreenWallpaper(dir); !os.IsNotExist(err) {
		t.Fatalf("removed wallpaper is readable: %v", err)
	}
}

func TestLockScreenWallpaperValidation(t *testing.T) {
	webp, err := base64.StdEncoding.DecodeString("UklGRjgAAABXRUJQVlA4ICwAAADwAQCdASoCAAIAAUAmJaACdLoB+AAF9AAA/vFNr/zNExzH7V//hV8bkLCgAA==")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = PrepareLockScreenWallpaper(bytes.NewReader(webp)); err != nil {
		t.Fatalf("WebP input rejected: %v", err)
	}
	oversized := wallpaperPNG(t, 100)
	binary.BigEndian.PutUint32(oversized[16:20], 100_000)
	binary.BigEndian.PutUint32(oversized[20:24], 100_000)
	binary.BigEndian.PutUint32(oversized[29:33], crc32.ChecksumIEEE(oversized[12:29]))
	for name, data := range map[string][]byte{
		"empty":      nil,
		"html":       []byte("<!doctype html><h1>private</h1>"),
		"truncated":  wallpaperPNG(t, 10)[:35],
		"dimensions": oversized,
		"bytes":      make([]byte, LockScreenWallpaperMaxBytes+1),
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := PrepareLockScreenWallpaper(bytes.NewReader(data)); err == nil {
				t.Fatal("invalid image accepted")
			}
		})
	}
	jpegData, err := PrepareLockScreenWallpaper(bytes.NewReader(wallpaperPNG(t, 100)))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = PrepareLockScreenWallpaper(bytes.NewReader(jpegData)); err != nil {
		t.Fatalf("JPEG input rejected: %v", err)
	}
	dir := t.TempDir()
	if err = SaveLockScreenWallpaper(dir, []byte("not an image")); err != nil {
		t.Fatal(err)
	}
	if _, err = ReadLockScreenWallpaper(dir); err == nil {
		t.Fatal("corrupt stored image accepted")
	}
}

func TestLockScreenWallpaperOrientationAndMetadata(t *testing.T) {
	data, err := PrepareLockScreenWallpaper(bytes.NewReader(wallpaperPNG(t, 100)))
	if err != nil {
		t.Fatal(err)
	}
	// JPEG APP1 中写入 EXIF 方向 6，表示顺时针旋转 90 度。
	exif := []byte{'E', 'x', 'i', 'f', 0, 0, 'I', 'I', 42, 0, 8, 0, 0, 0,
		1, 0, 0x12, 1, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0}
	var original bytes.Buffer
	original.Write(data[:2])
	original.Write([]byte{0xff, 0xe1, 0, byte(len(exif) + 2)})
	original.Write(exif)
	original.Write(data[2:])
	normalized, err := PrepareLockScreenWallpaper(bytes.NewReader(original.Bytes()))
	if err != nil {
		t.Fatal(err)
	}
	cfg, err := jpeg.DecodeConfig(bytes.NewReader(normalized))
	if err != nil || cfg.Width != 4 || cfg.Height != 8 || bytes.Contains(normalized, []byte("Exif")) {
		t.Fatalf("orientation or metadata was not normalized: %+v %v", cfg, err)
	}
}

func TestLockScreenWallpaperSymlinks(t *testing.T) {
	dir, outside := t.TempDir(), t.TempDir()
	data, err := PrepareLockScreenWallpaper(bytes.NewReader(wallpaperPNG(t, 100)))
	if err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(outside, "private.jpg")
	if err = os.WriteFile(target, data, 0600); err != nil {
		t.Fatal(err)
	}
	if err = os.Mkdir(filepath.Join(dir, "lockscreen"), 0700); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(dir, "lockscreen", lockScreenWallpaperFile)
	if err = os.Symlink(target, link); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if _, err = ReadLockScreenWallpaper(dir); err == nil {
		t.Fatal("wallpaper followed file symlink")
	}
	if err = RemoveLockScreenWallpaper(dir); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(target); err != nil {
		t.Fatal("removing wallpaper changed symlink target")
	}
	if err = os.Remove(filepath.Join(dir, "lockscreen")); err != nil {
		t.Fatal(err)
	}
	if err = os.Symlink(outside, filepath.Join(dir, "lockscreen")); err != nil {
		t.Fatal(err)
	}
	if _, err = ReadLockScreenWallpaper(dir); err == nil {
		t.Fatal("wallpaper followed directory symlink")
	}
	if err = SaveLockScreenWallpaper(dir, data); err == nil {
		t.Fatal("wallpaper wrote through directory symlink")
	}
}
