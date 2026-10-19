# screen-recorder

A small, free, open-source screen recorder for macOS, in the spirit of Screen Studio. You record a display, a window or an area from a floating bar, then save the clip or polish it in an editor.

## Status

Early and macOS only. Recording, pause, restart, the recording preview and Save work. The editor is bare bones for now (play and scrub the recording in the default look): it can't export yet, and there's no audio or camera recording yet.

## Requirements

- macOS 15 or later. The capture code is built against macOS 15 APIs (`macos_15_0` in `src-tauri/Cargo.toml`). It's developed and tested on macOS 26 on Apple silicon.
- Xcode Command Line Tools: `xcode-select --install`.
- Rust, through [rustup](https://rustup.rs). The crate uses the 2024 edition, so you need Rust 1.85 or later.
- [bun](https://bun.sh).

## Run it

```sh
bun install
bun tauri dev
```

The app opens to the record bar at the bottom of your screen. There's no main window.

To test anything involving permissions, build a debug app instead with `bun tauri build --debug`. It's signed with a local certificate named `screen-recorder dev` (`bundle.macOS.signingIdentity` in `src-tauri/tauri.conf.json`), so macOS keeps your permission between rebuilds. Make a self-signed code-signing certificate with that name in Keychain Access, or change the field.

## Check it

```sh
bun run check
```

This runs every check: `tsc`, ESLint, Prettier, `bun test`, `cargo fmt`, Clippy, `cargo test`, and a guard that fails if the generated bindings are stale. Smaller scripts: `bun run lint`, `bun run test`, `bun run format`.

The TypeScript types in `src/lib/bindings.ts` are generated from the Rust types by ts-rs. After you change a Rust type the frontend uses, run `bun run bindings` and commit the result.

## Permissions

- Screen Recording. macOS asks the first time the app reads the screen, when you pick a mode. If it's off, the record bar shows the error. Turn it on in System Settings, Privacy & Security, Screen & System Audio Recording.
- That's all. The cursor log polls the cursor position, which needs no Accessibility or Input Monitoring permission. Listing cameras and microphones needs no permission either. The microphone and camera will ask once audio and camera recording are built.

## Where things go

Recordings wait in app storage, at `~/Library/Application Support/com.aidankmcalister.screen-recorder/recordings/`. Nothing lands in your folders unless you press Save, which puts one `.mp4` in `~/Downloads`. Closing the preview or editor deletes the copy in app storage.

## How it's organized

```
src/                     the frontend (React, TypeScript, Tailwind)
  main.tsx               one entry for every window; picks a component by window label
  bar/                   the record bar: mode, devices, settings, the recording timer
  picker/                the overlays: highlight, Area box, capture bar
  preview/               the recording preview card and its Save, Copy and Edit
  editor/                the editor: stage and timeline; look and region logic in edits.ts
  components/            shared looks (Pill, MorphPill)
    ui/                  shadcn components on Base UI
  hooks/                 shared React hooks (Tauri events, pointer hover, morph, video clock)
  lib/                   shared logic (geometry, time) and bindings.ts, generated from Rust

src-tauri/src/           the Rust side
  lib.rs                 entry point: state, window setup, page events, system-wide keys, the command list
  recording.rs           the recording status, start, pause, restart, stop
  current_recording.rs   the recording you just made: save, copy, edit, close, and which window shows
  capture/               ScreenCaptureKit capture to a crash-safe .mov, the pause timeline, the cursor log
  picker/                the picker session, its sources and the overlay windows
  windows/               the record bar, preview and editor windows; floating.rs shows, hides and places them
  macos/                 AppKit wrappers: main thread, panels, alerts, and the glass
  geometry.rs            points and rectangles, top-left and bottom-left
  util.rs                small shared helpers and the error type commands return
```

Inside each frontend feature, the file name says what a file is, and the split matters:

- `name.ts` is plain logic and the typed wrappers for Rust commands. No React.
- `useName.ts` holds React state and actions, built on the logic.
- `Name.tsx` is looks only. A component calls a hook and decides how things look.

So a redesign touches the `.tsx` files and nothing else.

## Words

The project uses its own names for things (record bar, capture bar, frame, current recording and so on). [GLOSSARY.md](GLOSSARY.md) lists them.
