// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package livephoto

import (
	"bytes"
	"context"
	"errors"

	"github.com/Eyevinn/mp4ff/avc"
	"github.com/Eyevinn/mp4ff/mp4"
	go264 "github.com/oops1/go.264"
	aacpcm "github.com/tphakala/go-aac/pcm"
)

// Transcode 是没有 WebCodecs 编码器时的纯 Go 后备路径，不调用外部程序或本机编码器。
func (m *Movie) Transcode(ctx context.Context) ([]byte, error) {
	if !m.NeedsVideoEncoding() {
		return m.Mux(ctx, nil)
	}
	encoder, err := go264.NewEncoder(go264.EncoderConfig{
		Width: m.Width, Height: m.Height, FPSNum: int(uint64(len(m.Frames)) * uint64(m.scale)), FPSDen: int(m.duration),
		GOPSize: 60, QP: 26, Slices: 4, CABAC: true, ForceSoftware: true,
		MotionSearch: go264.MotionSearchHalf, ModeDecision: go264.ModeDecisionFast,
	})
	if err != nil {
		return nil, err
	}
	defer encoder.Close()
	var packets [][]byte
	size := 0
	err = m.Decode(ctx, func(_ int, frame []byte) error {
		defer clear(frame)
		packet, encodeErr := encoder.Encode(frame)
		if encodeErr != nil {
			return encodeErr
		}
		if len(packet) == 0 {
			return errors.New("missing AVC output frame")
		}
		size += len(packet)
		if size > MaxInputBytes {
			return errors.New("Live Photo preview exceeds size limit")
		}
		packets = append(packets, bytes.Clone(packet))
		return nil
	})
	if err != nil {
		return nil, err
	}
	last, err := encoder.Flush()
	if err != nil || len(last) != 0 {
		return nil, errors.New("unexpected delayed AVC output")
	}
	return m.Mux(ctx, packets)
}

// Mux 生成带方向和颜色标记的 H.264/AAC MP4；已有 AAC 直接复用，PCM 按需编码。
func (m *Movie) Mux(ctx context.Context, packets [][]byte) (output []byte, err error) {
	defer func() {
		if recover() != nil {
			output, err = nil, errors.New("invalid Live Photo preview data")
		}
	}()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	init := mp4.CreateEmptyInit()
	video := init.AddEmptyTrack(m.scale, "video", "und")
	video.Tkhd.Matrix = m.video.Tkhd.Matrix
	if m.NeedsVideoEncoding() {
		if len(packets) != len(m.Frames) {
			return nil, errors.New("incomplete encoded video")
		}
		sps, pps := avc.GetParameterSetsFromByteStream(packets[0])
		if len(sps) == 0 || len(pps) == 0 {
			return nil, errors.New("missing AVC parameters")
		}
		if err := video.SetAVCDescriptor("avc1", sps, pps, true); err != nil {
			return nil, err
		}
		entry := video.Mdia.Minf.Stbl.Stsd.AvcX
		if int(entry.Width) != m.Width || int(entry.Height) != m.Height {
			return nil, errors.New("encoded dimensions differ from source")
		}
		color := m.Color
		parameters, err := avc.ParseSPSNALUnit(sps[0], true)
		if err != nil {
			return nil, err
		}
		// 编码器可能转换颜色，封装标记与实际输出码流保持一致。
		if vui := parameters.VUI; vui != nil && vui.VideoSignalTypePresentFlag {
			color.FullRange = vui.VideoFullRangeFlag
			if vui.ColourDescriptionFlag {
				color.Primaries, color.Transfer, color.Matrix = uint16(vui.ColourPrimaries), uint16(vui.TransferCharacteristics), uint16(vui.MatrixCoefficients)
			}
		}
		entry.AddChild(&mp4.ColrBox{ColorType: "nclx", ColorPrimaries: color.Primaries,
			TransferCharacteristics: color.Transfer, MatrixCoefficients: color.Matrix, FullRangeFlag: color.FullRange})
	} else {
		video.Mdia.Minf.Stbl.Stsd.AddChild(m.video.Mdia.Minf.Stbl.Stsd.AvcX)
	}
	var audio *mp4.TrakBox
	if m.audio != nil {
		if m.audio.Mdia.Mdhd.Timescale == 0 {
			return nil, ErrUnsupported
		}
		audio = init.AddEmptyTrack(m.audio.Mdia.Mdhd.Timescale, "audio", "und")
	}
	trackIDs := []uint32{video.Tkhd.TrackID}
	if audio != nil {
		trackIDs = append(trackIDs, audio.Tkhd.TrackID)
	}
	fragment, err := mp4.CreateMultiTrackFragment(1, trackIDs)
	if err != nil {
		return nil, err
	}
	movieDuration := m.duration * uint64(init.Moov.Mvhd.Timescale) / uint64(m.scale)
	init.Moov.Mvhd.Duration, video.Tkhd.Duration, video.Mdia.Mdhd.Duration = movieDuration, movieDuration, m.duration
	if m.NeedsVideoEncoding() {
		for i, packet := range packets {
			if err := ctx.Err(); err != nil {
				return nil, err
			}
			data := avc.ConvertByteStreamToNaluSample(packet)
			flags := uint32(0x01010000)
			if avc.IsIDRSample(data) {
				flags = 0x02000000
			}
			s := m.presentation[i]
			if err := fragment.AddFullSampleToTrack(mp4.FullSample{Sample: mp4.Sample{Flags: flags, Dur: s.dur, Size: uint32(len(data))},
				DecodeTime: uint64(s.pts - m.presentation[0].pts), Data: data}, video.Tkhd.TrackID); err != nil {
				return nil, err
			}
		}
	} else {
		sampleInfo, err := m.video.GetSampleData(1, uint32(len(m.samples)))
		if err != nil {
			return nil, err
		}
		for i, s := range m.samples {
			if err := fragment.AddFullSampleToTrack(mp4.FullSample{Sample: sampleInfo[i], DecodeTime: s.dts, Data: s.data}, video.Tkhd.TrackID); err != nil {
				return nil, err
			}
		}
		if m.video.Edts != nil {
			video.AddChild(m.video.Edts)
		}
	}
	if audio != nil {
		if err := m.addAudio(ctx, audio, fragment, movieDuration); err != nil {
			return nil, err
		}
	}
	var fragmented bytes.Buffer
	if err := init.Encode(&fragmented); err != nil {
		return nil, err
	}
	if err := fragment.Encode(&fragmented); err != nil {
		return nil, err
	}
	if fragmented.Len() > MaxInputBytes {
		return nil, errors.New("Live Photo preview exceeds size limit")
	}
	file, err := mp4.DecodeFile(bytes.NewReader(fragmented.Bytes()))
	if err != nil {
		return nil, err
	}
	var progressive bytes.Buffer
	if err := mp4.Defragment(file, bytes.NewReader(fragmented.Bytes()), &progressive); err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return progressive.Bytes(), nil
}

func (m *Movie) addAudio(ctx context.Context, audio *mp4.TrakBox, fragment *mp4.Fragment, duration uint64) error {
	samples, err := readSamples(m.file, m.audio, 1000000)
	if err != nil {
		return err
	}
	stsd := m.audio.Mdia.Minf.Stbl.Stsd
	if stsd.Mp4a != nil {
		audio.Mdia.Minf.Stbl.Stsd.AddChild(stsd.Mp4a)
		var total uint64
		for _, s := range samples {
			if err := ctx.Err(); err != nil {
				return err
			}
			if err := fragment.AddFullSampleToTrack(mp4.FullSample{Sample: mp4.Sample{Flags: 0x02000000, Dur: s.dur, Size: uint32(len(s.data))},
				DecodeTime: s.dts, Data: s.data}, audio.Tkhd.TrackID); err != nil {
				return err
			}
			total += uint64(s.dur)
		}
		audio.Tkhd.Duration, audio.Mdia.Mdhd.Duration = duration, total
		if m.audio.Edts != nil {
			audio.AddChild(m.audio.Edts)
		}
		return nil
	}
	pcm := stsd.QtPcm
	if pcm == nil {
		return ErrUnsupported
	}
	rate, channels, depth := int(pcm.SampleRate), int(pcm.ChannelCount), int(pcm.SampleSize)
	bigEndian := pcm.Type() == "twos"
	if config := pcm.QuickTimeV2; config != nil {
		if config.IsFloat() || !config.IsSignedInteger() {
			return ErrUnsupported
		}
		rate, channels, depth = int(config.AudioSampleRate), int(config.NumAudioChannels), int(config.ConstBitsPerChannel)
		bigEndian = config.IsBigEndian()
	}
	if (rate != 44100 && rate != 48000) || channels < 1 || channels > 2 || (depth != 16 && depth != 24 && depth != 32) {
		return ErrUnsupported
	}
	var pcmData []byte
	for _, s := range samples {
		pcmData = append(pcmData, s.data...)
	}
	defer clear(pcmData)
	bytesPerSample := depth / 8
	if len(pcmData)%(bytesPerSample*channels) != 0 || len(pcmData) > rate*channels*bytesPerSample*(MaxSeconds+1) {
		return ErrUnsupported
	}
	if bigEndian {
		for i := 0; i < len(pcmData); i += bytesPerSample {
			for j := 0; j < bytesPerSample/2; j++ {
				pcmData[i+j], pcmData[i+bytesPerSample-1-j] = pcmData[i+bytesPerSample-1-j], pcmData[i+j]
			}
		}
	}
	encoder, err := aacpcm.NewFrameEncoder(aacpcm.Config{SampleRate: rate, Channels: channels, BitDepth: depth, Bitrate: 128000})
	if err != nil {
		return err
	}
	audio.Mdia.Mdhd.Timescale = uint32(rate)
	if err := audio.SetAACDescriptorWithChannelConfig(2, byte(channels), rate); err != nil {
		return err
	}
	var dts uint64
	emit := func(data []byte, count int) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		err := fragment.AddFullSampleToTrack(mp4.FullSample{Sample: mp4.Sample{Flags: 0x02000000, Dur: uint32(count), Size: uint32(len(data))},
			DecodeTime: dts, Data: bytes.Clone(data)}, audio.Tkhd.TrackID)
		dts += uint64(count)
		return err
	}
	if err := encoder.EncodeInterleaved(pcmData, emit); err != nil {
		return err
	}
	if err := encoder.Flush(emit); err != nil {
		return err
	}
	audio.Tkhd.Duration, audio.Mdia.Mdhd.Duration = duration, dts
	edits := &mp4.EdtsBox{}
	edits.AddChild(&mp4.ElstBox{Entries: []mp4.ElstEntry{{SegmentDuration: duration, MediaTime: int64(encoder.Delay()), MediaRateInteger: 1}}})
	audio.AddChild(edits)
	return nil
}
