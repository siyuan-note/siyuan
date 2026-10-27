// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

// Package livephoto 为实况照片生成可丢弃的兼容预览，不修改或替换原始资源。
package livephoto

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"sort"

	"github.com/Eyevinn/mp4ff/avc"
	mp4hevc "github.com/Eyevinn/mp4ff/hevc"
	"github.com/Eyevinn/mp4ff/mp4"
	hevc "github.com/gen2brain/h265/hevc"
)

const (
	MaxInputBytes = 64 * 1024 * 1024
	MaxFrames     = 600
	MaxPixels     = 4096 * 2160
	MaxSeconds    = 10
)

var ErrUnsupported = errors.New("unsupported Live Photo preview format")

type FrameTime struct {
	Timestamp int64 `json:"timestamp"`
	Duration  int64 `json:"duration"`
}

type Color struct {
	Primaries uint16 `json:"primaries"`
	Transfer  uint16 `json:"transfer"`
	Matrix    uint16 `json:"matrix"`
	FullRange bool   `json:"fullRange"`
}

type Info struct {
	Width  int         `json:"width"`
	Height int         `json:"height"`
	Frames []FrameTime `json:"frames"`
	Color  Color       `json:"color"`
}

type sample struct {
	data []byte
	pts  int64
	dur  uint32
	dts  uint64
}

type Movie struct {
	Info
	file         *mp4.File
	video        *mp4.TrakBox
	audio        *mp4.TrakBox
	samples      []sample
	presentation []sample
	duration     uint64
	scale        uint32
}

// Open 在解码前限制文件、轨道、样本数、时长和画面尺寸，解析失败不产生预览。
func Open(data []byte) (movie *Movie, err error) {
	defer func() {
		if recover() != nil {
			movie, err = nil, errors.New("invalid Live Photo movie")
		}
	}()
	if len(data) == 0 || len(data) > MaxInputBytes {
		return nil, errors.New("Live Photo movie exceeds preview size limit")
	}
	f, err := mp4.DecodeFile(bytes.NewReader(data))
	if err != nil || f.Moov == nil || f.IsFragmented() || len(f.Moov.Traks) > 8 {
		return nil, errors.New("invalid Live Photo movie")
	}
	m := &Movie{file: f}
	for _, track := range f.Moov.Traks {
		if track.Mdia == nil || track.Mdia.Hdlr == nil || track.Mdia.Mdhd == nil || track.Mdia.Minf == nil ||
			track.Mdia.Minf.Stbl == nil || track.Mdia.Minf.Stbl.Stsd == nil || track.Tkhd == nil {
			return nil, errors.New("incomplete Live Photo track")
		}
		switch track.Mdia.Hdlr.HandlerType {
		case "vide":
			if m.video != nil {
				return nil, ErrUnsupported
			}
			m.video = track
		case "soun":
			if m.audio != nil {
				return nil, ErrUnsupported
			}
			m.audio = track
		}
	}
	if m.video == nil || m.video.Mdia.Mdhd.Timescale == 0 {
		return nil, ErrUnsupported
	}
	m.scale = m.video.Mdia.Mdhd.Timescale
	stsd := m.video.Mdia.Minf.Stbl.Stsd
	entry := stsd.HvcX
	if entry == nil {
		entry = stsd.AvcX
	}
	if entry == nil || entry.Width == 0 || entry.Height == 0 || entry.Width > 4096 || entry.Height > 4096 ||
		int(entry.Width)*int(entry.Height) > MaxPixels || entry.Width%2 != 0 || entry.Height%2 != 0 {
		return nil, ErrUnsupported
	}
	m.Width, m.Height = int(entry.Width), int(entry.Height)
	m.Color = Color{Primaries: 1, Transfer: 1, Matrix: 1}
	if stsd.HvcX != nil {
		if entry.HvcC == nil {
			return nil, ErrUnsupported
		}
		for _, array := range entry.HvcC.NaluArrays {
			for _, nal := range array.Nalus {
				if len(nal) > 0 && (nal[0]>>1)&63 == 33 {
					sps, parseErr := mp4hevc.ParseSPSNALUnit(nal)
					if parseErr != nil || sps.ChromaFormatIDC != 1 || sps.BitDepthLumaMinus8 > 2 || sps.BitDepthChromaMinus8 > 2 {
						return nil, ErrUnsupported
					}
					if vui := sps.VUI; vui != nil {
						m.Color.FullRange = vui.VideoFullRangeFlag
						if vui.ColourDescriptionFlag {
							m.Color.Primaries, m.Color.Transfer, m.Color.Matrix = uint16(vui.ColourPrimaries), uint16(vui.TransferCharacteristics), uint16(vui.MatrixCoefficients)
						}
					}
				}
			}
		}
	}
	for _, child := range entry.Children {
		if colr, ok := child.(*mp4.ColrBox); ok && (colr.ColorType == "nclx" || colr.ColorType == "nclc") {
			m.Color.Primaries, m.Color.Transfer, m.Color.Matrix = colr.ColorPrimaries, colr.TransferCharacteristics, colr.MatrixCoefficients
			// QuickTime 的 nclc 不含范围标记，继续使用码流中的范围。
			if colr.ColorType == "nclx" {
				m.Color.FullRange = colr.FullRangeFlag
			}
		}
	}
	// HDR 原片保留原件；不能在未进行色调映射时把 HDR 采样值标记成 SDR。
	if m.Color.Transfer == 16 || m.Color.Transfer == 18 {
		return nil, ErrUnsupported
	}
	if m.samples, err = readSamples(f, m.video, MaxFrames); err != nil {
		return nil, err
	}
	m.presentation = append([]sample(nil), m.samples...)
	sort.SliceStable(m.presentation, func(i, j int) bool { return m.presentation[i].pts < m.presentation[j].pts })
	for i, s := range m.presentation {
		if s.dur == 0 || (i > 0 && s.pts <= m.presentation[i-1].pts) {
			return nil, errors.New("invalid Live Photo frame timing")
		}
		m.duration += uint64(s.dur)
		m.Frames = append(m.Frames, FrameTime{
			Timestamp: (s.pts - m.presentation[0].pts) * 1000000 / int64(m.scale),
			Duration:  int64(s.dur) * 1000000 / int64(m.scale),
		})
	}
	if m.duration == 0 || m.duration > uint64(m.scale)*MaxSeconds ||
		m.presentation[len(m.presentation)-1].pts-m.presentation[0].pts > int64(m.scale)*MaxSeconds {
		return nil, errors.New("Live Photo movie exceeds preview duration limit")
	}
	return m, nil
}

func readSamples(f *mp4.File, track *mp4.TrakBox, maxSamples uint32) ([]sample, error) {
	stbl := track.Mdia.Minf.Stbl
	if stbl.Stsz == nil || stbl.Stts == nil || stbl.Stsc == nil {
		return nil, errors.New("incomplete sample table")
	}
	n := track.GetNrSamples()
	if n == 0 || n > maxSamples {
		return nil, errors.New("Live Photo sample count exceeds preview limit")
	}
	total, err := stbl.Stsz.GetTotalSampleSize(1, n)
	if err != nil || total > MaxInputBytes {
		return nil, errors.New("invalid sample size")
	}
	data, err := f.ReadSampleData(track, 1, n, nil, nil)
	if err != nil {
		return nil, err
	}
	ret, pos := make([]sample, 0, n), 0
	for i := uint32(1); i <= n; i++ {
		size := int(stbl.Stsz.GetSampleSize(int(i)))
		if size <= 0 || size > len(data)-pos {
			return nil, errors.New("sample outside movie data")
		}
		dts, dur, timingErr := stbl.Stts.GetDecodeTime(i)
		if timingErr != nil || dts > uint64(track.Mdia.Mdhd.Timescale)*(MaxSeconds+1) {
			return nil, errors.New("invalid sample timing")
		}
		var offset int32
		if stbl.Ctts != nil {
			offset = stbl.Ctts.GetCompositionTimeOffset(i)
		}
		ret = append(ret, sample{data[pos : pos+size], int64(dts) + int64(offset), dur, dts})
		pos += size
	}
	return ret, nil
}

func (m *Movie) NeedsVideoEncoding() bool { return m.video.Mdia.Minf.Stbl.Stsd.HvcX != nil }

// Decode 按显示顺序逐帧输出 I420；调用方控制缓冲与背压，取消后不再交付帧。
func (m *Movie) Decode(ctx context.Context, emit func(int, []byte) error) (err error) {
	defer func() {
		if recover() != nil {
			err = errors.New("invalid HEVC video")
		}
	}()
	if !m.NeedsVideoEncoding() {
		return ErrUnsupported
	}
	decoder := &hevc.Decoder{}
	decoder.FrameSizeLimit(MaxPixels)
	decoder.Threads(2)
	count := 0
	consume := func(pictures []*hevc.Picture) error {
		defer func() {
			for _, picture := range pictures {
				picture.Release()
			}
		}()
		for _, picture := range pictures {
			if err := ctx.Err(); err != nil {
				return err
			}
			if count >= len(m.Frames) {
				return errors.New("too many decoded frames")
			}
			frame, err := pictureI420(picture, m.Width, m.Height)
			if err != nil {
				return err
			}
			if err = emit(count, frame); err != nil {
				clear(frame)
				return err
			}
			count++
		}
		return nil
	}
	config := m.video.Mdia.Minf.Stbl.Stsd.HvcX.HvcC
	decode := func(nal hevc.NALUnit) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		pictures, err := decoder.DecodeNAL(nal)
		if err != nil {
			return err
		}
		return consume(pictures)
	}
	for _, array := range config.NaluArrays {
		for _, raw := range array.Nalus {
			nal, ok := hevc.ParseNAL(raw)
			if !ok {
				return errors.New("invalid HEVC parameter set")
			}
			if err := decode(nal); err != nil {
				return err
			}
		}
	}
	for _, s := range m.samples {
		for _, nal := range hevc.SplitHVCC(s.data, int(config.LengthSizeMinusOne)+1) {
			if err := decode(nal); err != nil {
				return err
			}
		}
	}
	if err = consume(decoder.Flush()); err != nil {
		return err
	}
	if count != len(m.Frames) {
		return fmt.Errorf("decoded %d of %d frames", count, len(m.Frames))
	}
	return nil
}

func pictureI420(p *hevc.Picture, width, height int) ([]byte, error) {
	if p.CropW != width || p.CropH != height || p.ChromaFormat != 1 || p.BitDepth < 8 || p.BitDepth > 10 || p.BitDepthC < 8 || p.BitDepthC > 10 {
		return nil, ErrUnsupported
	}
	out := make([]byte, width*height*3/2)
	planes := []struct {
		data                      []byte
		wide                      []uint16
		stride, x, y, w, h, depth int
	}{
		{p.Y, p.Y16, p.StrideY, p.CropX, p.CropY, width, height, p.BitDepth},
		{p.Cb, p.Cb16, p.StrideC, p.CropX / 2, p.CropY / 2, width / 2, height / 2, p.BitDepthC},
		{p.Cr, p.Cr16, p.StrideC, p.CropX / 2, p.CropY / 2, width / 2, height / 2, p.BitDepthC},
	}
	pos := 0
	for _, plane := range planes {
		for y := 0; y < plane.h; y++ {
			start := (plane.y+y)*plane.stride + plane.x
			if len(plane.wide) > 0 {
				if start < 0 || start+plane.w > len(plane.wide) {
					return nil, ErrUnsupported
				}
				for _, value := range plane.wide[start : start+plane.w] {
					out[pos] = byte(min(255, (int(value)+(1<<(plane.depth-8))/2)>>(plane.depth-8)))
					pos++
				}
			} else {
				if start < 0 || start+plane.w > len(plane.data) {
					return nil, ErrUnsupported
				}
				copy(out[pos:pos+plane.w], plane.data[start:start+plane.w])
				pos += plane.w
			}
		}
	}
	return out, nil
}

// ReadEncodedFrames 读取浏览器按帧提交的 Annex B 数据，长度前缀避免依赖访问单元分隔符。
func ReadEncodedFrames(data []byte, expected int) (frames [][]byte, err error) {
	if len(data) > MaxInputBytes || len(data) < 4 || int(binary.BigEndian.Uint32(data)) != expected || expected > MaxFrames {
		return nil, errors.New("invalid encoded frame count")
	}
	data = data[4:]
	for range expected {
		if len(data) < 4 {
			return nil, errors.New("incomplete encoded frame")
		}
		n := int(binary.BigEndian.Uint32(data))
		data = data[4:]
		if n <= 0 || n > len(data) {
			return nil, errors.New("invalid encoded frame length")
		}
		frame := data[:n]
		if !bytes.HasPrefix(frame, []byte{0, 0, 0, 1}) && !bytes.HasPrefix(frame, []byte{0, 0, 1}) {
			return nil, errors.New("expected Annex B encoded video")
		}
		frames = append(frames, frame)
		data = data[n:]
	}
	if len(data) != 0 {
		return nil, errors.New("trailing encoded video data")
	}
	if len(frames) == 0 {
		return nil, errors.New("empty encoded video")
	}
	sps, pps := avc.GetParameterSetsFromByteStream(frames[0])
	if len(sps) == 0 || len(pps) == 0 {
		return nil, errors.New("missing AVC parameter sets")
	}
	return frames, nil
}
