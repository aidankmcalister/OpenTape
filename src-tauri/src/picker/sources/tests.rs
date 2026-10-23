use super::*;

fn display(id: u32, x: f64) -> DisplayInfo {
    DisplayInfo {
        id,
        name: format!("Display {id}"),
        frame: Frame {
            x,
            y: 0.0,
            width: 1000.0,
            height: 800.0,
        },
        size: CaptureSize::of(cg::Rect::zero(), 2.0),
        scale: 2.0,
        safe_top: 0.0,
    }
}

fn window(id: u32, x: f64) -> WindowInfo {
    WindowInfo {
        id,
        pid: 1,
        app: "Notes".into(),
        frame: Frame {
            x,
            y: 50.0,
            width: 400.0,
            height: 300.0,
        },
        size: CaptureSize::of(cg::Rect::zero(), 2.0),
        display_id: None,
    }
}

fn two_displays_with(mut windows: Vec<WindowInfo>) -> Sources {
    let displays = vec![display(1, 0.0), display(2, 1000.0)];
    for window in &mut windows {
        window.display_id = display_at_center(&displays, window.frame);
    }
    Sources {
        displays,
        windows,
        icons: HashMap::new(),
    }
}

#[test]
fn framing_should_find_the_overlay_and_the_spot_a_recording_shows_in() {
    let windows = [1100.0, 700.0, 850.0, 5000.0];
    let windows = windows.iter().zip(1..).map(|(&x, id)| window(id, x));
    let session = Session::new(Mode::Window, two_displays_with(windows.collect()), None);
    let framed = |display_id, x| {
        let window = Frame {
            x,
            y: 50.0,
            width: 400.0,
            height: 300.0,
        };
        Some(Framing {
            display_id,
            window: Some(window),
        })
    };
    let area = Target::Area {
        display_id: 2,
        x: 10.0,
        y: 20.0,
        width: 300.0,
        height: 200.0,
    };
    let cases = [
        (Target::Window { window_id: 1 }, framed(2, 100.0)),
        (Target::Window { window_id: 2 }, framed(1, 700.0)),
        (Target::Window { window_id: 3 }, framed(2, -150.0)),
        (Target::Window { window_id: 4 }, None),
        (Target::Window { window_id: 5 }, None),
        (
            area,
            Some(Framing {
                display_id: 2,
                window: None,
            }),
        ),
        (Target::Display { display_id: 1 }, None),
    ];
    for (target, expected) in cases {
        assert_eq!(framing(&session, &target), expected, "{target:?}");
    }
}

#[test]
fn area_box_should_start_under_the_cursor_or_else_on_the_first_display() {
    let cursor = Some(Point { x: 1200.0, y: 5.0 });
    let under = Session::new(Mode::Area, two_displays_with(Vec::new()), cursor);
    assert_eq!(under.area_display_id, Some(2));
    let no_cursor = Session::new(Mode::Area, two_displays_with(Vec::new()), None);
    assert_eq!(no_cursor.area_display_id, Some(1));
}

#[test]
fn apply_safe_tops_should_match_screens_by_corner() {
    let mut displays = [display(1, 0.0), display(2, 1000.0)];
    let notched = SafeTop {
        x: 0.0,
        y: 0.0,
        inset: 38.0,
    };
    apply_safe_tops(&mut displays, &[notched]);
    assert_eq!(displays[0].safe_top, 38.0);
    assert_eq!(displays[1].safe_top, 0.0);
}

#[test]
fn sort_front_to_back_should_follow_the_stacking_order_and_put_unknown_windows_last() {
    let mut windows = vec![
        window(9, 0.0),
        window(1, 0.0),
        window(2, 0.0),
        window(3, 0.0),
    ];
    sort_front_to_back(&mut windows, &[3, 1, 2]);
    let ids: Vec<u32> = windows.iter().map(|window| window.id).collect();
    assert_eq!(ids, [3, 1, 2, 9]);
}

#[test]
fn is_pickable_should_skip_menus_hidden_and_tiny_windows() {
    let big = window(1, 0.0).frame;
    let tiny = Frame { width: 10.0, ..big };
    assert!(is_pickable(0, true, big));
    assert!(!is_pickable(25, true, big));
    assert!(!is_pickable(0, false, big));
    assert!(!is_pickable(0, true, tiny));
}
