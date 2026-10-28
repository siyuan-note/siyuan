// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/conf"
)

// installPkgTestSource 是一个可控的下载源，记录请求次数、Range 请求头与连接是否被中断。
type installPkgTestSource struct {
	server      *httptest.Server
	requests    atomic.Int32
	rangeHeader atomic.Value
	closed      chan struct{} // 连接被中断时关闭
	closeOnce   sync.Once
}

func (s *installPkgTestSource) markClosed() {
	s.closeOnce.Do(func() { close(s.closed) })
}

// newInstallPkgTestSource 按 chunk 大小与间隔输出内容，模拟不同带宽的下载源。
func newInstallPkgTestSource(t *testing.T, content []byte, chunk int, interval time.Duration) *installPkgTestSource {
	t.Helper()
	source := &installPkgTestSource{closed: make(chan struct{})}
	source.rangeHeader.Store("")
	source.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		source.requests.Add(1)
		source.rangeHeader.Store(r.Header.Get("Range"))
		w.Header().Set("Content-Length", strconv.Itoa(len(content)))
		for offset := 0; offset < len(content); {
			select {
			case <-r.Context().Done():
				source.markClosed()
				return
			default:
			}
			end := offset + chunk
			if end > len(content) {
				end = len(content)
			}
			if _, err := w.Write(content[offset:end]); nil != err {
				source.markClosed()
				return
			}
			if flusher, ok := w.(http.Flusher); ok {
				flusher.Flush()
			}
			offset = end
			if 0 < interval {
				select {
				case <-r.Context().Done():
					source.markClosed()
					return
				case <-time.After(interval):
				}
			}
		}
	}))
	t.Cleanup(source.server.Close)
	return source
}

func installPkgProbeTestContent() []byte {
	return bytes.Repeat([]byte("SiYuan"), 100*1024) // 约 600 KB
}

func installPkgDownloadMetadata(content []byte) *installPackageMetadata {
	return &installPackageMetadata{
		FormatVersion: installPackageMetadataVersion,
		Version:       "99.0.0", Channel: conf.UpdateChannelStable, FileName: "siyuan-99.0.0-win.exe",
		Checksum: fmt.Sprintf("%x", sha256.Sum256(content)),
	}
}

func assertInstallPkgDownloaded(t *testing.T, dir string, want []byte) {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(dir, "siyuan-99.0.0-win.exe"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(want, data) {
		t.Fatalf("unexpected installed package content: %d bytes", len(data))
	}
}

// 探测阶段必须保留完整的读取块：丢弃越界字节会让安装包缺数据，胜出源续读后校验必然失败。
func TestInstallPkgProbeAppendRetainsWholeChunk(t *testing.T) {
	probe := newInstallPkgProbe(context.Background(), "https://example.invalid/pkg", 5, make(chan *installPkgProbe, 1))
	probe.append([]byte("abc"))
	probe.append([]byte("abcdef"))
	if "abcabcdef" != string(probe.buffer) || 9 != probe.read.Load() {
		t.Fatalf("unexpected probe buffer: %q (%d)", probe.buffer, probe.read.Load())
	}
}

// 探测必须发生在跨工作空间下载锁内：另一工作空间正在下载时不得发起任何探测请求。
func TestDownloadInstallPkgSourcesProbesInsideDownloadLock(t *testing.T) {
	dir := prepareInstallPackageTest(t)
	lock, err := tryInstallPackageDownloadLock(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer lock.Close()

	content := installPkgProbeTestContent()
	metadata := installPkgDownloadMetadata(content)
	first := newInstallPkgTestSource(t, content, 64*1024, 0)
	second := newInstallPkgTestSource(t, content, 64*1024, 0)

	err = downloadInstallPkgSources([]string{first.server.URL, second.server.URL}, metadata)
	if !errors.Is(err, errInstallPackageDownloadBusy) {
		t.Fatalf("concurrent download did not report busy: %v", err)
	}
	if got := first.requests.Load() + second.requests.Load(); 0 != got {
		t.Fatalf("sources were probed while another workspace held the download lock: %d requests", got)
	}
}

// 选举结束后所有探测协程都必须退出，否则下载锁释放后仍会有连接占用带宽。
func TestProbeAndDownloadReleasesAllSourceConnections(t *testing.T) {
	dir := prepareInstallPackageTest(t)
	content := installPkgProbeTestContent()
	metadata := installPkgDownloadMetadata(content)
	first := newInstallPkgTestSource(t, content, 1024, 20*time.Millisecond)
	second := newInstallPkgTestSource(t, content, 1024, 20*time.Millisecond)
	third := newInstallPkgTestSource(t, content, 64*1024, 0)

	urls := []string{first.server.URL, second.server.URL, third.server.URL}
	if err := probeAndDownloadInstallPkgWithin(dir, urls, metadata, 3*time.Second, 128*1024); err != nil {
		t.Fatal(err)
	}
	// 返回即代表协程已全部退出，落选连接的请求上下文应全部结束
	for _, source := range []*installPkgTestSource{first, second} {
		select {
		case <-source.closed:
		case <-time.After(5 * time.Second):
			t.Fatal("losing source connection was still open after the download returned")
		}
	}
	assertInstallPkgDownloaded(t, dir, content)
}

// 探测就是下载：胜出源在同一个连接上继续读完，既不会重新请求，也不会发出 Range。
func TestProbeAndDownloadKeepsFastestSourceConnection(t *testing.T) {
	dir := prepareInstallPackageTest(t)
	content := installPkgProbeTestContent()
	metadata := installPkgDownloadMetadata(content)
	fast := newInstallPkgTestSource(t, content, 64*1024, 0)
	slow := newInstallPkgTestSource(t, content, 1024, 20*time.Millisecond)

	err := probeAndDownloadInstallPkgWithin(dir, []string{slow.server.URL, fast.server.URL}, metadata, 3*time.Second, 128*1024)
	if err != nil {
		t.Fatal(err)
	}
	if got := fast.requests.Load(); 1 != got {
		t.Fatalf("fast source was requested %d times, want 1", got)
	}
	if got := fast.rangeHeader.Load(); "" != got {
		t.Fatalf("fast source was resumed with a range request: %q", got)
	}
	assertInstallPkgDownloaded(t, dir, content)

	select {
	case <-slow.closed:
	case <-time.After(5 * time.Second):
		t.Fatal("losing source connection was not closed")
	}
}

// 窗口到期时按已读字节数选出最快源，慢源只损失窗口内读到的那部分。
func TestProbeAndDownloadElectsByBytesWhenWindowExpires(t *testing.T) {
	dir := prepareInstallPackageTest(t)
	content := installPkgProbeTestContent()
	metadata := installPkgDownloadMetadata(content)
	more := newInstallPkgTestSource(t, content, 8*1024, 10*time.Millisecond)
	less := newInstallPkgTestSource(t, content, 1024, 10*time.Millisecond)

	start := time.Now()
	err := probeAndDownloadInstallPkgWithin(dir, []string{less.server.URL, more.server.URL}, metadata, 300*time.Millisecond, 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	if 1 != more.requests.Load() {
		t.Fatalf("faster source was requested %d times, want 1", more.requests.Load())
	}
	if elapsed := time.Since(start); time.Minute < elapsed {
		t.Fatalf("download took too long: %s", elapsed)
	}
	assertInstallPkgDownloaded(t, dir, content)
}

// 胜出源的内容校验失败时返回错误，由调用方按原顺序重新完整下载。
func TestProbeAndDownloadReportsWinnerChecksumMismatch(t *testing.T) {
	dir := prepareInstallPackageTest(t)
	content := installPkgProbeTestContent()
	metadata := installPkgDownloadMetadata([]byte("another package"))
	fast := newInstallPkgTestSource(t, content, 64*1024, 0)
	slow := newInstallPkgTestSource(t, content, 1024, 20*time.Millisecond)

	err := probeAndDownloadInstallPkgWithin(dir, []string{slow.server.URL, fast.server.URL}, metadata, 3*time.Second, 128*1024)
	if nil == err {
		t.Fatal("checksum mismatch was not reported")
	}
	if _, statErr := os.Stat(filepath.Join(dir, metadata.FileName)); !os.IsNotExist(statErr) {
		t.Fatalf("failed package was published: %v", statErr)
	}
}

// 探测上限落在读取块中间时必须保留整块数据，否则胜出源续读后的文件会缺字节、校验必然失败。
func TestProbeAndDownloadRetainsChunkAcrossProbeLimit(t *testing.T) {
	dir := prepareInstallPackageTest(t)
	content := bytes.Repeat([]byte("0123456789"), 300) // 3000 字节
	metadata := installPkgDownloadMetadata(content)
	// 每块 1000 字节，探测上限 1500 会落在第二块中间
	fast := newInstallPkgTestSource(t, content, 1000, 2*time.Millisecond)
	slow := newInstallPkgTestSource(t, content, 100, 50*time.Millisecond)

	if err := probeAndDownloadInstallPkgWithin(dir, []string{slow.server.URL, fast.server.URL}, metadata, 5*time.Second, 1500); err != nil {
		t.Fatal(err)
	}
	assertInstallPkgDownloaded(t, dir, content)
}

// 全部源都不可用时返回错误，不产生任何安装包。
func TestProbeAndDownloadReportsNoUsableSource(t *testing.T) {
	dir := prepareInstallPackageTest(t)
	metadata := installPkgDownloadMetadata(installPkgProbeTestContent())
	first := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	t.Cleanup(first.Close)
	second := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
	}))
	t.Cleanup(second.Close)

	if err := probeAndDownloadInstallPkgWithin(dir, []string{first.URL, second.URL}, metadata, 2*time.Second, 128*1024); nil == err {
		t.Fatal("unusable sources were reported as success")
	}
}

// 探测阶段已确认每个源都不可用时不再逐个重试，避免重复承担连接超时。
func TestDownloadInstallPkgSourcesSkipsRetryWhenNoSourceUsable(t *testing.T) {
	prepareInstallPackageTest(t)
	metadata := installPkgDownloadMetadata(installPkgProbeTestContent())
	var requests atomic.Int32
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		w.WriteHeader(http.StatusNotFound)
	}))
	t.Cleanup(source.Close)

	if err := downloadInstallPkgSources([]string{source.URL, source.URL}, metadata); !errors.Is(err, errNoUsableInstallPkgSource) {
		t.Fatalf("unexpected error: %v", err)
	}
	if got := requests.Load(); 2 != got {
		t.Fatalf("unusable sources were retried: %d requests", got)
	}
}

// 首字节等待超过探测窗口不代表所有源不可达，仍需保留顺序下载回退。
func TestDownloadInstallPkgSourcesRetriesAfterProbeWindowExpires(t *testing.T) {
	dir := prepareInstallPackageTest(t)
	content := installPkgProbeTestContent()
	metadata := installPkgDownloadMetadata(content)
	var requests atomic.Int32
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if requests.Add(1) <= 2 {
			<-r.Context().Done()
			return
		}
		_, _ = w.Write(content)
	}))
	t.Cleanup(source.Close)

	if err := downloadInstallPkgSources([]string{source.URL, source.URL}, metadata); err != nil {
		t.Fatal(err)
	}
	if got := requests.Load(); 3 != got {
		t.Fatalf("unexpected request count after probe timeout: %d", got)
	}
	assertInstallPkgDownloaded(t, dir, content)
}

type installPkgInterruptedReader struct {
	content []byte
}

func (r *installPkgInterruptedReader) Read(buffer []byte) (int, error) {
	if 0 == len(r.content) {
		return 0, io.EOF
	}
	read := copy(buffer, r.content)
	r.content = r.content[read:]
	return read, io.ErrUnexpectedEOF
}

// 同一次读取返回数据和错误时，不得让成功写盘覆盖读取错误并发布安装包。
func TestInstallPkgProbeDownloadPreservesReadError(t *testing.T) {
	dir := prepareInstallPackageTest(t)
	content := []byte("interrupted package")
	metadata := installPkgDownloadMetadata(content)
	probe := newInstallPkgProbe(context.Background(), "https://example.invalid/pkg", 1, make(chan *installPkgProbe, 1))
	t.Cleanup(probe.cancel)
	err := probe.download(io.NopCloser(&installPkgInterruptedReader{content: content}), dir, metadata)
	if !errors.Is(err, io.ErrUnexpectedEOF) {
		t.Fatalf("read error was lost: %v", err)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if 0 != len(entries) {
		t.Fatalf("interrupted download left files: %v", entries)
	}
}

// 胜出源校验失败后按原顺序重试，并由后续源发布经过校验的安装包。
func TestDownloadInstallPkgSourcesRetriesAfterWinnerFailure(t *testing.T) {
	dir := prepareInstallPackageTest(t)
	content := installPkgProbeTestContent()
	metadata := installPkgDownloadMetadata(content)
	started := make(chan struct{})
	var badRequests, goodRequests atomic.Int32
	good := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if 1 == goodRequests.Add(1) {
			close(started)
			<-r.Context().Done()
			return
		}
		_, _ = w.Write(content)
	}))
	t.Cleanup(good.Close)
	bad := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		badRequests.Add(1)
		select {
		case <-started:
			_, _ = w.Write([]byte("invalid package"))
		case <-r.Context().Done():
		}
	}))
	t.Cleanup(bad.Close)

	if err := downloadInstallPkgSources([]string{bad.URL, good.URL}, metadata); err != nil {
		t.Fatal(err)
	}
	if 2 != badRequests.Load() || 2 != goodRequests.Load() {
		t.Fatalf("unexpected fallback requests: bad=%d good=%d", badRequests.Load(), goodRequests.Load())
	}
	assertInstallPkgDownloaded(t, dir, content)
}

// 禁用客户端默认超时后，下载上下文仍必须能够终止已建立连接上的阻塞读取。
func TestInstallPkgProbeOpenHonorsDownloadContext(t *testing.T) {
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	}))
	t.Cleanup(source.Close)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	t.Cleanup(cancel)
	probe := newInstallPkgProbe(ctx, source.URL, 1, make(chan *installPkgProbe, 1))
	t.Cleanup(probe.cancel)
	body, err := probe.open()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(probe.closeBody)
	if _, err = io.ReadAll(body); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("download context did not interrupt the response body: %v", err)
	}
}
