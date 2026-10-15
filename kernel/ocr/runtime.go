//go:build cgo

package ocr

/*
#cgo linux LDFLAGS: -ldl
#cgo android LDFLAGS: -ldl
#include <stdlib.h>
#include "runtime.h"
*/
import "C"

import (
	"context"
	"errors"
	"os"
	"sync"
	"unsafe"
)

var runtimeLock sync.Mutex

type session struct{ native *C.SyOCRSession }
type tensor struct {
	data  []float32
	shape []int64
}

func nativeError(message *C.char) error {
	if message == nil {
		return nil
	}
	defer C.free(unsafe.Pointer(message))
	return errors.New(C.GoString(message))
}

func initRuntime(library string) error {
	runtimeLock.Lock()
	defer runtimeLock.Unlock()
	path := C.CString(library)
	defer C.free(unsafe.Pointer(path))
	return nativeError(C.sy_ocr_init(path))
}

func newSession(path string) (*session, error) {
	model, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	if len(model) == 0 || len(model) > 256*1024*1024 {
		return nil, errors.New("invalid OCR model size")
	}
	result := &session{}
	if err = nativeError(C.sy_ocr_session(unsafe.Pointer(&model[0]), C.size_t(len(model)), &result.native)); err != nil {
		return nil, err
	}
	return result, nil
}

func (s *session) close() { C.sy_ocr_close(s.native); s.native = nil }

func (s *session) run(ctx context.Context, data []float32, shape []int64) (tensor, error) {
	if err := ctx.Err(); err != nil {
		return tensor{}, err
	}
	count := int64(1)
	for _, size := range shape {
		if size <= 0 || size > 100000000/count {
			return tensor{}, errors.New("invalid OCR input shape")
		}
		count *= size
	}
	if len(shape) != 4 || count != int64(len(data)) {
		return tensor{}, errors.New("invalid OCR input tensor")
	}
	var options unsafe.Pointer
	if err := nativeError(C.sy_ocr_options(&options)); err != nil {
		return tensor{}, err
	}
	defer C.sy_ocr_free_options(options)
	finished, stopped := make(chan struct{}), make(chan struct{})
	go func() {
		defer close(stopped)
		select {
		case <-ctx.Done():
			C.sy_ocr_cancel(options)
		case <-finished:
		}
	}()
	var output *C.SyOCROutput
	err := nativeError(C.sy_ocr_run(s.native, options, (*C.float)(unsafe.Pointer(&data[0])), C.size_t(len(data)), (*C.int64_t)(unsafe.Pointer(&shape[0])), &output))
	close(finished)
	<-stopped
	if output != nil {
		defer C.sy_ocr_free_output(output)
	}
	if ctx.Err() != nil {
		return tensor{}, ctx.Err()
	}
	if err != nil {
		return tensor{}, err
	}
	var values *C.float
	var dims *C.int64_t
	var rank, size C.size_t
	C.sy_ocr_output(output, &values, &dims, &rank, &size)
	return tensor{append([]float32(nil), unsafe.Slice((*float32)(unsafe.Pointer(values)), int(size))...), append([]int64(nil), unsafe.Slice((*int64)(unsafe.Pointer(dims)), int(rank))...)}, nil
}
