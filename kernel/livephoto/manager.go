// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package livephoto

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const cacheVersion = "live-photo-preview-1"

type Session struct {
	ID     string `json:"id"`
	Encode bool   `json:"encode"`
	Info
}

type previewJob struct {
	id, key, scope, origin string
	ctx                    context.Context
	cancel                 context.CancelFunc
	movie                  *Movie
	frames                 chan []byte
	encoded                chan []byte
	done                   chan struct{}
	nextFrame              int
	submitted              bool
	clientEncode           bool
	frameMu                sync.Mutex
	result                 []byte
	err                    error
	created                time.Time
}

type memoryPreview struct {
	data  []byte
	scope string
	used  time.Time
}

// Manager 限制并发、帧缓冲和缓存容量；加密作用域的原片、帧和预览均只存在于内存。
type Manager struct {
	mu       sync.Mutex
	jobs     map[string]*previewJob
	inflight map[string]*previewJob
	memory   map[string]memoryPreview
	slot     chan struct{}
	cacheDir func() string
}

func NewManager(cacheDir func() string) *Manager {
	return &Manager{jobs: map[string]*previewJob{}, inflight: map[string]*previewJob{},
		memory: map[string]memoryPreview{}, slot: make(chan struct{}, 1), cacheDir: cacheDir}
}

// Start 接管 source 的所有权，并在任务结束或复用已有任务时调用 release。
func (m *Manager) Start(source []byte, scope, origin string, clientEncode bool, release func()) (session Session, err error) {
	if release == nil {
		release = func() {}
	}
	transferred := false
	var movie *Movie
	defer func() {
		if !transferred {
			clear(source)
			if movie != nil {
				movie.clearSamples()
			}
			release()
		}
	}()
	movie, err = Open(source)
	if err != nil {
		return session, err
	}
	hash := sha256.New()
	hash.Write([]byte(cacheVersion + "\x00" + scope + "\x00" + origin + "\x00"))
	hash.Write(source)
	key := hex.EncodeToString(hash.Sum(nil))
	m.mu.Lock()
	defer m.mu.Unlock()
	m.expireLocked()
	if len(m.jobs) >= 8 {
		return session, errors.New("too many Live Photo preview sessions")
	}
	token := make([]byte, 24)
	if _, err := rand.Read(token); err != nil {
		return session, err
	}
	if existing := m.inflight[key]; existing != nil {
		id := hex.EncodeToString(token)
		m.jobs[id] = existing
		return Session{ID: id, Info: existing.movie.Info}, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	job := &previewJob{id: hex.EncodeToString(token), key: key, scope: scope, origin: origin, ctx: ctx, cancel: cancel,
		movie: movie, frames: make(chan []byte, 2), encoded: make(chan []byte, 1), done: make(chan struct{}), created: time.Now()}
	m.jobs[job.id] = job
	session = Session{ID: job.id, Info: movie.Info}
	if cached := m.readCacheLocked(key, scope); cached != nil {
		job.result = cached
		close(job.done)
		cancel()
		return session, nil
	}
	session.Encode = clientEncode && movie.NeedsVideoEncoding()
	job.clientEncode = session.Encode
	if !session.Encode {
		m.inflight[key] = job
	}
	transferred = true
	go func() {
		defer release()
		defer clear(source)
		defer movie.clearSamples()
		defer cancel()
		select {
		case m.slot <- struct{}{}:
			defer func() { <-m.slot }()
		case <-ctx.Done():
			m.finish(job, nil, ctx.Err())
			return
		}
		var result []byte
		var convertErr error
		if session.Encode {
			convertErr = movie.Decode(ctx, func(_ int, frame []byte) error {
				select {
				case job.frames <- frame:
					return nil
				case <-ctx.Done():
					return ctx.Err()
				}
			})
			close(job.frames)
			if convertErr == nil {
				select {
				case encoded := <-job.encoded:
					packets, readErr := ReadEncodedFrames(encoded, len(movie.Frames))
					if readErr == nil {
						result, convertErr = movie.Mux(ctx, packets)
					} else {
						convertErr = readErr
					}
					clear(encoded)
				case <-ctx.Done():
					convertErr = ctx.Err()
				}
			}
			for frame := range job.frames {
				clear(frame)
			}
		} else {
			result, convertErr = movie.Transcode(ctx)
		}
		m.finish(job, result, convertErr)
	}()
	return session, nil
}

func (m *Movie) clearSamples() {
	for _, s := range m.samples {
		clear(s.data)
	}
	m.file, m.samples, m.presentation = nil, nil, nil
}

func (m *Manager) finish(job *previewJob, data []byte, err error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.inflight[job.key] == job {
		delete(m.inflight, job.key)
	}
	if job.ctx.Err() != nil || !m.jobActiveLocked(job) {
		clear(data)
		err = context.Canceled
		data = nil
	}
	if err == nil {
		m.writeCacheLocked(job.key, job.scope, data)
	}
	job.result, job.err = data, err
	close(job.done)
}

func (m *Manager) jobActiveLocked(job *previewJob) bool {
	for _, active := range m.jobs {
		if active == job {
			return true
		}
	}
	return false
}

func (m *Manager) lookup(id string) (*previewJob, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	job := m.jobs[id]
	if job == nil {
		return nil, errors.New("Live Photo preview session expired")
	}
	return job, nil
}

func (m *Manager) Origin(id string) (string, error) {
	job, err := m.lookup(id)
	if err != nil {
		return "", err
	}
	return job.origin, nil
}

func (m *Manager) Frame(ctx context.Context, id string, index int) ([]byte, error) {
	job, err := m.lookup(id)
	if err != nil {
		return nil, err
	}
	job.frameMu.Lock()
	defer job.frameMu.Unlock()
	if id != job.id || !job.clientEncode || index != job.nextFrame || index < 0 || index >= len(job.movie.Frames) {
		return nil, errors.New("unexpected Live Photo frame index")
	}
	select {
	case frame, ok := <-job.frames:
		if !ok || job.ctx.Err() != nil {
			clear(frame)
			return nil, errors.New("Live Photo frame unavailable")
		}
		job.nextFrame++
		return frame, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-job.ctx.Done():
		return nil, job.ctx.Err()
	}
}

func (m *Manager) Submit(ctx context.Context, id string, encoded []byte) error {
	job, err := m.lookup(id)
	if err != nil {
		return err
	}
	job.frameMu.Lock()
	complete := id == job.id && job.clientEncode && !job.submitted && job.ctx.Err() == nil && job.nextFrame == len(job.movie.Frames)
	if complete {
		job.submitted = true
	}
	job.frameMu.Unlock()
	if !complete || len(encoded) > MaxInputBytes {
		return errors.New("incomplete Live Photo frames")
	}
	select {
	case job.encoded <- encoded:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	case <-job.ctx.Done():
		return job.ctx.Err()
	}
}

func (m *Manager) Result(ctx context.Context, id string) ([]byte, error) {
	job, err := m.lookup(id)
	if err != nil {
		return nil, err
	}
	select {
	case <-job.done:
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.jobs[id] != job {
		return nil, context.Canceled
	}
	if job.err != nil {
		return nil, job.err
	}
	return bytes.Clone(job.result), nil
}

func (m *Manager) Cancel(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if job := m.jobs[id]; job != nil {
		delete(m.jobs, id)
		if !m.jobActiveLocked(job) {
			if m.inflight[job.key] == job {
				delete(m.inflight, job.key)
			}
			job.cancel()
		}
	}
}

// Clear 在关闭准入后调用，取消在途解码并移除指定笔记本的所有会话与明文缓存。
func (m *Manager) Clear(scope string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for id, job := range m.jobs {
		if scope == "" || job.scope == scope {
			job.cancel()
			clear(job.result)
			delete(m.jobs, id)
			if m.inflight[job.key] == job {
				delete(m.inflight, job.key)
			}
		}
	}
	for key, cached := range m.memory {
		if scope == "" || cached.scope == scope {
			clear(cached.data)
			delete(m.memory, key)
		}
	}
}

func (m *Manager) expireLocked() {
	for id, job := range m.jobs {
		if time.Since(job.created) > 5*time.Minute {
			job.cancel()
			delete(m.jobs, id)
			if m.inflight[job.key] == job {
				delete(m.inflight, job.key)
			}
		}
	}
}

func (m *Manager) readCacheLocked(key, scope string) []byte {
	if scope != "" {
		if cached, ok := m.memory[key]; ok {
			cached.used = time.Now()
			m.memory[key] = cached
			return cached.data
		}
		return nil
	}
	file, err := os.Open(filepath.Join(m.cacheDir(), key+".mp4"))
	if err != nil {
		return nil
	}
	defer file.Close()
	stat, err := file.Stat()
	if err != nil || stat.Size() <= 0 || stat.Size() > MaxInputBytes {
		return nil
	}
	data := make([]byte, stat.Size())
	if _, err := file.ReadAt(data, 0); err != nil {
		return nil
	}
	return data
}

func (m *Manager) writeCacheLocked(key, scope string, data []byte) {
	if scope != "" {
		m.memory[key] = memoryPreview{data: data, scope: scope, used: time.Now()}
		var size int
		for _, cached := range m.memory {
			size += len(cached.data)
		}
		for size > 128*1024*1024 {
			var oldest string
			for k, cached := range m.memory {
				if oldest == "" || cached.used.Before(m.memory[oldest].used) {
					oldest = k
				}
			}
			size -= len(m.memory[oldest].data)
			for id, job := range m.jobs {
				if job.key == oldest {
					job.cancel()
					delete(m.jobs, id)
				}
			}
			clear(m.memory[oldest].data)
			delete(m.memory, oldest)
		}
		return
	}
	dir := m.cacheDir()
	if os.MkdirAll(dir, 0700) != nil {
		return
	}
	file, err := os.CreateTemp(dir, ".preview-*")
	if err != nil {
		return
	}
	temporary := file.Name()
	defer os.Remove(temporary)
	if _, err = file.Write(data); err != nil {
		file.Close()
		return
	}
	if err = file.Close(); err != nil {
		return
	}
	if err = os.Rename(temporary, filepath.Join(dir, key+".mp4")); err != nil {
		return
	}
	entries, _ := os.ReadDir(dir)
	var files []os.FileInfo
	var size int64
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".mp4") {
			continue
		}
		info, err := entry.Info()
		if err == nil {
			files = append(files, info)
			size += info.Size()
		}
	}
	sort.Slice(files, func(i, j int) bool { return files[i].ModTime().Before(files[j].ModTime()) })
	for _, info := range files {
		if size <= 512*1024*1024 && time.Since(info.ModTime()) < 7*24*time.Hour {
			break
		}
		if os.Remove(filepath.Join(dir, info.Name())) == nil {
			size -= info.Size()
		}
	}
}
