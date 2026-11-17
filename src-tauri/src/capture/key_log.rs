//! Which shortcuts were pressed, for keystroke badges. Opt-in (Record keystrokes), needs Input
//! Monitoring. What was typed is never kept: a key that types a character is logged as a time
//! alone, and password fields aren't read at all (macOS hides keys from listeners while secure
//! input is on, and the tap checks for it too).

use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, Sender},
    },
    thread::{self, JoinHandle},
};

use cidre::{cf, cg};

use super::timeline::host_time_now;

/// How often the tap's thread wakes to check for stop.
const STOP_CHECK_SECONDS: f64 = 0.1;

/// One key press: the host time and its caps, modifiers first, like ["⇧", "⌘", "P"].
/// A key that typed a character has no caps.
pub(super) struct Pressed {
    pub t: f64,
    pub caps: Vec<String>,
}

pub(super) struct KeyTap {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
    pub pressed: Receiver<Pressed>,
}

impl KeyTap {
    /// Starts listening, or gives None without Input Monitoring.
    pub(super) fn start() -> Option<Self> {
        if !cg::event::access::listen_preflight() {
            log::warn!(
                "Input Monitoring is off, so this recording logs when keys were pressed, not which"
            );
            return None;
        }
        let (pressed_tx, pressed) = mpsc::channel();
        let (ready_tx, ready_rx) = mpsc::channel();
        let stop = Arc::new(AtomicBool::new(false));
        let thread = {
            let stop = Arc::clone(&stop);
            thread::spawn(move || listen_until_stopped(pressed_tx, &stop, &ready_tx))
        };
        if !ready_rx.recv().unwrap_or(false) {
            log::warn!(
                "could not listen for keys, so this recording logs when keys were pressed, not which"
            );
            return None;
        }
        Some(Self {
            stop,
            thread: Some(thread),
            pressed,
        })
    }
}

impl Drop for KeyTap {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

fn listen_until_stopped(mut pressed: Sender<Pressed>, stop: &AtomicBool, ready: &Sender<bool>) {
    let tap = cg::EventTap::new(
        cg::EventTapLocation::Session,
        cg::EventTapPlacement::TailAppend,
        cg::EventTapOpts::LISTEN_ONLY,
        cg::EventType::KEY_DOWN.mask(),
        on_event,
        &raw mut pressed,
    );
    let Some(mut tap) = tap else {
        let _ = ready.send(false);
        return;
    };
    let Some(source) = tap.run_loop_src(0) else {
        let _ = ready.send(false);
        return;
    };
    cf::RunLoop::current().add_src(&source, cf::RunLoopMode::default());
    let _ = ready.send(true);
    while !stop.load(Ordering::Relaxed) {
        let _ = cf::RunLoop::run_in_mode(cf::RunLoopMode::default(), STOP_CHECK_SECONDS, false);
        // macOS turns off a tap that seems stuck; turn it back on.
        if !tap.is_enabled() {
            tap.set_enabled(true);
        }
    }
    tap.invalidate();
}

extern "C" fn on_event(
    _proxy: *mut cg::EventTapProxy,
    event_type: cg::EventType,
    event: &mut cg::Event,
    pressed: *mut Sender<Pressed>,
) -> Option<&cg::Event> {
    let is_typed = event_type == cg::EventType::KEY_DOWN && !event.is_kb_autorepeat();
    // SAFETY: Carbon's flag check takes no arguments and can be called from any thread.
    if is_typed && unsafe { IsSecureEventInputEnabled() } == 0 {
        let (code, flags) = (event.kb_key_code(), event.flags());
        let caps = if keeps_caps(code, flags) {
            let cap = key_cap(code, flags, typed_char(event));
            modifier_caps(flags).chain([cap]).collect()
        } else {
            Vec::new()
        };
        let pressed_key = Pressed {
            t: host_time_now(),
            caps,
        };
        // SAFETY: the Sender lives on the tap's thread until after the tap is invalidated.
        if let Some(pressed) = unsafe { pressed.as_ref() } {
            let _ = pressed.send(pressed_key);
        }
    }
    Some(event)
}

/// Only shortcuts (⌘ or ⌃ held) and keys that type nothing, like Esc and the arrows, keep their
/// caps. Letters, digits, symbols and Space are typing, also with ⇧ or ⌥ (⌥ types characters
/// like @ on many layouts), so a password typed outside a secure field never reaches the disk.
fn keeps_caps(code: cg::KeyCode, flags: cg::EventFlags) -> bool {
    let is_shortcut = flags.contains(cg::EventFlags::CMD) || flags.contains(cg::EventFlags::CTRL);
    is_shortcut || named_key(code).is_some_and(|name| name != "Space")
}

/// The character the key typed, from the current keyboard layout.
fn typed_char(event: &cg::Event) -> Option<char> {
    let mut chars = [0u16; 4];
    let mut length = 0usize;
    // SAFETY: the buffer holds `chars.len()` UTF-16 units and `length` is written back.
    unsafe {
        CGEventKeyboardGetUnicodeString(event, chars.len(), &raw mut length, chars.as_mut_ptr());
    }
    char::decode_utf16(chars[..length.min(chars.len())].iter().copied())
        .next()?
        .ok()
}

/// Held modifiers in the order macOS menus show them.
fn modifier_caps(flags: cg::EventFlags) -> impl Iterator<Item = String> {
    [
        (cg::EventFlags::CTRL, "⌃"),
        (cg::EventFlags::ALT, "⌥"),
        (cg::EventFlags::SHIFT, "⇧"),
        (cg::EventFlags::CMD, "⌘"),
    ]
    .into_iter()
    .filter(move |(flag, _)| flags.contains(*flag))
    .map(|(_, cap)| cap.to_owned())
}

/// The key's own cap. With ⇧, ⌃ or ⌥ held the typed character changes (⇧1 types "!"), so the
/// key's place on a US keyboard names it instead, the way macOS menus write ⇧⌘1.
fn key_cap(code: cg::KeyCode, flags: cg::EventFlags, typed: Option<char>) -> String {
    if let Some(name) = named_key(code) {
        return name.to_owned();
    }
    let changes_the_character = flags.contains(cg::EventFlags::SHIFT)
        || flags.contains(cg::EventFlags::CTRL)
        || flags.contains(cg::EventFlags::ALT);
    let typed = typed.filter(|typed| !typed.is_control() && !typed.is_whitespace());
    match (changes_the_character, typed, us_key(code)) {
        (false, Some(typed), _) | (true, Some(typed), None) => typed.to_uppercase().collect(),
        (_, _, Some(key)) => key.to_string(),
        (_, None, None) => format!("Key {code}"),
    }
}

fn named_key(code: cg::KeyCode) -> Option<&'static str> {
    Some(match code {
        36 | 76 => "↵",
        48 => "Tab",
        49 => "Space",
        51 => "⌫",
        53 => "Esc",
        117 => "⌦",
        123 => "←",
        124 => "→",
        125 => "↓",
        126 => "↑",
        115 => "Home",
        119 => "End",
        116 => "Page Up",
        121 => "Page Down",
        122 => "F1",
        120 => "F2",
        99 => "F3",
        118 => "F4",
        96 => "F5",
        97 => "F6",
        98 => "F7",
        100 => "F8",
        101 => "F9",
        109 => "F10",
        103 => "F11",
        111 => "F12",
        _ => return None,
    })
}

/// What a key prints on a US keyboard, by its place (macOS virtual key codes).
fn us_key(code: cg::KeyCode) -> Option<char> {
    const US_KEYS: &str = "ASDFHGZXCV\0BQWERYT123465=97-80]OU[IP\0LJ'K;\\,/NM.\0\0`";
    US_KEYS
        .chars()
        .nth(usize::from(code))
        .filter(|key| *key != '\0')
}

#[link(name = "Carbon", kind = "framework")]
unsafe extern "C" {
    fn IsSecureEventInputEnabled() -> u8;
}

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGEventKeyboardGetUnicodeString(
        event: *const cg::Event,
        max_length: usize,
        length: *mut usize,
        chars: *mut u16,
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    const NONE: cg::EventFlags = cg::EventFlags(0);

    fn caps(code: cg::KeyCode, flags: cg::EventFlags, typed: Option<char>) -> Vec<String> {
        modifier_caps(flags)
            .chain([key_cap(code, flags, typed)])
            .collect()
    }

    #[test]
    fn a_shortcut_should_list_its_modifiers_in_menu_order_then_the_key() {
        let shift_cmd = cg::EventFlags(cg::EventFlags::SHIFT.0 | cg::EventFlags::CMD.0);
        assert_eq!(caps(40, cg::EventFlags::CMD, Some('k')), ["⌘", "K"]);
        assert_eq!(caps(35, shift_cmd, Some('P')), ["⇧", "⌘", "P"]);
        let all = cg::EventFlags(
            cg::EventFlags::CMD.0
                | cg::EventFlags::SHIFT.0
                | cg::EventFlags::ALT.0
                | cg::EventFlags::CTRL.0,
        );
        assert_eq!(caps(40, all, Some('\u{b}')), ["⌃", "⌥", "⇧", "⌘", "K"]);
    }

    #[test]
    fn only_shortcuts_and_keys_that_type_nothing_should_keep_their_caps() {
        let shift_alt = cg::EventFlags(cg::EventFlags::SHIFT.0 | cg::EventFlags::ALT.0);
        assert!(keeps_caps(40, cg::EventFlags::CMD));
        assert!(keeps_caps(8, cg::EventFlags::CTRL));
        assert!(keeps_caps(53, NONE));
        assert!(keeps_caps(36, NONE));
        assert!(keeps_caps(123, cg::EventFlags::ALT));
        assert!(!keeps_caps(11, NONE));
        assert!(!keeps_caps(18, cg::EventFlags::SHIFT));
        assert!(!keeps_caps(37, cg::EventFlags::ALT));
        assert!(!keeps_caps(37, shift_alt));
        assert!(!keeps_caps(49, NONE));
    }

    #[test]
    fn a_held_modifier_should_name_the_key_by_its_place_not_the_character_it_typed() {
        let shift_cmd = cg::EventFlags(cg::EventFlags::SHIFT.0 | cg::EventFlags::CMD.0);
        assert_eq!(key_cap(18, shift_cmd, Some('!')), "1");
        assert_eq!(key_cap(34, cg::EventFlags::ALT, Some('ˆ')), "I");
        assert_eq!(key_cap(44, shift_cmd, Some('?')), "/");
    }

    #[test]
    fn without_modifiers_that_change_it_the_layout_should_name_the_key() {
        assert_eq!(key_cap(12, cg::EventFlags::CMD, Some('a')), "A");
        assert_eq!(key_cap(11, NONE, Some('b')), "B");
        assert_eq!(key_cap(10, NONE, Some('<')), "<");
        assert_eq!(key_cap(10, cg::EventFlags::SHIFT, Some('>')), ">");
    }

    #[test]
    fn keys_without_a_character_should_use_their_names_or_glyphs() {
        assert_eq!(key_cap(53, NONE, Some('\u{1b}')), "Esc");
        assert_eq!(key_cap(36, cg::EventFlags::CMD, Some('\r')), "↵");
        assert_eq!(key_cap(123, NONE, None), "←");
        assert_eq!(key_cap(49, NONE, Some(' ')), "Space");
        assert_eq!(key_cap(105, NONE, None), "Key 105");
    }

    #[test]
    fn the_us_table_should_match_the_virtual_key_codes() {
        let expected = [
            (0, 'A'),
            (1, 'S'),
            (8, 'C'),
            (9, 'V'),
            (11, 'B'),
            (12, 'Q'),
            (17, 'T'),
            (18, '1'),
            (22, '6'),
            (23, '5'),
            (24, '='),
            (25, '9'),
            (27, '-'),
            (29, '0'),
            (30, ']'),
            (33, '['),
            (35, 'P'),
            (37, 'L'),
            (39, '\''),
            (40, 'K'),
            (41, ';'),
            (42, '\\'),
            (43, ','),
            (44, '/'),
            (45, 'N'),
            (46, 'M'),
            (47, '.'),
            (50, '`'),
        ];
        for (code, key) in expected {
            assert_eq!(us_key(code), Some(key), "key code {code}");
        }
        assert_eq!(us_key(10), None);
        assert_eq!(us_key(36), None);
        assert_eq!(us_key(200), None);
    }
}
