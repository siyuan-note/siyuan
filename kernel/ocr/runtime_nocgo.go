//go:build !cgo

package ocr

import "context"

type session struct{}
type tensor struct {
	data  []float32
	shape []int64
}

func initRuntime(string) error            { return ErrUnavailable }
func newSession(string) (*session, error) { return nil, ErrUnavailable }
func (*session) close()                   {}
func (*session) run(context.Context, []float32, []int64) (tensor, error) {
	return tensor{}, ErrUnavailable
}
