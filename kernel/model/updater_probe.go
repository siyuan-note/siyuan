// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"github.com/imroc/req/v3"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const (
	// installPkgProbeWindow 是并发探测各下载源的时长上限，到期后按已读字节数选出吞吐最高的源。
	// 探测本身就是下载：各源都在真实读取，因此这段等待不会白费带宽。
	installPkgProbeWindow = 8 * time.Second
	// installPkgProbeBytes 是探测阶段结束的条件之一：任一源读满它就立刻让它继续下载，
	// 不必等到窗口结束。缓冲区会因保留完整读取块而最多超出它一个块，内存上限即该值乘以源的数量。
	installPkgProbeBytes = 2 * 1024 * 1024
)

// errInstallPkgProbeAbandoned 表示该源在选举中落选，连接已被关闭。
var errInstallPkgProbeAbandoned = errors.New("install package probe was abandoned")

// errNoUsableInstallPkgSource 表示每个下载源都没能建立可用的下载连接，重试也不会改善。
var errNoUsableInstallPkgSource = errors.New("no install package source could be probed")

// installPkgProbe 是一个正在探测的下载源。探测期间读取的字节暂存在内存中，
// 胜出后由同一个连接继续读完并落盘，落选时立即断开。
type installPkgProbe struct {
	url      string
	limit    int64
	events   chan<- *installPkgProbe
	ctx      context.Context // 单独取消，落选时连未完成的连接请求也一并终止
	cancel   context.CancelFunc
	decision chan struct{} // 选举结果公布时关闭
	result   chan error    // 探测协程的最终结果

	read      atomic.Int64 // 已读取字节数，用于比较吞吐量
	completed atomic.Bool  // 是否已读满上限或读完整个安装包
	sent      atomic.Bool  // 探测结束事件是否已报告，保证只报告一次

	mu            sync.Mutex
	body          io.ReadCloser
	buffer        []byte
	contentLength int64
	err           error
	elected       bool
	abandoned     bool
}

func newInstallPkgProbe(parent context.Context, pkgURL string, limit int64, events chan<- *installPkgProbe) *installPkgProbe {
	ctx, cancel := context.WithCancel(parent)
	return &installPkgProbe{
		url: pkgURL, limit: limit, events: events, ctx: ctx, cancel: cancel,
		decision: make(chan struct{}), result: make(chan error, 1),
	}
}

// probeAndDownloadInstallPkg 并发探测各源，选出让本机吞吐最高的源在同一连接上继续下载。
// 探测失败时返回错误，调用方仍可按原顺序重新完整下载。
func probeAndDownloadInstallPkg(installDir string, urls []string, metadata *installPackageMetadata) error {
	return probeAndDownloadInstallPkgWithin(installDir, urls, metadata, installPkgProbeWindow, installPkgProbeBytes)
}

func probeAndDownloadInstallPkgWithin(installDir string, urls []string, metadata *installPackageMetadata, window time.Duration, limit int64) error {
	events := make(chan *installPkgProbe, len(urls))
	probes := make([]*installPkgProbe, len(urls))

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute+window)
	defer cancel()
	for index, pkgURL := range urls {
		probes[index] = newInstallPkgProbe(ctx, pkgURL, limit, events)
		go probes[index].run(installDir, metadata)
	}

	timer := time.NewTimer(window)
	defer timer.Stop()
	allFailed := awaitInstallPkgProbe(events, timer, len(probes))

	winner := pickInstallPkgProbe(probes)
	for _, probe := range probes {
		if probe == winner {
			probe.elect()
		} else {
			probe.abandon()
		}
	}

	// 无论是否有胜出源，都必须等全部协程退出后再返回：调用方随后会释放跨工作空间的下载锁，
	// 此时任何探测连接继续读取都会破坏「同时只有一个工作空间在下载」的约定。
	var winnerErr error
	for _, probe := range probes {
		if err := <-probe.result; probe == winner {
			winnerErr = err
		}
	}
	if nil == winner {
		if allFailed {
			return errNoUsableInstallPkgSource
		}
		return errors.New("no install package source delivered data before probe selection")
	}
	if nil != winnerErr {
		return fmt.Errorf("download install package [%s] failed: %w", winner.url, winnerErr)
	}
	logging.LogInfof("downloaded install package [%s] to [%s]", winner.url, filepath.Join(installDir, metadata.FileName))
	return nil
}

// awaitInstallPkgProbe 等待选举时机，仅在全部源都明确失败时返回 true。
func awaitInstallPkgProbe(events <-chan *installPkgProbe, timer *time.Timer, total int) bool {
	for seen := 0; seen < total; seen++ {
		select {
		case probe := <-events:
			if probe.completed.Load() {
				return false
			}
		case <-timer.C:
			return false
		}
	}
	return true
}

// pickInstallPkgProbe 选出已读到最多字节且没有错误的源，并列时保留靠前的源。
func pickInstallPkgProbe(probes []*installPkgProbe) *installPkgProbe {
	var winner *installPkgProbe
	for _, probe := range probes {
		if !probe.usable() {
			continue
		}
		if nil == winner || winner.read.Load() < probe.read.Load() {
			winner = probe
		}
	}
	return winner
}

// run 先探测本源的吞吐量，胜出后用同一个连接继续下载并发布安装包。
func (p *installPkgProbe) run(installDir string, metadata *installPackageMetadata) (err error) {
	defer func() { p.result <- err }()
	defer p.cancel()

	body, err := p.open()
	if nil != err {
		p.settle(err)
		return
	}
	defer p.closeBody()

	chunk := make([]byte, 32*1024)
	for {
		if p.isAbandoned() {
			err = errInstallPkgProbeAbandoned
			return
		}
		if p.isElected() {
			break
		}
		var read int
		read, err = body.Read(chunk)
		if 0 < read {
			p.append(chunk[:read])
		}
		if nil != err && io.EOF != err {
			p.settle(err)
			return
		}
		if io.EOF == err || p.limit <= p.read.Load() {
			// 探测阶段结束，等待选举结果
			err = nil
			p.completed.Store(true)
			p.signal()
			break
		}
	}

	// 读满上限或读完内容的源在这里等待选举结果，已当选的源直接进入下载
	<-p.decision
	if p.isAbandoned() {
		err = errInstallPkgProbeAbandoned
		return
	}
	return p.download(body, installDir, metadata)
}

// open 打开下载连接，校验响应状态与内容编码，返回可继续读取的响应体。
// 安装包必须拿到原始字节，因此显式声明 identity 并拒绝任何内容编码。
func (p *installPkgProbe) open() (io.ReadCloser, error) {
	// 整次下载由探测上下文限时，避免客户端默认的两分钟超时提前中断有效连接。
	client := req.C().SetTimeout(0).SetTLSHandshakeTimeout(7 * time.Second).DisableInsecureSkipVerify().SetUserAgent(util.UserAgent)
	response, err := client.R().SetContext(p.ctx).SetHeader("Accept-Encoding", "identity").DisableAutoReadResponse().Get(p.url)
	if nil != err {
		return nil, err
	}
	if nil == response.Body {
		return nil, fmt.Errorf("install package [%s] returned no body", p.url)
	}
	// 未发送 Range 请求，206 说明响应与预期不符，宁可此时失败以便换源
	if http.StatusOK != response.StatusCode || "" != response.Header.Get("Content-Encoding") {
		_ = response.Body.Close()
		return nil, fmt.Errorf("install package [%s] returned status [%d] with encoding [%s]",
			p.url, response.StatusCode, response.Header.Get("Content-Encoding"))
	}
	p.mu.Lock()
	p.body, p.contentLength = response.Body, response.ContentLength
	p.mu.Unlock()
	return response.Body, nil
}

// download 把探测阶段暂存的字节写入临时文件，并继续读同一个连接直到结束，然后校验并发布安装包。
func (p *installPkgProbe) download(body io.ReadCloser, installDir string, metadata *installPackageMetadata) (err error) {
	p.mu.Lock()
	buffer, total := p.buffer, p.contentLength
	p.buffer = nil
	p.mu.Unlock()

	temporary, err := os.CreateTemp(installDir, metadata.FileName+".*.part")
	if err != nil {
		logging.LogErrorf("create temporary install package failed: %s", err)
		return
	}
	temporaryPath := temporary.Name()
	defer func() {
		_ = temporary.Close()
		if removeErr := os.Remove(temporaryPath); removeErr != nil && !os.IsNotExist(removeErr) {
			logging.LogErrorf("remove incomplete install package [%s] failed: %s", temporaryPath, removeErr)
		}
	}()
	if _, err = temporary.Write(buffer); err != nil {
		logging.LogErrorf("write probed install package bytes failed: %s", err)
		return
	}

	logging.LogInfof("downloading install package [%s] from offset [%d]", p.url, len(buffer))
	written, chunk, lastPush := int64(len(buffer)), make([]byte, 32*1024), time.Now()
	for {
		var read int
		var readErr error
		read, readErr = body.Read(chunk)
		if 0 < read {
			if _, err = temporary.Write(chunk[:read]); err != nil {
				logging.LogErrorf("write install package [%s] failed: %s", p.url, err)
				return
			}
			written += int64(read)
			if 0 < total && 1*time.Second <= time.Since(lastPush) {
				lastPush = time.Now()
				progress := fmt.Sprintf("%.2f%%", float64(written)/float64(total)*100.0)
				util.PushStatusBar(fmt.Sprintf(Conf.Language(133), progress))
			}
		}
		if io.EOF == readErr {
			err = nil
			break
		}
		if nil != readErr {
			err = readErr
			logging.LogErrorf("download install package [%s] failed: %s", p.url, err)
			return
		}
	}

	if err = temporary.Close(); err != nil {
		logging.LogErrorf("close temporary install package [%s] failed: %s", temporaryPath, err)
		return
	}
	if err = verifyAndPublishInstallPkg(installDir, temporaryPath, metadata); err != nil {
		logging.LogErrorf("publish install package [%s] failed: %s", p.url, err)
		return
	}
	return
}

// append 暂存探测阶段读取的字节。上限只用来判断何时结束探测，绝不能截断数据：
// 被丢弃的字节不会再从连接上出现，胜出源继续下载时会出现缺字节、校验必然失败。
// 因此缓冲区最多超出上限一个读取块。
func (p *installPkgProbe) append(chunk []byte) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.buffer = append(p.buffer, chunk...)
	p.read.Store(int64(len(p.buffer)))
}

// settle 记录探测阶段的错误并通知选举方，该源不再参与竞争。
func (p *installPkgProbe) settle(err error) {
	p.mu.Lock()
	if nil == p.err {
		p.err = err
	}
	p.mu.Unlock()
	p.signal()
}

// signal 报告探测阶段结束，保证只报告一次。
func (p *installPkgProbe) signal() {
	if p.sent.CompareAndSwap(false, true) {
		p.events <- p
	}
}

// elect 宣布本源胜出，探测循环随后接手完整下载。
func (p *installPkgProbe) elect() {
	p.mu.Lock()
	p.elected = true
	p.mu.Unlock()
	close(p.decision)
}

// abandon 宣布本源落选并终止连接：取消上下文可中断尚未完成的连接请求，
// 关闭响应体会让阻塞中的读取立即返回。
func (p *installPkgProbe) abandon() {
	p.mu.Lock()
	p.abandoned = true
	body := p.body
	p.mu.Unlock()
	close(p.decision)
	p.cancel()
	if nil != body {
		_ = body.Close()
	}
}

func (p *installPkgProbe) isElected() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.elected
}

func (p *installPkgProbe) isAbandoned() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.abandoned
}

// usable 表示该源探测成功且确实读到了数据，可以作为下载候选。
func (p *installPkgProbe) usable() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return nil == p.err && 0 < len(p.buffer)
}

func (p *installPkgProbe) closeBody() {
	p.mu.Lock()
	body := p.body
	p.body = nil
	p.mu.Unlock()
	if nil != body {
		_ = body.Close()
	}
}

// verifyAndPublishInstallPkg 校验已下载的临时文件并发布为就绪安装包。
func verifyAndPublishInstallPkg(installDir, temporaryPath string, metadata *installPackageMetadata) error {
	localChecksum, _ := sha256Hash(temporaryPath)
	if metadata.Checksum != localChecksum {
		return fmt.Errorf("verify checksum failed, download install package [%s] checksum [%s] not equal to downloaded checksum [%s]",
			temporaryPath, metadata.Checksum, localChecksum)
	}
	return publishInstallPackage(temporaryPath, installDir, metadata, Conf.CookieKey)
}
