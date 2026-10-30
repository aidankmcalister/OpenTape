use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::ptr::NonNull;

use anyhow::{Context, Result, ensure};
use objc2::runtime::AnyObject;
use objc2_av_foundation::{AVAssetReader, AVAssetReaderAudioMixOutput, AVURLAsset};
use objc2_avf_audio::{
    AVFormatIDKey, AVLinearPCMBitDepthKey, AVLinearPCMIsBigEndianKey, AVLinearPCMIsFloatKey,
    AVLinearPCMIsNonInterleaved, AVNumberOfChannelsKey, AVSampleRateKey,
};
use objc2_core_media::{CMTimeRange, kCMTimeZero};
use objc2_foundation::{NSDictionary, NSNumber, NSString};
use serde::Serialize;
use ts_rs::TS;

use crate::export::{audio_tracks, file_url, read_all, reason, seconds};

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings.ts")]
pub(crate) struct VideoTrack {
    codec: String,
    description: Vec<u8>,
    width: u32,
    height: u32,
    duration_ms: f64,
    samples: Vec<VideoSample>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings.ts")]
pub(crate) struct VideoSample {
    ms: f64,
    is_key: bool,
    size: u32,
    #[serde(skip)]
    #[ts(skip)]
    offset: u64,
}

const HIGHEST_LEVEL: u8 = 51;

struct Atom<'a> {
    kind: [u8; 4],
    body: &'a [u8],
}

fn atoms(mut bytes: &[u8]) -> impl Iterator<Item = Atom<'_>> {
    std::iter::from_fn(move || {
        let (size, header) = match u32_at(bytes, 0)? {
            1 => (usize::try_from(u64_at(bytes, 8)?).ok()?, 16),
            0 => (bytes.len(), 8),
            size => (size as usize, 8),
        };
        let atom = Atom {
            kind: bytes.get(4..8)?.try_into().ok()?,
            body: bytes.get(header..size)?,
        };
        bytes = &bytes[size..];
        Some(atom)
    })
}

fn child<'a>(bytes: &'a [u8], path: &[&[u8; 4]]) -> Option<&'a [u8]> {
    path.iter().try_fold(bytes, |inside, kind| {
        atoms(inside)
            .find(|atom| &atom.kind == *kind)
            .map(|atom| atom.body)
    })
}

fn u16_at(bytes: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_be_bytes(bytes.get(at..at + 2)?.try_into().ok()?))
}

fn u32_at(bytes: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_be_bytes(bytes.get(at..at + 4)?.try_into().ok()?))
}

fn u64_at(bytes: &[u8], at: usize) -> Option<u64> {
    Some(u64::from_be_bytes(bytes.get(at..at + 8)?.try_into().ok()?))
}

fn table(bytes: Option<&[u8]>, skip: usize, width: usize) -> Vec<&[u8]> {
    let Some(count) = bytes.and_then(|bytes| u32_at(bytes, skip - 4)) else {
        return Vec::new();
    };
    (0..count as usize)
        .map_while(|row| bytes?.get(skip + row * width..skip + (row + 1) * width))
        .collect()
}

struct Movie {
    moov: Vec<u8>,
    fragments: Vec<(u64, Vec<u8>)>,
    length: u64,
    is_cut: bool,
}

fn movie(file: &mut File) -> Result<Movie> {
    let length = file.metadata()?.len();
    let mut movie = Movie {
        moov: Vec::new(),
        fragments: Vec::new(),
        length,
        is_cut: false,
    };
    let mut at = 0;
    while length - at >= 8 {
        let mut header = [0u8; 16];
        file.seek(SeekFrom::Start(at))?;
        file.read_exact(&mut header[..8])?;
        let size = match u32_at(&header, 0).unwrap_or(0) {
            0 => length - at,
            1 => file
                .read_exact(&mut header[8..])
                .ok()
                .and_then(|()| u64_at(&header, 8))
                .unwrap_or(0),
            size => u64::from(size),
        };
        if size < 8 || size > length - at {
            movie.is_cut = true;
            break;
        }
        if matches!(&header[4..8], b"moov" | b"moof") {
            let mut bytes = vec![0; usize::try_from(size)?];
            file.seek(SeekFrom::Start(at))?;
            file.read_exact(&mut bytes)?;
            if &header[4..8] == b"moov" {
                movie.moov = bytes;
            } else {
                movie.fragments.push((at, bytes));
            }
        }
        at += size;
    }
    ensure!(!movie.moov.is_empty(), "the recording has no movie header");
    Ok(movie)
}

pub(crate) fn video_track(video: &Path) -> Result<VideoTrack> {
    let movie = movie(&mut File::open(video)?)?;
    let moov = child(&movie.moov, &[b"moov"]).context("the recording is damaged")?;
    let trak = traks(moov, &[b"vide"])
        .next()
        .context("the recording has no video")?;
    let stbl = child(trak, &[b"mdia", b"minf", b"stbl"]).context("the video is damaged")?;
    let entry = child(stbl, &[b"stsd"])
        .and_then(|stsd| stsd.get(8..))
        .context("the video has no format")?;
    ensure!(entry.get(4..8) == Some(b"avc1"), "the video isn't H.264");
    let description = entry
        .get(86..)
        .and_then(|boxes| child(boxes, &[b"avcC"]))
        .context("the video has no H.264 settings")?;
    let codec = description
        .get(1..4)
        .map(|profile| {
            format!(
                "avc1.{:02x}{:02x}{:02x}",
                profile[0],
                profile[1],
                profile[2].min(HIGHEST_LEVEL)
            )
        })
        .context("the H.264 settings are damaged")?;

    let (movie_scale, length_ms) = movie_time(moov)?;
    let (samples, end_ms) = track_samples(&movie, trak, movie_scale)?;
    Ok(VideoTrack {
        codec,
        description: description.to_vec(),
        width: u32::from(u16_at(entry, 32).unwrap_or(0)),
        height: u32::from(u16_at(entry, 34).unwrap_or(0)),
        duration_ms: length_ms.max(end_ms),
        samples,
    })
}

fn traks<'a>(moov: &'a [u8], kinds: &'a [&[u8; 4]]) -> impl Iterator<Item = &'a [u8]> {
    atoms(moov)
        .filter(|atom| &atom.kind == b"trak")
        .map(|trak| trak.body)
        .filter(|trak| {
            let kind = child(trak, &[b"mdia", b"hdlr"]).and_then(|hdlr| hdlr.get(8..12));
            kinds.iter().any(|wanted| kind == Some(&wanted[..]))
        })
}

fn movie_time(moov: &[u8]) -> Result<(f64, f64)> {
    let mvhd = child(moov, &[b"mvhd"]).context("the recording is damaged")?;
    let (scale, length) = match mvhd.first() {
        Some(1) => (u32_at(mvhd, 20), u64_at(mvhd, 24)),
        _ => (u32_at(mvhd, 12), u32_at(mvhd, 16).map(u64::from)),
    };
    let scale = f64::from(scale.context("the recording is damaged")?);
    ensure!(scale > 0.0, "the recording is damaged");
    Ok((scale, length.unwrap_or(0) as f64 / scale * 1000.0))
}

fn track_samples(movie: &Movie, trak: &[u8], movie_scale: f64) -> Result<(Vec<VideoSample>, f64)> {
    let stbl = child(trak, &[b"mdia", b"minf", b"stbl"]).context("the video is damaged")?;
    let mdhd = child(trak, &[b"mdia", b"mdhd"]).context("the video is damaged")?;
    let tkhd = child(trak, &[b"tkhd"]).context("the video is damaged")?;
    let wide = |header: &[u8]| if header.first() == Some(&1) { 20 } else { 12 };
    let scale = f64::from(u32_at(mdhd, wide(mdhd)).context("the video is damaged")?);
    let id = u32_at(tkhd, wide(tkhd)).context("the video is damaged")?;
    ensure!(scale > 0.0, "the video is damaged");
    let shift_ms = edit_shift_ms(child(trak, &[b"edts", b"elst"]), movie_scale, scale);
    let decoded = runs(child(stbl, &[b"stts"])).map(u64::from).sum();
    let mut samples = samples(stbl, scale, shift_ms)?;
    let (more, end_ms) = fragments(movie, id, decoded, scale, shift_ms);
    samples.extend(more);
    Ok((samples, end_ms))
}

fn samples(stbl: &[u8], scale: f64, shift_ms: f64) -> Result<Vec<VideoSample>> {
    let sizes = child(stbl, &[b"stsz"]).context("the video has no sample sizes")?;
    let count = u32_at(sizes, 8).unwrap_or(0) as usize;
    let sizes: Vec<u32> = match u32_at(sizes, 4) {
        Some(0) => table(Some(sizes), 12, 4)
            .iter()
            .filter_map(|row| u32_at(row, 0))
            .collect(),
        Some(same) => vec![same; count],
        None => Vec::new(),
    };
    let offsets = offsets(stbl, &sizes)?;
    let keys: Option<Vec<usize>> = child(stbl, &[b"stss"]).map(|stss| {
        table(Some(stss), 8, 4)
            .iter()
            .filter_map(|row| Some(u32_at(row, 0)?.checked_sub(1)? as usize))
            .collect()
    });
    let mut shifts = runs(child(stbl, &[b"ctts"])).map(|shift| shift as i32);
    let mut decoded = 0u64;
    Ok(sizes
        .iter()
        .zip(offsets)
        .zip(runs(child(stbl, &[b"stts"])))
        .enumerate()
        .map(|(index, ((&size, offset), step))| {
            let shown = decoded as f64 + f64::from(shifts.next().unwrap_or(0));
            decoded += u64::from(step);
            VideoSample {
                ms: shown / scale * 1000.0 + shift_ms,
                is_key: keys
                    .as_ref()
                    .is_none_or(|keys| keys.binary_search(&index).is_ok()),
                size,
                offset,
            }
        })
        .collect())
}

fn fragments(
    movie: &Movie,
    track: u32,
    mut decoded: u64,
    scale: f64,
    shift_ms: f64,
) -> (Vec<VideoSample>, f64) {
    let mvex = child(&movie.moov, &[b"moov", b"mvex"]).unwrap_or_default();
    let mut samples = Vec::new();
    let mut end_ms = 0.0f64;
    for (start, moof) in &movie.fragments {
        let mut data_end = *start;
        let trafs = atoms(child(moof, &[b"moof"]).unwrap_or_default());
        for traf in trafs.filter(|atom| &atom.kind == b"traf") {
            let tfhd = child(traf.body, &[b"tfhd"]).unwrap_or_default();
            let flags = u32_at(tfhd, 0).unwrap_or(0);
            let id = u32_at(tfhd, 4).unwrap_or(0);
            let trex = atoms(mvex)
                .find(|trex| &trex.kind == b"trex" && u32_at(trex.body, 4) == Some(id))
                .map_or(&[][..], |trex| trex.body);
            let mut at = 8;
            let [base, _, duration, size, sample_flags] = flagged(
                tfhd,
                &mut at,
                flags,
                [(0x1, 8), (0x2, 4), (0x8, 4), (0x10, 4), (0x20, 4)],
            );
            let base = base.unwrap_or(if flags & 0x2_0000 == 0 {
                data_end
            } else {
                *start
            });
            let defaults = [
                duration.or(u32_at(trex, 12).map(u64::from)),
                size.or(u32_at(trex, 16).map(u64::from)),
                sample_flags.or(u32_at(trex, 20).map(u64::from)),
            ];
            let mut decode = child(traf.body, &[b"tfdt"])
                .and_then(|tfdt| match tfdt.first() {
                    Some(1) => u64_at(tfdt, 4),
                    _ => u32_at(tfdt, 4).map(u64::from),
                })
                .unwrap_or(decoded);
            data_end = base;
            for trun in atoms(traf.body).filter(|atom| &atom.kind == b"trun") {
                let trun = trun.body;
                let flags = u32_at(trun, 0).unwrap_or(0);
                let mut at = 8;
                let [offset, first_flags] = flagged(trun, &mut at, flags, [(0x1, 4), (0x4, 4)]);
                if let Some(offset) = offset {
                    data_end = base.saturating_add_signed(i64::from(offset as u32 as i32));
                }
                for index in 0..u32_at(trun, 4).unwrap_or(0) {
                    let [duration, size, sample_flags, shift] = flagged(
                        trun,
                        &mut at,
                        flags,
                        [(0x100, 4), (0x200, 4), (0x400, 4), (0x800, 4)],
                    );
                    if at > trun.len() {
                        break;
                    }
                    let duration = duration.or(defaults[0]).unwrap_or(0);
                    let size = size.or(defaults[1]).unwrap_or(0);
                    let sample_flags = first_flags
                        .filter(|_| index == 0)
                        .or(sample_flags)
                        .or(defaults[2])
                        .unwrap_or(0);
                    let shown = decode as f64 + f64::from(shift.unwrap_or(0) as u32 as i32);
                    if id == track && data_end.saturating_add(size) <= movie.length {
                        samples.push(VideoSample {
                            ms: shown / scale * 1000.0 + shift_ms,
                            is_key: sample_flags & 0x1_0000 == 0,
                            size: size as u32,
                            offset: data_end,
                        });
                        end_ms = end_ms.max((shown + duration as f64) / scale * 1000.0 + shift_ms);
                    }
                    data_end = data_end.saturating_add(size);
                    decode += duration;
                }
            }
            if id == track {
                decoded = decode;
            }
        }
    }
    (samples, end_ms)
}

fn flagged<const N: usize>(
    bytes: &[u8],
    at: &mut usize,
    flags: u32,
    fields: [(u32, usize); N],
) -> [Option<u64>; N] {
    fields.map(|(bit, width)| {
        if flags & bit == 0 {
            return None;
        }
        *at += width;
        match width {
            8 => u64_at(bytes, *at - 8),
            _ => u32_at(bytes, *at - 4).map(u64::from),
        }
    })
}

fn runs(bytes: Option<&[u8]>) -> impl Iterator<Item = u32> + '_ {
    table(bytes, 8, 8).into_iter().flat_map(|row| {
        std::iter::repeat_n(
            u32_at(row, 4).unwrap_or(0),
            u32_at(row, 0).unwrap_or(0) as usize,
        )
    })
}

fn offsets(stbl: &[u8], sizes: &[u32]) -> Result<Vec<u64>> {
    let chunks: Vec<u64> = match child(stbl, &[b"co64"]) {
        Some(co64) => table(Some(co64), 8, 8)
            .iter()
            .filter_map(|row| u64_at(row, 0))
            .collect(),
        None => table(child(stbl, &[b"stco"]), 8, 4)
            .iter()
            .filter_map(|row| u32_at(row, 0).map(u64::from))
            .collect(),
    };
    let runs: Vec<(usize, usize)> = table(child(stbl, &[b"stsc"]), 8, 12)
        .iter()
        .filter_map(|row| {
            let first = u32_at(row, 0)?.checked_sub(1)?;
            Some((first as usize, u32_at(row, 4)? as usize))
        })
        .collect();
    let mut offsets = Vec::with_capacity(sizes.len());
    for (chunk, &start) in chunks.iter().enumerate() {
        let per_chunk = runs
            .iter()
            .rev()
            .find(|(first, _)| *first <= chunk)
            .map_or(0, |run| run.1);
        let mut at = start;
        for _ in 0..per_chunk {
            let Some(&size) = sizes.get(offsets.len()) else {
                break;
            };
            offsets.push(at);
            at = at.saturating_add(u64::from(size));
        }
    }
    ensure!(
        offsets.len() == sizes.len(),
        "the video's sample table is damaged"
    );
    Ok(offsets)
}

fn edit_shift_ms(elst: Option<&[u8]>, movie_scale: f64, scale: f64) -> f64 {
    let wide = elst.and_then(|elst| elst.first()) == Some(&1);
    let edits = table(elst, 8, if wide { 20 } else { 12 });
    let mut shift_ms = 0.0;
    for edit in edits {
        let (length, start) = if wide {
            (
                u64_at(edit, 0).unwrap_or(0),
                u64_at(edit, 8).map_or(-1, |at| at as i64),
            )
        } else {
            (
                u64::from(u32_at(edit, 0).unwrap_or(0)),
                i64::from(u32_at(edit, 4).map_or(-1, |at| at as i32)),
            )
        };
        if start < 0 {
            shift_ms += length as f64 / movie_scale * 1000.0;
        } else {
            return shift_ms - start as f64 / scale * 1000.0;
        }
    }
    shift_ms
}

pub(crate) fn video_samples(video: &Path, from: usize, to: usize) -> Result<Vec<u8>> {
    let track = video_track(video)?;
    let samples = track
        .samples
        .get(from..to)
        .context("those frames aren't in the recording")?;
    let mut file = File::open(video)?;
    let length = file.metadata()?.len();
    ensure!(
        samples
            .iter()
            .all(|sample| sample.offset.saturating_add(u64::from(sample.size)) <= length),
        "the recording is cut short"
    );
    let mut bytes = Vec::with_capacity(samples.iter().map(|sample| sample.size as usize).sum());
    for sample in samples {
        file.seek(SeekFrom::Start(sample.offset))?;
        let start = bytes.len();
        bytes.resize(start + sample.size as usize, 0);
        file.read_exact(&mut bytes[start..])?;
    }
    Ok(bytes)
}

pub(crate) const SOUND_RATE: f64 = 48_000.0;
const CUT_MARGIN_MS: f64 = 250.0;

fn cut_end_ms(video: &Path) -> Result<Option<f64>> {
    let movie = movie(&mut File::open(video)?)?;
    if !movie.is_cut {
        return Ok(None);
    }
    let moov = child(&movie.moov, &[b"moov"]).context("the recording is damaged")?;
    let (movie_scale, _) = movie_time(moov)?;
    let ends = traks(moov, &[b"vide", b"soun"])
        .map(|trak| Ok(track_samples(&movie, trak, movie_scale)?.1))
        .collect::<Result<Vec<f64>>>()?;
    Ok(ends.into_iter().reduce(f64::min))
}

pub(crate) fn stage_sound(video: &Path) -> Result<Vec<u8>> {
    let asset = unsafe { AVURLAsset::URLAssetWithURL_options(&file_url(video), None) };
    let tracks = audio_tracks(&asset)?;
    if tracks.is_empty() {
        return Ok(Vec::new());
    }
    let reader = unsafe { AVAssetReader::assetReaderWithAsset_error(&asset) }.map_err(|error| {
        anyhow::anyhow!("could not read the recording: {}", reason(Some(error)))
    })?;
    let key =
        |key: Option<&'static NSString>| key.context("AVFoundation is missing an audio setting");
    let values = [
        NSNumber::new_u32(u32::from_be_bytes(*b"lpcm")),
        NSNumber::new_f64(SOUND_RATE),
        NSNumber::new_u32(2),
        NSNumber::new_u32(16),
        NSNumber::new_bool(false),
        NSNumber::new_bool(false),
        NSNumber::new_bool(false),
    ];
    let settings = NSDictionary::<NSString, AnyObject>::from_slices(
        &[
            key(unsafe { AVFormatIDKey })?,
            key(unsafe { AVSampleRateKey })?,
            key(unsafe { AVNumberOfChannelsKey })?,
            key(unsafe { AVLinearPCMBitDepthKey })?,
            key(unsafe { AVLinearPCMIsFloatKey })?,
            key(unsafe { AVLinearPCMIsBigEndianKey })?,
            key(unsafe { AVLinearPCMIsNonInterleaved })?,
        ],
        &values.each_ref().map(|value| value.as_ref()),
    );
    let output = unsafe {
        AVAssetReaderAudioMixOutput::assetReaderAudioMixOutputWithAudioTracks_audioSettings(
            &tracks,
            Some(&settings),
        )
    };
    unsafe { reader.addOutput(&output) };
    if let Some(end_ms) = cut_end_ms(video)?.filter(|ms| *ms > CUT_MARGIN_MS) {
        let end = seconds((end_ms - CUT_MARGIN_MS) / 1000.0);
        unsafe { reader.setTimeRange(CMTimeRange::new(kCMTimeZero, end)) };
    }
    let mut pcm = Vec::new();
    let read = read_all(&reader, || {
        while let Some(sample) = unsafe { output.copyNextSampleBuffer() } {
            let Some(block) = (unsafe { sample.data_buffer() }) else {
                continue;
            };
            let length = unsafe { block.data_length() };
            let start = pcm.len();
            pcm.resize(start + length, 0);
            let into = NonNull::from(&mut pcm[start..]).cast();
            let status = unsafe { block.copy_data_bytes(0, length, into) };
            ensure!(status == 0, "could not read the sound ({status})");
        }
        Ok(())
    });
    match read {
        Err(error) if pcm.is_empty() => Err(error),
        _ => Ok(pcm),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn atom(kind: &[u8; 4], body: &[u8]) -> Vec<u8> {
        let mut bytes = (8 + body.len() as u32).to_be_bytes().to_vec();
        bytes.extend_from_slice(kind);
        bytes.extend_from_slice(body);
        bytes
    }

    #[test]
    fn finds_nested_atoms_and_stops_at_a_short_one() {
        let inner = atom(b"stbl", &atom(b"stss", &[1, 2]));
        let outer = [atom(b"free", &[]), atom(b"minf", &inner)].concat();
        assert_eq!(
            child(&outer, &[b"minf", b"stbl", b"stss"]),
            Some(&[1u8, 2][..])
        );
        assert_eq!(child(&outer, &[b"minf", b"stco"]), None);
        assert_eq!(atoms(&[0, 0, 0, 20, b'f', b'r']).count(), 0);
    }

    #[test]
    fn places_each_sample_in_its_chunk() {
        let stsc = [
            [0u8, 0, 0, 0, 0, 0, 0, 2].as_slice(),
            &[0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 1],
            &[0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0, 1],
        ]
        .concat();
        let stco = [
            [0u8, 0, 0, 0, 0, 0, 0, 2].as_slice(),
            &[0, 0, 0, 100],
            &[0, 0, 1, 0],
        ]
        .concat();
        let stbl = [atom(b"stsc", &stsc), atom(b"stco", &stco)].concat();
        assert_eq!(offsets(&stbl, &[10, 20, 30]).unwrap(), vec![100, 110, 256]);
        assert!(offsets(&stbl, &[10, 20, 30, 40]).is_err());
        let from_chunk_zero = [&stsc[..8], &[0; 4], &stsc[12..20]].concat();
        let stbl = [atom(b"stsc", &from_chunk_zero), atom(b"stco", &stco)].concat();
        assert!(offsets(&stbl, &[10, 20]).is_err());
    }

    #[test]
    fn a_movie_header_longer_than_the_file_is_damaged() {
        let path = std::env::temp_dir().join(format!("stage-{}.mov", std::process::id()));
        let mut moov = atom(b"moov", &(1u64 << 62).to_be_bytes());
        moov[..4].copy_from_slice(&1u32.to_be_bytes());
        std::fs::write(&path, [atom(b"ftyp", &[0; 4]), moov].concat()).unwrap();
        let read = movie(&mut File::open(&path).unwrap());
        std::fs::remove_file(&path).unwrap();
        assert!(read.is_err());
    }

    fn full(kind: &[u8; 4], flags: u32, fields: &[u32]) -> Vec<u8> {
        let body: Vec<u8> = [flags]
            .iter()
            .chain(fields)
            .flat_map(|field| field.to_be_bytes())
            .collect();
        atom(kind, &body)
    }

    fn fragmented(trafs: &[Vec<u8>], length: u64) -> Movie {
        let trex = |id: u32| full(b"trex", 0, &[id, 1, 100, 10, 0x1_0000]);
        let mvex = atom(b"mvex", &[trex(1), trex(2)].concat());
        Movie {
            moov: atom(b"moov", &mvex),
            fragments: vec![(1000, atom(b"moof", &trafs.concat()))],
            length,
            is_cut: true,
        }
    }

    #[test]
    fn reads_fragment_samples_with_the_track_defaults() {
        let sound = atom(
            b"traf",
            &[full(b"tfhd", 0, &[2]), full(b"trun", 0x1, &[2, 40])].concat(),
        );
        let video = atom(
            b"traf",
            &[
                full(b"tfhd", 0, &[1]),
                full(b"tfdt", 0, &[500]),
                full(b"trun", 0x4, &[3, 0]),
            ]
            .concat(),
        );
        let (samples, end_ms) = fragments(&fragmented(&[sound, video], 5000), 1, 0, 1000.0, 0.0);
        let read: Vec<_> = samples
            .iter()
            .map(|sample| (sample.ms, sample.is_key, sample.size, sample.offset))
            .collect();
        assert_eq!(
            read,
            vec![
                (500.0, true, 10, 1060),
                (600.0, false, 10, 1070),
                (700.0, false, 10, 1080)
            ]
        );
        assert_eq!(end_ms, 800.0);
    }

    #[test]
    fn drops_fragment_samples_cut_off_by_the_end_of_the_file() {
        let rows = [
            [30, 10, 0, 60],
            [30, 20, 0x1_0000, 0],
            [30, 30, 0x1_0000, 0],
        ];
        let trun = full(
            b"trun",
            0xf00,
            &[[4].as_slice(), rows.as_flattened()].concat(),
        );
        let video = atom(b"traf", &[full(b"tfhd", 0x1, &[1, 0, 2000]), trun].concat());
        let (samples, end_ms) = fragments(&fragmented(&[video], 2040), 1, 900, 1000.0, 0.0);
        let read: Vec<_> = samples
            .iter()
            .map(|sample| (sample.ms, sample.is_key, sample.offset))
            .collect();
        assert_eq!(read, vec![(960.0, true, 2000), (930.0, false, 2010)]);
        assert_eq!(end_ms, 990.0);
    }

    #[test]
    fn keeps_whole_boxes_and_stops_at_a_cut_one() {
        let path = std::env::temp_dir().join(format!("stage-cut-{}.mov", std::process::id()));
        let moof = atom(b"moof", &[1; 8]);
        let cut = atom(b"mdat", &[0; 64]);
        let bytes = [atom(b"moov", &[]), moof.clone(), cut[..20].to_vec()].concat();
        std::fs::write(&path, bytes).unwrap();
        let read = movie(&mut File::open(&path).unwrap());
        std::fs::remove_file(&path).unwrap();
        let read = read.unwrap();
        assert_eq!(read.fragments, vec![(8, moof)]);
        assert_eq!(read.length, 44);
        assert!(read.is_cut);
    }

    #[test]
    fn an_empty_edit_delays_the_video_and_a_start_trims_it() {
        let elst = |rows: &[(u32, i32)]| {
            let mut bytes = vec![0, 0, 0, 0];
            bytes.extend((rows.len() as u32).to_be_bytes());
            for (length, start) in rows {
                bytes.extend(length.to_be_bytes());
                bytes.extend(start.to_be_bytes());
                bytes.extend(65_536u32.to_be_bytes());
            }
            bytes
        };
        let shift = |rows| edit_shift_ms(Some(&elst(rows)), 1000.0, 600.0);
        assert_eq!(shift(&[(500, -1), (9000, 0)]), 500.0);
        assert_eq!(shift(&[(9000, 60)]), -100.0);
        assert_eq!(edit_shift_ms(None, 1000.0, 600.0), 0.0);
    }

    #[test]
    #[ignore = "needs a real video"]
    fn reads_the_frames_of_a_real_recording() {
        let videos = std::env::var_os("STAGE_TEST_VIDEO").expect("STAGE_TEST_VIDEO");
        for video in std::env::split_paths(&videos) {
            reads_like_ffprobe(&video);
        }
    }

    fn reads_like_ffprobe(video: &Path) {
        let track = video_track(video).unwrap();
        let keys = track.samples.iter().filter(|sample| sample.is_key).count();
        println!(
            "{} {} {}x{} {:.0}ms, {} samples, {keys} keys, first {:?}",
            video.display(),
            track.codec,
            track.width,
            track.height,
            track.duration_ms,
            track.samples.len(),
            &track.samples[..6]
        );
        let probe = std::process::Command::new("ffprobe")
            .args(["-v", "quiet", "-select_streams", "v:0", "-show_entries"])
            .args(["packet=pts_time,flags", "-of", "csv=p=0"])
            .arg(video)
            .output()
            .unwrap();
        let probed: Vec<(f64, bool)> = String::from_utf8(probe.stdout)
            .unwrap()
            .lines()
            .filter_map(|line| {
                let (time, flags) = line.split_once(',')?;
                Some((time.parse::<f64>().ok()? * 1000.0, flags.starts_with('K')))
            })
            .collect();
        let cut_short = probed.len() - track.samples.len();
        println!(
            "ffprobe has {} packets, {cut_short} cut short",
            probed.len()
        );
        assert!(cut_short <= 1);
        for (sample, (ms, is_key)) in track.samples.iter().zip(&probed) {
            assert!((sample.ms - ms).abs() < 0.5, "{sample:?} {ms}");
            assert_eq!(sample.is_key, *is_key, "{sample:?}");
        }
        let last = track.samples.len();
        assert!(video_samples(video, last - 3, last).is_ok());
        assert!(track.samples[0].is_key);
        let bytes = video_samples(video, 0, 3).unwrap();
        let first = track.samples[0].size as usize;
        assert_eq!(
            bytes.len(),
            track.samples[..3]
                .iter()
                .map(|s| s.size as usize)
                .sum::<usize>()
        );
        let length = u32::from_be_bytes(bytes[..4].try_into().unwrap()) as usize;
        assert!(length < first, "{length} {first}");
        let sound = stage_sound(video).unwrap();
        let seconds = sound.len() as f64 / 4.0 / SOUND_RATE;
        println!("{seconds:.3}s of sound");
        assert!(
            (seconds * 1000.0 - track.duration_ms).abs() < 500.0,
            "{seconds}"
        );
    }
}
