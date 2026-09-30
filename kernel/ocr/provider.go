package ocr

import (
	"context"
	"errors"
	"fmt"
	"sync"
)

type ProviderID string

const (
	Tesseract ProviderID = "tesseract"
	PaddleOCR ProviderID = "paddleocr"
)

var (
	ErrUnknownProvider = errors.New("unknown OCR provider")
	ErrUnavailable     = errors.New("OCR provider is unavailable")
)

// Provider 只负责识别，结果存储和搜索索引由调用方统一维护。
// 结果保留字符串列，兼容现有 OCR HTTP 接口的 ocrJSON 字段。
type Provider interface {
	Available() bool
	Recognize(context.Context, string) ([]map[string]string, error)
}

// Registry 串行调度识别，避免多个调用同时占用模型内存。
type Registry struct {
	mu        sync.RWMutex
	providers map[ProviderID]Provider
	slot      chan struct{}
}

func NewRegistry() *Registry {
	return &Registry{
		providers: map[ProviderID]Provider{},
		slot:      make(chan struct{}, 1),
	}
}

func (r *Registry) Register(id ProviderID, provider Provider) error {
	if id == "" || provider == nil {
		return errors.New("OCR provider ID and implementation are required")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.providers[id]; exists {
		return fmt.Errorf("OCR provider %q is already registered", id)
	}
	r.providers[id] = provider
	return nil
}

func (r *Registry) Available(id ProviderID) bool {
	r.mu.RLock()
	provider := r.providers[id]
	r.mu.RUnlock()
	return provider != nil && provider.Available()
}

func (r *Registry) Recognize(ctx context.Context, id ProviderID, imagePath string) ([]map[string]string, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	r.mu.RLock()
	provider := r.providers[id]
	r.mu.RUnlock()
	if provider == nil {
		return nil, fmt.Errorf("%w: %s", ErrUnknownProvider, id)
	}
	if !provider.Available() {
		return nil, fmt.Errorf("%w: %s", ErrUnavailable, id)
	}

	select {
	case r.slot <- struct{}{}:
		defer func() { <-r.slot }()
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if !provider.Available() {
		return nil, fmt.Errorf("%w: %s", ErrUnavailable, id)
	}
	return provider.Recognize(ctx, imagePath)
}
