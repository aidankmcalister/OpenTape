# screen-recorder

A small, free, open-source screen recorder for macOS, for demos, social posts and code videos. You record a display, a window or an area from a floating bar, then save the clip or polish it in an editor.

## What it does

- Record a display, a window or an area from a floating bar at the bottom of the screen, with the microphone and system audio. Pause and restart as you go.
- Preview the clip when you stop, then save it as an `.mp4`, copy it, or open it in the editor.
- Get suggested zooms where you clicked or typed, and speed-ups where you typed. Suggested zooms follow the cursor, and every suggestion is a block on the timeline you can keep, change or remove.
- Draw a smoothed cursor from the recorded cursor path. It tilts as it moves, comes in several styles or as the real macOS pointer, and can show click rings.
- Frame the recording on a gradient, color or picture background, with padding, rounded corners, shadow and border, at Auto, 16:9, 9:16, 1:1 or 4:5. A wide recording can fill a tall frame and keep the action in view.
- Cut and trim the recording, add zoom and speed blocks, set the microphone and system audio volume, undo and redo, and find any action with ⌘K.
- Export to MP4 or GIF at 720p, 1080p or 4K, 30 or 60 fps, to a file or the clipboard.

## Status

Early, unreleased and macOS only. Everything listed above works. Camera recording isn't built yet, and captions, annotations, blur, highlights and title cards are planned.

## Requirements

- macOS 15 or later. The capture code is built against macOS 15 APIs (`macos_15_0` in `src-tauri/Cargo.toml`). It's developed and tested on macOS 26 on Apple silicon.
- Xcode Command Line Tools: `xcode-select --install`.
- Rust, through [rustup](https://rustup.rs). The crate uses the 2024 edition, so you need Rust 1.85 or later.
- [bun](https://bun.sh).
- [cargo-about](https://github.com/EmbarkStudios/cargo-about), only for `tauri build`: `cargo install cargo-about --locked --features cli`.

## Run it

```sh
bun install
bun tauri dev
```

The app opens to the record bar at the bottom of your screen. There's no main window.

To work on the editor without recording first, run `bun run dev:editor`. It opens `~/Downloads/Screen Recorder test clip/recording.mov`, with the `events.jsonl` and `meta.json` beside it if they're there. `EDIT_VIDEO=latest bun run dev:editor` opens the newest video in Downloads instead, and `EDIT_VIDEO=/path/to/video.mp4 bun run dev:editor` opens any video.

To test anything involving permissions, build a debug app instead with `bun tauri build --debug`. It's signed with a local certificate named `screen-recorder dev` (`bundle.macOS.signingIdentity` in `src-tauri/tauri.conf.json`), so macOS keeps your permission between rebuilds. Make a self-signed code-signing certificate with that name in Keychain Access, or change the field.

## Check it

```sh
bun run check
```

This runs every check: `tsc`, ESLint, Prettier, `bun test`, `cargo fmt`, Clippy, `cargo test`, and a guard that fails if the generated bindings are stale. Smaller scripts: `bun run lint`, `bun run test`, `bun run format`.

Every `tauri build` regenerates `src-tauri/THIRD-PARTY-NOTICES.txt`, the license notices of the npm packages, Rust crates and fonts that ship in the app, and bundles it. Run `bun run notices` after changing dependencies and commit the result.

The TypeScript types in `src/lib/bindings.ts` are generated from the Rust types by ts-rs. After you change a Rust type the frontend uses, run `bun run bindings` and commit the result.

## Permissions

- Screen Recording. macOS asks the first time the app reads the screen, when you pick a mode. If it's off, the record bar shows the error. Turn it on in System Settings, Privacy & Security, Screen & System Audio Recording.
- Microphone. macOS asks the first time you record with a microphone chosen in the record bar. System audio needs nothing more than Screen Recording.
- Nothing else. The cursor log polls the cursor position and shape, and notes when a key was pressed (only the time, never which key, read from macOS's count of key presses) so the editor can suggest zooms and speed-ups where you typed. None of it needs Accessibility or Input Monitoring permission, and it stays with the recording on your Mac. Listing cameras and microphones needs no permission either. The camera will ask once camera recording is built.

## Where things go

The app doesn't keep recordings. A recording waits in a hidden folder (`~/Library/Application Support/com.aidankmcalister.screen-recorder/recordings/`) only while the preview or editor shows it. Save in the preview, or Export in the editor, puts a file in `~/Downloads` (or the folder chosen in Settings); closing either window deletes the hidden copy, after asking if nothing was saved. If the app crashes, the next launch opens the last recording in the preview so it can still be saved.

## How it's organized

```
src/                     the frontend (React, TypeScript, Tailwind)
  main.tsx               one entry for every window; picks a page by window label
  pages/                 one page per window: RecordBar, Picker, RecordingPreview, Editor
  components/            looks: shared ones at the top (Pill, MorphPill)
    ui/                  shadcn components on Base UI
    picker/ editor/ …    pieces that belong to one window
  hooks/                 state: shared hooks at the top (Tauri events, pointer hover, morph, video clock)
    bar/ picker/ …       hooks that belong to one window
  lib/                   logic: shared at the top (geometry, time) and bindings.ts, generated from Rust
    bar/ picker/ …       logic that belongs to one window, with its tests; editor/ splits the editor by concept: appearance, cursor, clips, regions, zoom, sound, export, project

src-tauri/src/           the Rust side
  lib.rs                 entry point: state, window setup, page events, system-wide keys, the command list
  recording.rs           the recording status, start, pause, restart, stop
  current_recording.rs   the recording you just made: save, copy, edit, close, and which window shows
  capture/               ScreenCaptureKit capture to a crash-safe .mov, the pause timeline, the cursor log
  export/                the editor's export: framing, zoom, cursor, click rings, sound mix, and typing spots
  picker/                the picker session, its sources and the overlay windows
  windows/               the record bar, preview and editor windows; floating.rs shows, hides and places them
  macos/                 AppKit wrappers: main thread, panels, alerts, and the glass
  geometry.rs            points and rectangles, top-left and bottom-left
  settings.rs            app settings (settings.json)
  util.rs                small shared helpers and the error type commands return
```

The folder says what kind of file it is:

- `lib/` is plain logic and the typed wrappers for Rust commands (`name.ts`). No React.
- `hooks/` holds React state and actions, built on the logic (`useName.ts`).
- `components/` and `pages/` are looks only (`Name.tsx`). A component calls a hook and decides how things look.

A redesign only touches `pages/` and `components/`.

The top of `components/`, `hooks/` and `lib/` is shared by every window. A subfolder (`bar`, `picker`, `preview`, `editor`) belongs to one window. A piece gets its own file when it's reused or will grow; otherwise it stays private in its parent's file. Import with `@/…` between folders and `./…` inside one.

## Words

The project uses its own names for things (record bar, capture bar, frame, current recording and so on). [GLOSSARY.md](GLOSSARY.md) lists them.

## Contributing

Bug reports and small fixes are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers how to set up, the rules the code follows, and what a pull request needs.

## License

[MIT](LICENSE). The bundled fonts, Space Grotesk and IBM Plex Mono, are under the SIL Open Font License 1.1.

Recording and editing are free and open source, and will stay that way. Some optional extras may cost money one day, such as pro export formats or extra effect packs. Nothing that's free would move behind a paywall.
