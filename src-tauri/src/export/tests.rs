use super::*;

#[test]
fn placement_moves_the_frame_onto_its_rectangle_from_the_bottom() {
    let rect = PixelRect {
        x: 10.0,
        y: 20.0,
        width: 200.0,
        height: 100.0,
    };
    let place = placement(&rect, 300, CGSize::new(400.0, 200.0));
    assert_eq!((place.a, place.d), (0.5, 0.5));
    assert_eq!((place.tx, place.ty), (10.0, 180.0));
}

#[test]
fn zooming_grows_the_recording_about_its_focus() {
    let rect = PixelRect {
        x: 100.0,
        y: 50.0,
        width: 200.0,
        height: 100.0,
    };
    let middle = zoomed(
        &rect,
        &rect,
        ExportZoom {
            scale: 1.5,
            ..NO_ZOOM
        },
    );
    assert_eq!((middle.x, middle.y), (50.0, 25.0));
    assert_eq!((middle.width, middle.height), (300.0, 150.0));
    let corner = zoomed(
        &rect,
        &rect,
        ExportZoom {
            scale: 2.0,
            x: 0.0,
            y: 1.0,
        },
    );
    assert_eq!((corner.x, corner.y), (100.0, -50.0));
}

#[test]
fn the_zoom_is_read_at_the_nearest_step_and_holds_past_the_end() {
    let step = |scale| ExportZoom { scale, ..NO_ZOOM };
    let zoom = [step(1.0), step(1.2), step(1.5)];
    assert_eq!(zoom_at(&zoom, 0.02), step(1.2));
    assert_eq!(zoom_at(&zoom, 10.0), step(1.5));
    assert_eq!(zoom_at(&[], 1.0), NO_ZOOM);
}

#[test]
#[ignore = "needs a real video"]
fn exports_a_recording_in_the_default_appearance() {
    let video = std::env::var("EXPORT_TEST_VIDEO").expect("EXPORT_TEST_VIDEO");
    let output = std::env::var("EXPORT_TEST_OUTPUT").expect("EXPORT_TEST_OUTPUT");
    let (video_width, video_height): (f64, f64) = (
        std::env::var("EXPORT_TEST_WIDTH").unwrap().parse().unwrap(),
        std::env::var("EXPORT_TEST_HEIGHT")
            .unwrap()
            .parse()
            .unwrap(),
    );
    let ratio = video_width / video_height;
    let even = |value: f64| ((value / 2.0).round() * 2.0) as u32;
    let width = even(video_width / (1.0 - 2.0 * 64.0 / 1920.0 * ratio.max(1.0)));
    let height = even(f64::from(width) / ratio);
    let scale = f64::from(width) / 1920.0;
    let layout = ExportLayout {
        width,
        height,
        recording: PixelRect {
            x: ((f64::from(width) - video_width) / 2.0).round(),
            y: ((f64::from(height) - video_height) / 2.0).round(),
            width: video_width,
            height: video_height,
        },
        video: {
            let inset: f64 =
                std::env::var("EXPORT_TEST_INSET").map_or(0.0, |inset| inset.parse().unwrap());
            PixelRect {
                x: ((f64::from(width) - video_width) / 2.0).round() - inset,
                y: ((f64::from(height) - video_height) / 2.0).round() - inset,
                width: video_width + inset * 2.0,
                height: video_height + inset * 2.0,
            }
        },
        border: std::env::var("EXPORT_TEST_BORDER")
            .ok()
            .map(|width| ExportBorder {
                width: width.parse().unwrap(),
                color: "#ffffff".into(),
                opacity: 0.35,
            }),
        radius: 20.0 * scale,
        shadow: ExportShadow {
            offset_y: 16.0 * scale,
            blur: 48.0 * scale,
            opacity: 0.4,
        },
        background: ExportGradient {
            angle: 135.0,
            stops: vec![
                ExportStop {
                    color: "#0f4c5c".into(),
                    at: 0.0,
                },
                ExportStop {
                    color: "#2a9d8f".into(),
                    at: 0.55,
                },
                ExportStop {
                    color: "#e9c46a".into(),
                    at: 1.0,
                },
            ],
        },
        zoom: (0..180)
            .map(|step| ExportZoom {
                scale: if (60..120).contains(&step) { 1.5 } else { 1.0 },
                ..NO_ZOOM
            })
            .collect(),
        speed: std::env::var("EXPORT_TEST_SPEED").map_or(vec![], |amount| {
            vec![ExportSpeed {
                start: 1.0,
                end: 2.0,
                amount: amount.parse().unwrap(),
            }]
        }),
        cuts: std::env::var("EXPORT_TEST_CUT").map_or(vec![], |_| {
            vec![ExportCut {
                start: 3.0,
                end: 4.0,
            }]
        }),
        rings: vec![],
        cursor: std::env::var("EXPORT_TEST_CURSOR")
            .ok()
            .map(|path| serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()),
    };
    let var = |name: &str, or: &str| std::env::var(name).unwrap_or(or.into());
    let options = ExportOptions {
        format: if var("EXPORT_TEST_FORMAT", "mp4") == "gif" {
            ExportFormat::Gif
        } else {
            ExportFormat::Mp4
        },
        frame_rate: var("EXPORT_TEST_FPS", "60").parse().unwrap(),
        bits_per_pixel: var("EXPORT_TEST_BITS", "8").parse().unwrap(),
        to_clipboard: false,
    };
    export(
        Path::new(&video),
        Path::new(&output),
        &layout,
        &options,
        |_| {},
    )
    .unwrap();
    assert!(Path::new(&output).exists());
}

#[test]
#[ignore = "needs a real video"]
fn saves_a_recording_as_mp4_with_one_mixed_sound_track() {
    let video = std::env::var("EXPORT_TEST_VIDEO").expect("EXPORT_TEST_VIDEO");
    let output = std::env::var("EXPORT_TEST_OUTPUT").expect("EXPORT_TEST_OUTPUT");
    to_mp4(Path::new(&video), Path::new(&output)).unwrap();
    assert!(Path::new(&output).exists());
}

#[test]
fn speed_is_applied_latest_first_so_earlier_spans_keep_their_times() {
    let span = |start| ExportSpeed {
        start,
        end: start + 1.0,
        amount: 2.0,
    };
    let order: Vec<f64> = latest_first(&[span(1.0), span(5.0), span(3.0)], |span| span.start)
        .iter()
        .map(|span| span.start)
        .collect();
    assert_eq!(order, [5.0, 3.0, 1.0]);
}

#[test]
fn a_frame_after_a_cut_reads_the_zoom_from_after_the_cut() {
    let cuts = [
        ExportCut {
            start: 1.0,
            end: 2.0,
        },
        ExportCut {
            start: 4.0,
            end: 4.5,
        },
    ];
    assert_eq!(uncut(&cuts, 0.5), 0.5);
    assert_eq!(uncut(&cuts, 1.0), 2.0);
    assert_eq!(uncut(&cuts, 3.5), 5.0);
}
