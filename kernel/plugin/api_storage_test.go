// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package plugin

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/dop251/goja"
	"github.com/siyuan-note/filelock"
)

func TestStoragePutDrainsBeforeRuntimeClose(t *testing.T) {
	p := newRPCCancellationTestPlugin(t)
	p.storageDir = t.TempDir()
	path := filepath.Join(p.storageDir, "state.json")
	filelock.Lock(path)
	locked := true
	defer func() {
		if locked {
			filelock.Unlock(path)
		}
	}()
	rpcCancellationTestRun(t, p, func(rt *goja.Runtime) (any, error) {
		siyuan := rt.NewObject()
		if err := injectStorage(p, rt, siyuan); err != nil {
			return nil, err
		}
		if err := rt.Set("siyuan", siyuan); err != nil {
			return nil, err
		}
		_, err := rt.RunString(`siyuan.storage.put("state.json", "old").catch(() => {});`)
		return nil, err
	})
	// The put executor is ahead of this barrier and registers I/O before launch.
	rpcCancellationTestRun(t, p, func(*goja.Runtime) (any, error) { return nil, nil })
	closed := make(chan error, 1)
	go func() { closed <- p.close() }()
	select {
	case err := <-closed:
		t.Fatalf("runtime close returned while storage.put was still blocked: %v", err)
	case <-time.After(100 * time.Millisecond):
	}
	filelock.Unlock(path)
	locked = false
	select {
	case err := <-closed:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("runtime close did not drain storage.put")
	}
	if data, err := os.ReadFile(path); err != nil || string(data) != "old" {
		t.Fatalf("admitted mutation was not completed before close: %q, %v", data, err)
	}
	if done, err := p.beginStorageWrite(); err == nil {
		done()
		t.Fatal("closed plugin admitted a new storage mutation")
	}
}

func TestStorageRemoveAndWriteFailureReleaseAdmission(t *testing.T) {
	p, r := newDataObjectTestPlugin(t)
	p.storageDir = t.TempDir()
	r.withRuntime(func(rt *goja.Runtime) {
		siyuan := rt.NewObject()
		if err := injectStorage(p, rt, siyuan); err != nil {
			t.Fatal(err)
		}
		if err := rt.Set("siyuan", siyuan); err != nil {
			t.Fatal(err)
		}
	})
	if got := r.await(`(async () => {
		await siyuan.storage.put("state", "value");
		try { await siyuan.storage.put("state/blocked", "fail"); } catch (_) {}
		await siyuan.storage.remove("state");
		return "done";
	})()`); got != "done" {
		t.Fatal(got)
	}
	if err := p.close(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(p.storageDir, "state")); !os.IsNotExist(err) {
		t.Fatalf("remove did not finish: %v", err)
	}
}

func TestStorageGetResolvesFileContents(t *testing.T) {
	p, r := newDataObjectTestPlugin(t)
	p.storageDir = t.TempDir()
	if err := os.WriteFile(filepath.Join(p.storageDir, "icon.png"), []byte("png"), 0644); err != nil {
		t.Fatal(err)
	}

	var err error
	r.withRuntime(func(rt *goja.Runtime) {
		siyuan := rt.NewObject()
		if err = injectStorage(p, rt, siyuan); err == nil {
			err = rt.Set("siyuan", siyuan)
		}
	})
	if err != nil {
		t.Fatalf("inject storage: %v", err)
	}

	// 存储文件没有媒体类型：即使扩展名对应某种类型，blob() 的 type 也为空串。
	got := r.await(`(async () => {
		const data = await siyuan.storage.get("icon.png");
		const blob = await data.blob();
		return JSON.stringify([await data.text(), Array.from(await data.bytes()), blob.type, await blob.text()]);
	})()`)
	if want := `["png",[112,110,103],"","png"]`; got != want {
		t.Fatalf("storage data = %s, want %s", got, want)
	}
}
