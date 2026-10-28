# Contributing

Thanks for wanting to help. The project is early, so bug reports with clear steps and small fixes help most right now.

## Talk first

For a bug, open an issue with the bug template. For an idea or a bigger change, open an issue before writing code so we can agree on the approach. A pull request that arrives without a discussion might not fit the plan.

## Set up

You need:

- macOS 15 or later. The capture code is built against macOS 15 APIs (`macos_15_0` in `src-tauri/Cargo.toml`). It's developed and tested on macOS 26 on Apple silicon.
- Xcode Command Line Tools: `xcode-select --install`.
- Rust, through [rustup](https://rustup.rs). The crate uses the 2024 edition, so you need Rust 1.85 or later.
- [bun](https://bun.sh).
- [cargo-about](https://github.com/EmbarkStudios/cargo-about), only for `tauri build`: `cargo install cargo-about --locked --features cli`.

Then run it:

```sh
bun install
bun tauri dev
```

The app opens to the record bar at the bottom of your screen, with an icon in the menu bar. There's no main window; clicking the Dock icon or New recording in the menu brings the record bar back.

To work on the editor without recording first, run `bun run dev:editor`. It opens `~/Downloads/Screen Recorder test clip/recording.mov`, with the `events.jsonl` and `meta.json` beside it if they're there. `EDIT_VIDEO=latest bun run dev:editor` opens the newest video in Downloads instead, and `EDIT_VIDEO=/path/to/video.mp4 bun run dev:editor` opens any video.

To test anything involving permissions, build a debug app instead with `bun tauri build --debug`. It's signed with a local certificate named `screen-recorder dev` (`bundle.macOS.signingIdentity` in `src-tauri/tauri.conf.json`), so macOS keeps your permission between rebuilds. Make a self-signed code-signing certificate with that name in Keychain Access, or change the field. `bun tauri build` makes the app in `src-tauri/target/release/bundle/macos/`.

## Check it

Before opening a pull request, run:

```sh
bun run check
```

It must pass. It runs `tsc`, ESLint, Prettier, `bun test`, `cargo fmt`, Clippy, `cargo test`, and a guard that fails if the generated bindings are stale. Smaller scripts: `bun run lint`, `bun run test`, `bun run format`.

Every `tauri build` regenerates `src-tauri/THIRD-PARTY-NOTICES.txt`, the license notices of the npm packages, Rust crates and fonts that ship in the app, and bundles it. Run `bun run notices` after changing dependencies and commit the result.

The TypeScript types in `src/lib/bindings.ts` are generated from the Rust types by ts-rs. After you change a Rust type the frontend uses, run `bun run bindings` and commit the result.

## Permissions

- Screen Recording. While it's off, the record bar says so and opens System Settings, Privacy & Security, Screen & System Audio Recording for you. macOS applies it only after the app restarts, so the bar then offers Quit and Reopen.
- Microphone and Camera. macOS asks the first time you record with one chosen in the record bar. If you say no, the recording goes ahead without it, and for the microphone the bar says Microphone access is off. System audio needs nothing more than Screen Recording.
- Nothing else. The cursor log polls the cursor position and shape. It also reads macOS's count of key presses to note when a key was pressed (only the time, never which key), so the editor can suggest zooms and speed-ups where you typed. None of it needs Accessibility or Input Monitoring permission, and it stays with the recording on your Mac.

## Where things go

A recording waits in a hidden folder (`~/Library/Application Support/com.aidankmcalister.screen-recorder/recordings/`) only while the preview or editor shows it. Save in the preview, or Export in the editor, puts a file in `~/Downloads` (or the folder chosen in Settings). Closing either window deletes the hidden copy, and asks first if nothing was saved. If the app crashes, the next launch opens the last recording in the preview so it can still be saved. Quitting while recording stops the recording the way Stop does.

Warnings, errors and crashes go to a small log, `~/Library/Logs/com.aidankmcalister.screen-recorder/screen-recorder.log`, that stays on your Mac.

## How the code is laid out

```
src/                     the frontend (React, TypeScript, Tailwind)
  main.tsx               one entry for every window; picks a page by window label
  pages/                 one page per window: RecordBar, Picker, RecordingPreview, Editor, Settings
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
  settings.rs            app settings (settings.json) and the Settings window
  tray.rs                the menu-bar icon and its menu
  util.rs                small shared helpers and the error type commands return
```

[GLOSSARY.md](GLOSSARY.md) names things. Use those names in code, issues and pull requests. A few rules keep the code easy to change:

- Logic, state and looks live in separate folders: `lib/name.ts` is plain logic, `hooks/useName.ts` holds React state, and `components/Name.tsx` or `pages/Name.tsx` decides how it looks. Components never call Rust directly, so a redesign only touches `pages/` and `components/`.
- The top of `components/`, `hooks/` and `lib/` is shared by every window. A subfolder (`bar`, `picker`, `preview`, `editor`) belongs to one window. Import with `@/…` between folders and `./…` inside one.
- Colors and sizes come only from the design tokens in `src/index.css`. ESLint rejects raw colors and pixel font sizes in class names.
- Rust stays small and handles only what needs the OS: capture, windows and files. Everything else goes in TypeScript.

## Pull requests

- Keep each one to a single change, with a title that says what it does.
- Say how you tested it. Most changes need you to run the app, since screen capture can't run in CI.
- Don't commit recordings or anything from `temp/`.

By contributing, you agree that your contribution is licensed under the [MIT License](LICENSE), the same as the project. There's no CLA.
