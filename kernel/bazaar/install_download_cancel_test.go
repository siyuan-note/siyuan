package bazaar

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestOnlineInstallCancellationDuringDownload(t *testing.T) {
	for _, knownLength := range []bool{true, false} {
		t.Run(fmt.Sprint(knownLength), func(t *testing.T) {
			_, target := useInstallRevisionFixture(t)
			oldServer := bazaarDownloadFileServer
			t.Cleanup(func() { bazaarDownloadFileServer = oldServer })
			started, disconnected := make(chan struct{}), make(chan struct{})
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				if knownLength {
					writer.Header().Set("Content-Length", "1000000")
				}
				_, _ = writer.Write([]byte("PK"))
				writer.(http.Flusher).Flush()
				close(started)
				<-request.Context().Done()
				close(disconnected)
			}))
			defer server.Close()
			bazaarDownloadFileServer = server.URL
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			options := installRevisionOptions(target)
			options.Context = ctx
			done := make(chan error, 1)
			go func() {
				_, err := InstallPackageWithOptions("https://github.com/owner/repo", "hash", "", target, "", "plugins", "sample", true, options)
				done <- err
			}()
			select {
			case <-started:
			case <-time.After(5 * time.Second):
				t.Fatal("download did not start")
			}
			cancel()
			select {
			case err := <-done:
				if !errors.Is(err, context.Canceled) {
					t.Fatalf("download cancellation = %v", err)
				}
			case <-time.After(5 * time.Second):
				t.Fatal("canceled download kept waiting")
			}
			select {
			case <-disconnected:
			case <-time.After(5 * time.Second):
				t.Fatal("cancellation did not close the HTTP request")
			}
			if data, err := os.ReadFile(filepath.Join(target, "index.js")); err != nil || string(data) != "old" {
				t.Fatal("canceled download replaced the installed package", err)
			}
		})
	}
}

func TestOnlineDownloadsHaveIndependentCancellation(t *testing.T) {
	oldServer := bazaarDownloadFileServer
	t.Cleanup(func() { bazaarDownloadFileServer = oldServer })
	started, release := make(chan struct{}, 2), make(chan struct{})
	var releaseOnce sync.Once
	releaseDownloads := func() { releaseOnce.Do(func() { close(release) }) }
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		started <- struct{}{}
		select {
		case <-release:
			_, _ = writer.Write([]byte("package"))
		case <-request.Context().Done():
		}
	}))
	defer server.Close()
	defer releaseDownloads()
	bazaarDownloadFileServer = server.URL
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	canceled, completed := make(chan error, 1), make(chan error, 1)
	go func() {
		_, err := downloadBazaarFileContext(ctx, "https://github.com/owner/repo@hash", false)
		canceled <- err
	}()
	go func() {
		data, err := downloadBazaarFileContext(context.Background(), "https://github.com/owner/repo@hash", false)
		if err == nil && string(data) != "package" {
			err = fmt.Errorf("unexpected package: %q", data)
		}
		completed <- err
	}()
	for i := 0; i < 2; i++ {
		select {
		case <-started:
		case <-time.After(5 * time.Second):
			t.Fatal("downloads were unexpectedly shared")
		}
	}
	cancel()
	select {
	case err := <-canceled:
		if !errors.Is(err, context.Canceled) {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("download did not cancel")
	}
	releaseDownloads()
	select {
	case err := <-completed:
		if err != nil {
			t.Fatal("canceling one download affected another", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("independent download did not finish")
	}
}

func TestOnlineInstallCancellationBeforeReplacement(t *testing.T) {
	_, target := useInstallRevisionFixture(t)
	oldServer := bazaarDownloadFileServer
	t.Cleanup(func() { bazaarDownloadFileServer = oldServer })
	data := buildInstallPackageArchive(t, map[string]string{
		"plugin.json": `{"name":"sample","version":"2.0.0"}`,
		"index.js":    "new",
	})
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		_, _ = writer.Write(data)
	}))
	defer server.Close()
	bazaarDownloadFileServer = server.URL
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	options := installRevisionOptions(target)
	options.Context = ctx
	options.BeforeReplace = func() error { cancel(); return nil }
	_, err := InstallPackageWithOptions("https://github.com/owner/repo", "hash", "", target, "", "plugins", "sample", true, options)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("replacement cancellation = %v", err)
	}
	if data, err := os.ReadFile(filepath.Join(target, "index.js")); err != nil || string(data) != "old" {
		t.Fatal("canceled installation replaced the package", err)
	}
	entries, err := os.ReadDir(filepath.Dir(target))
	if err != nil || len(entries) != 1 {
		t.Fatal("canceled installation retained staging files", entries, err)
	}
}
