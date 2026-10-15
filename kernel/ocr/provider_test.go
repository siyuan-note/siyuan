package ocr

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"
)

type testProvider struct {
	available bool
	recognize func(context.Context, string) ([]map[string]string, error)
}

func (p *testProvider) Available() bool { return p.available }

func (p *testProvider) Recognize(ctx context.Context, path string) ([]map[string]string, error) {
	return p.recognize(ctx, path)
}

func TestProviderSelection(t *testing.T) {
	r := NewRegistry()
	for _, id := range []ProviderID{Tesseract, PaddleOCR} {
		id := id
		if err := r.Register(id, &testProvider{
			available: true,
			recognize: func(_ context.Context, path string) ([]map[string]string, error) {
				return []map[string]string{{"text": string(id), "path": path, "conf": "99"}}, nil
			},
		}); err != nil {
			t.Fatal(err)
		}
	}
	for _, id := range []ProviderID{Tesseract, PaddleOCR} {
		rows, err := r.Recognize(context.Background(), id, "image.png")
		want := []map[string]string{{"text": string(id), "path": "image.png", "conf": "99"}}
		if err != nil || !reflect.DeepEqual(rows, want) {
			t.Fatalf("provider %s: rows=%v, err=%v", id, rows, err)
		}
	}
	if err := r.Register(Tesseract, &testProvider{}); err == nil {
		t.Fatal("duplicate registration succeeded")
	}
}

func TestProviderUnavailableDoesNotFallBack(t *testing.T) {
	r := NewRegistry()
	called := false
	if err := r.Register(Tesseract, &testProvider{
		available: true,
		recognize: func(context.Context, string) ([]map[string]string, error) {
			called = true
			return nil, nil
		},
	}); err != nil {
		t.Fatal(err)
	}
	if err := r.Register(PaddleOCR, &testProvider{}); err != nil {
		t.Fatal(err)
	}
	if _, err := r.Recognize(context.Background(), PaddleOCR, "image.png"); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("unavailable provider: %v", err)
	}
	if _, err := r.Recognize(context.Background(), "missing", "image.png"); !errors.Is(err, ErrUnknownProvider) {
		t.Fatalf("unknown provider: %v", err)
	}
	if called {
		t.Fatal("another provider was used without selecting it")
	}
}

func TestProviderCancellationWhileQueued(t *testing.T) {
	r := NewRegistry()
	started, release := make(chan struct{}), make(chan struct{})
	if err := r.Register(PaddleOCR, &testProvider{
		available: true,
		recognize: func(ctx context.Context, path string) ([]map[string]string, error) {
			if path != "first.png" {
				t.Error("canceled request reached the provider")
				return nil, nil
			}
			close(started)
			select {
			case <-release:
				return nil, nil
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		},
	}); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() {
		_, err := r.Recognize(context.Background(), PaddleOCR, "first.png")
		done <- err
	}()
	<-started
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if _, err := r.Recognize(ctx, PaddleOCR, "second.png"); !errors.Is(err, context.DeadlineExceeded) {
		t.Errorf("canceled request: %v", err)
	}
	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}

func TestProviderFailureIsPreserved(t *testing.T) {
	r := NewRegistry()
	want := errors.New("model inference failed")
	if err := r.Register(PaddleOCR, &testProvider{
		available: true,
		recognize: func(context.Context, string) ([]map[string]string, error) { return nil, want },
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := r.Recognize(context.Background(), PaddleOCR, "image.png"); !errors.Is(err, want) {
		t.Fatalf("provider error was replaced: %v", err)
	}
}
