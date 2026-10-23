# Glossary

The names this project uses for its own things. Code, docs and reviews use them. The code name is in brackets where it differs.

## The flow

- **Record bar** (`src/pages/RecordBar.tsx`, `windows/bar.rs`): the pill at the bottom center of the screen, just above the Dock. In setup it has Quit, the mode, camera and microphone, and Settings. While recording it shows the timer, Restart, Pause and Stop.
- **Mode:** what you're about to record: a display, a window or an area.
- **Picker** (`src/pages/Picker.tsx`, `picker/`): what opens after you choose a mode. It puts one overlay on each display and lets you point at the target.
- **Overlay:** the see-through window the picker places over one display. It draws the highlight or the Area box. Overlays are made once, then hidden and shown, never closed.
- **Picker session** (`Session`): what's being picked, sent whole from Rust to every overlay whenever it changes: the mode, the sources, the pinned window and the display holding the Area box. Rust works out each window's display and each display's scale once, so the overlays never derive them.
- **Sources:** the displays and on-screen windows the picker can pick from.
- **Highlight:** the orange outline on the display or window under the pointer, with everything else dimmed.
- **Pinned window:** a window chosen with Tab. It wins over the pointer until the pointer moves.
- **Area box** (`AreaBox`): the box you drag out in Area mode, with eight handles.
- **Capture bar** (`CaptureBar`): the pill on the highlighted target. It shows the capture tile, what will be recorded, its size in pixels, the Area's ratio chip, and Record. Every mode shares it.
- **Capture tile** (`CaptureTile`): the 40px square at the left of the capture bar: the window's app icon, or an icon for the mode.
- **Ratio chip** (`RatioChip`): the Area's control on the capture bar. Its menu locks the box to 16:9, 4:3, 1:1 or 9:16.
- **Safe top** (`safeTop`): how far down from a display's top things stay clear of the menu bar and the notch, in points. The capture bar and the ratio menu keep below it.
- **Target:** exactly what will be recorded: a display, a window, or an area of a display.
- **Record (a target):** the picker's last step. It closes the overlays and starts recording the target.
- **Frame:** while an area or a window records, the overlay on that display stays up as the frame. It's click-through, has no controls, and dims everything but what's recorded. Not to be confused with `geometry::Frame` (a rectangle in points, and the generated `Frame` type), a video frame, or the editor's framed recording (`frameLayout`, and appearance sizes measured on a 1920-wide frame).
- **Recording status** (`RecordingStatus`): the one copy of the recording's state, owned by Rust. It holds the phase, the time recorded and the last error. The record bar shows it and keeps no copy.
- **Phase:** where the recording is: idle, starting, recording, paused or stopping. `next_phase` in `recording.rs` decides which action is allowed when.
- **Pause:** frames captured while paused are left out, so the file plays straight through.
- **Pause timeline** (`capture/timeline.rs`): a recording's time with its pauses cut out, on the clock ScreenCaptureKit stamps frames with. The bar's timer and the video agree because both use it. Not the editor's timeline.
- **Restart:** throws away what's been recorded and records the same target again, after a native alert. It pauses while asking, so the alert never ends up in the recording.
- **Recording preview** (`src/pages/RecordingPreview.tsx`, `windows/preview.rs`): the card in the bottom-left corner after you stop. It loops the clip. Hover shows the clip dock. The record bar hides while it shows.
- **Clip dock** (`ClipDock`): the morph pill at the bottom of the preview. It holds Save, Copy and Edit, then morphs to Saving, Copied, Saved with Show in Finder, or an error.
- **Current recording** (`current_recording.rs`): the recording you've just made, named for when it started ("2026-10-16 07.41.28"). It waits in app storage while the preview and then the editor show it. It keeps, saves, copies, edits and closes itself, and each step decides which window shows: the bar, then the preview, then the editor. Save exports an `.mp4` to Downloads. Closing deletes the copy in app storage either way.
- **Close (the preview or editor):** one flow for both. It asks first with a native alert centered on the screen, unless the recording is saved, then brings the bar back and deletes the copy in app storage. The alert's choices depend on the window: the editor can't save yet.
- **Editor** (`src/pages/Editor.tsx`, `windows/editor.rs`): where Edit in the preview takes the recording. It's being rebuilt one piece at a time: the stage, the timeline with zoom and speed regions, the Background panel and Export. `bun run dev:editor` opens it on your newest download. Closing an unsaved recording asks, then deletes it.
- **Stage:** the editor's big view of the recording, framed the way it will export.
- **Appearance** (`Appearance`): how the editor frames the recording: background, padding, corners, inset, shadow and border. Sizes are measured on a 1920-wide frame, so an appearance matches at any size. The Background panel edits it, and the stage and export both draw it.
- **Timeline:** the editor's strip under the stage: play and pause (Space), the time, the ruler and the playhead. Effect tracks slot in under the ruler.
- **Region:** a stretch of the timeline that zooms in or changes speed. A zoom can have a center; without one it zooms on the middle. Z and S add one at the playhead; the timeline selects, moves, resizes and deletes them.
- **Frame at time t** (`frameAt` in `edits.ts`): everything needed to draw the edited video at one moment: the layout, corners, shadow, border, the eased zoom and which moment of the recording shows. The stage draws from it; export gets the same numbers through `exportLayout` and the zoom track.
- **Island:** one of the editor's rounded areas, such as the stage and the timeline.
- **Rail:** the column of icons at the left of the side island. Its top tabs switch the panel (Background, Cursor, Zoom, Audio, Captions); its bottom tabs are app-wide (shortcuts, Help, GitHub, Settings).
- **Panel:** what the rail shows beside it: one effect's settings, in sections of field rows.
- **Export settings** (`ExportSettings`): format, frame rate, resolution, quality and where the export goes. The Export button's chevron opens them; the button itself exports with them.

## Shared pieces

- **Pill** (`Pill`): the rounded bar shape every bar in the app uses.
- **Morph pill** (`MorphPill`): a pill that glides between states of different widths, like the record bar's setup and recording states, or the clip dock. Each state keeps its own GPU layer so its text never shakes.
- **Glass:** the native frosted view behind the record bar and the capture bar, owned by Rust in `macos/glass.rs`. A page can only blur its own content, so the blur of the apps behind is native.
- **Panel:** a non-activating macOS panel (`NSPanel`). The bar, overlays and preview are panels, so they float over every space, including full-screen apps, without taking focus. Closing one crashes, so they're hidden, never closed. In the editor, "panel" will also mean a rail section like Background.
- **Floating windows** (`windows/floating.rs`): the record bar and the recording preview. They follow you to the display you click on. One module shows, hides and places them and runs their pointer loop; each window only says what to do when the pointer moves.
- **Pointer hover** (`usePointerHover`): how hover works in windows that get no mouse moves (the preview and the overlays). Rust reports the pointer, and the page marks the element under it with `data-hovered`, which every `hover:` style matches too. This is what "hover bridge" refers to.
- **System-wide keys** (`KeySet`): keys the app takes for a while because its windows aren't focused. Each key set handles its own keys. The picker takes Esc, Return and Tab (`PickerKey`), and Return and Tab go to every overlay: the one holding the Area box acts, or else the one under the pointer. The preview takes E, ⌘C and ⌘S (`PreviewKey`) while the pointer is over it.
- **Own windows:** this app's windows (the record bar, the overlays, the preview, the frame and alerts). Captures always leave them out. Display and area captures leave out the whole app, so windows opened mid-recording stay out too.
- **Cursor log** (`capture/cursor_log.rs`): the cursor position and mouse buttons, polled during a recording and written as JSON Lines next to the video. Polling needs no permission. The editor will use it for cursor and click zooms.
- **Bindings** (`src/lib/bindings.ts`): TypeScript types generated from the Rust types by ts-rs. Don't edit them; run `bun run bindings`.
- **Page event** (`PageEvent`, `lib.rs`): every event Rust sends the pages, with what each carries. It's in the bindings, so a page that expects the wrong payload fails to compile.
- **Rust value** (`useRustValue`): a value Rust owns, like the recording status. A page asks for it once, then follows its event, and the first answer never overwrites a newer event.
- **App storage:** `~/Library/Application Support/com.aidankmcalister.screen-recorder/recordings/`, where recordings wait until you save or close them, one folder each, named `YYYY-MM-DD HH.MM.SS`.
