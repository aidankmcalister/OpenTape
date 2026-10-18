# Glossary

The words this project uses for its own concepts. Code, docs and reviews use these names.

- **Record bar:** the pill at the bottom of the screen. It's where you choose a mode, devices and settings, and where you stop a recording.
- **Mode:** what kind of thing you're about to record: a display, a window or an area.
- **Picker:** what opens after you choose a mode. It puts one overlay on each display and lets you point at the target.
- **Capture bar:** the pill on the highlighted target: what will be recorded, its size in pixels, the Area's ratio chip, and Record. Every mode shares it.
- **Overlay:** the see-through window the picker places over one display. It draws the highlight or the Area box.
- **Target:** exactly what will be recorded: a display, a window, or an area of a display.
- **Record (a target):** the picker's last step. It closes the overlays and starts recording the target.
- **Recording status:** the recording module's single source of truth, as idle, starting, recording, paused or stopping, plus the time recorded and the last error. The record bar shows it; it doesn't keep its own copy.
- **Pause:** frames captured while paused are left out, so the file plays straight through.
- **Restart:** throws away what's been recorded and records the same target again, after a native alert. It pauses while asking.
- **Recording preview:** the card in the bottom-left corner after you stop. It plays the clip on a loop; hover shows Save, Copy and Edit. The record bar hides while it shows: bar, then preview, then editor.
- **Current recording:** the recording you've just made. It waits in app storage while the preview and then the editor show it. **Save** exports it to Downloads as an `.mp4`; closing deletes the copy in app storage either way.
- **Editor:** where Edit in the preview takes the recording. Closing it asks first, then discards.
- **Look:** how the editor frames the recording: background, padding, corners, inset, shadow and border. Sizes are measured on a 1920-wide frame.
- **Region:** a stretch of the timeline that zooms in or changes speed, added at the playhead.
- **Morph pill:** the pill the record bar and the preview's dock share. It glides between states of different widths; each state keeps its own GPU layer so its text never shakes.
- **Close (the preview or editor):** asks first with a native alert centered on the screen, unless the recording is saved, then deletes the copy in app storage.
- **Frame:** while an area or a window records, the picker's overlay on that display stays up, click-through and without controls, dimming everything but what's being recorded.
- **Own windows:** this app's windows (the record bar, the overlays, the preview, the frame and alerts). Captures always leave them out; display and area captures leave out the whole app, so windows opened mid-recording stay out too.
