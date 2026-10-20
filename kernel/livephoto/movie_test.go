package livephoto

import (
	"bytes"
	"context"
	"crypto/sha256"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Eyevinn/mp4ff/mp4"
	hevc "github.com/gen2brain/h265/hevc"
	"github.com/siyuan-note/siyuan/kernel/internal/testutil"
)

func TestMovieRemuxPreservesVideoAndEncodesPCM(t *testing.T) {
	source := testutil.LivePhotoMOV(t)
	hash := sha256.Sum256(source)
	movie, err := Open(source)
	if err != nil {
		t.Fatal(err)
	}
	if movie.NeedsVideoEncoding() || len(movie.Frames) != 3 {
		t.Fatalf("wrong source info: %+v", movie.Info)
	}
	output, err := movie.Transcode(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	converted, err := Open(output)
	if err != nil {
		t.Fatal(err)
	}
	if converted.audio == nil || converted.audio.Mdia.Minf.Stbl.Stsd.Mp4a == nil {
		t.Fatal("PCM was not encoded to AAC")
	}
	for i, sample := range movie.samples {
		if !bytes.Equal(sample.data, converted.samples[i].data) {
			t.Fatal("AVC source video was recompressed")
		}
	}
	if sha256.Sum256(source) != hash {
		t.Fatal("source changed")
	}
	if converted.duration != movie.duration {
		t.Fatal("video duration changed")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := movie.Transcode(ctx); err == nil {
		t.Fatal("ignored cancellation")
	}
}

func TestMovieRejectsCorruptionAndLimits(t *testing.T) {
	for _, source := range [][]byte{nil, []byte("invalid"), bytes.Repeat([]byte{0}, 64), make([]byte, MaxInputBytes+1)} {
		if _, err := Open(source); err == nil {
			t.Fatal("accepted invalid movie")
		}
	}
	source := testutil.LivePhotoMOV(t)
	f, _ := mp4.DecodeFile(bytes.NewReader(source))
	f.Moov.Traks[0].Mdia.Minf.Stbl.Stsd.AvcX.Width = 65534
	var oversized bytes.Buffer
	if err := f.Encode(&oversized); err != nil {
		t.Fatal(err)
	}
	if _, err := Open(oversized.Bytes()); err == nil {
		t.Fatal("accepted oversized dimensions")
	}
	for _, encoded := range [][]byte{nil, {0, 0, 0, 1}, {0, 0, 0, 1, 255, 255, 255, 255}} {
		if _, err := ReadEncodedFrames(encoded, 1); err == nil {
			t.Fatal("accepted invalid AVC frame envelope")
		}
	}
}

func TestPictureI420TenBitSDRAndCrop(t *testing.T) {
	p := &hevc.Picture{CropX: 2, CropY: 2, CropW: 2, CropH: 2, ChromaFormat: 1, BitDepth: 10, BitDepthC: 10,
		StrideY: 4, StrideC: 2, Y16: make([]uint16, 16), Cb16: make([]uint16, 4), Cr16: make([]uint16, 4)}
	p.Y16[10], p.Y16[11], p.Y16[14], p.Y16[15] = 0, 256, 512, 1023
	p.Cb16[3], p.Cr16[3] = 512, 1023
	got, err := pictureI420(p, 2, 2)
	if err != nil || !bytes.Equal(got, []byte{0, 64, 128, 255, 128, 255}) {
		t.Fatalf("10-bit conversion: %v, %v", got, err)
	}
}

func TestPreviewCacheScopesAndCancellation(t *testing.T) {
	dir := t.TempDir()
	manager := NewManager(func() string { return dir })
	source := testutil.LivePhotoMOV(t)
	var released atomic.Int32
	session, err := manager.Start(bytes.Clone(source), "encrypted", "asset", false, func() { released.Add(1) })
	if err != nil {
		t.Fatal(err)
	}
	result, err := manager.Result(context.Background(), session.ID)
	if err != nil || len(result) == 0 {
		t.Fatalf("preview: %d, %v", len(result), err)
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 0 {
		t.Fatal("encrypted preview written to disk")
	}
	manager.Clear("encrypted")
	if _, err := manager.Result(context.Background(), session.ID); err == nil {
		t.Fatal("locked scope retained session")
	}
	manager.slot <- struct{}{}
	blocked, err := manager.Start(bytes.Clone(source), "encrypted", "asset", false, func() { released.Add(1) })
	if err != nil {
		t.Fatal(err)
	}
	manager.Clear("encrypted")
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if _, err := manager.Result(ctx, blocked.ID); err == nil {
		t.Fatal("cancelled job remained readable")
	}
	<-manager.slot
	deadline := time.Now().Add(time.Second)
	for released.Load() != 2 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if released.Load() != 2 {
		t.Fatal("cancelled job did not release lifecycle lease")
	}
	plain, err := manager.Start(bytes.Clone(source), "", "asset", false, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Result(ctx, plain.ID); err != nil {
		t.Fatal(err)
	}
	files, _ := filepath.Glob(filepath.Join(dir, "*.mp4"))
	if len(files) != 1 {
		t.Fatal("plain preview cache missing")
	}
}

func TestSharedPreviewSessionsCancelIndependently(t *testing.T) {
	dir := t.TempDir()
	manager := NewManager(func() string { return dir })
	defer manager.Clear("")
	manager.slot <- struct{}{}
	source := testutil.LivePhotoMOV(t)
	first, err := manager.Start(bytes.Clone(source), "", "asset", false, nil)
	if err != nil {
		t.Fatal(err)
	}
	second, err := manager.Start(bytes.Clone(source), "", "asset", false, nil)
	if err != nil {
		t.Fatal(err)
	}
	if first.ID == second.ID {
		t.Fatal("independent callers received the same cancellation token")
	}
	manager.Cancel(first.ID)
	<-manager.slot
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := manager.Result(ctx, second.ID); err != nil {
		t.Fatalf("cancelling one caller cancelled another: %v", err)
	}
	if _, err := manager.Result(ctx, first.ID); err == nil {
		t.Fatal("cancelled token remained valid")
	}
}

func TestLivePhotoSampleMetadata(t *testing.T) {
	path := os.Getenv("SIYUAN_LIVE_PHOTO_SAMPLE")
	if path == "" {
		t.Skip("optional original MOV fixture")
	}
	source, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	movie, err := Open(source)
	if err != nil {
		t.Fatal(err)
	}
	if movie.Color != (Color{Primaries: 12, Transfer: 1, Matrix: 6, FullRange: true}) {
		t.Fatalf("lost original P3 color or full range: %+v", movie.Color)
	}
}

func TestLivePhotoSample(t *testing.T) {
	path := os.Getenv("SIYUAN_LIVE_PHOTO_SAMPLE")
	if path == "" {
		t.Skip("optional original MOV fixture")
	}
	source, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256(source)
	movie, err := Open(source)
	if err != nil {
		t.Fatal(err)
	}
	var packets [][]byte
	if encodedPath := os.Getenv("SIYUAN_LIVE_PHOTO_ENCODED"); encodedPath != "" {
		data, err := os.ReadFile(encodedPath)
		if err != nil {
			t.Fatal(err)
		}
		packets, err = ReadEncodedFrames(data, len(movie.Frames))
		if err != nil {
			t.Fatal(err)
		}
	}
	var output []byte
	if packets != nil {
		output, err = movie.Mux(context.Background(), packets)
	} else {
		output, err = movie.Transcode(context.Background())
	}
	if err != nil {
		t.Fatal(err)
	}
	converted, err := Open(output)
	if err != nil {
		t.Fatal(err)
	}
	if len(converted.Frames) != len(movie.Frames) || converted.duration != movie.duration || converted.audio == nil {
		t.Fatal("lost timing, frames, or audio")
	}
	if sha256.Sum256(source) != hash {
		t.Fatal("source changed")
	}
	if dest := os.Getenv("SIYUAN_LIVE_PHOTO_OUTPUT"); dest != "" {
		if err := os.WriteFile(dest, output, 0600); err != nil {
			t.Fatal(err)
		}
	}
	t.Logf("converted %d frames, %dx%d, %.3f seconds, %d bytes", len(movie.Frames), movie.Width, movie.Height, float64(movie.duration)/float64(movie.scale), len(output))
}
