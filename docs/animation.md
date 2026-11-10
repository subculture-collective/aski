# Animation

Recipe version 4 adds `animation`: effect (`none`, `typewriter`, `reveal`), direction, duration (500–20,000 ms), frame rate (1–30 fps), loop and end hold (0–10,000 ms). Older recipes open with no effect, 2 s duration, 12 fps, looping and a 1 s hold. Animation settings stay when text, style, colors or layout change, and each change is one undo step.

`shared/animation.ts` has the only frame function, `frameAt(model, animation, time)`. It snaps the time to a whole frame (frame *i* is at *i* / fps seconds) and always returns the final artwork's rows and columns, so frames never shift or crop. The same function will produce GIF frames.

- **Typewriter** shows the input one character at a time. The renderer draws at most 24 prefixes of the input with the same layout and places each block where the final artwork's block starts, so center- and right-aligned text does not drift while typing. Longer inputs advance several characters per step. The last step is the finished artwork, which is held for the end hold.
- **Reveal** wipes the finished artwork into view top to bottom, bottom to top, left to right or right to left.

The Animation panel previews the selected design in its colors. Transport controls: play/pause, restart, and a frame scrubber (a range input, so arrow keys and touch work) that pauses playback and shows exactly the frame `frameAt` returns for that instant. Timing controls set duration and end hold in seconds and the frame rate from 6 to 30 fps; invalid values show the rule and keep the last valid setting. *Loop* repeats the duration plus hold; *Play once* stops on the last frame, and Play starts it again from the beginning. When the device asks for reduced motion, the preview starts paused; the controls stay available. Palette cycle, shimmer and glitch follow in a later issue.

`make test-animation` covers repeatable frames for the same timestamp, frame snapping, loop and play-once indexing, end-hold frames, seeking, typewriter canvas size and placement for left, center and right alignment, all four reveal directions, validation and migration. The browser suite covers playback, scrubbing by pointer and keyboard, timing changes and invalid values, play-once stopping, settings kept through text and color edits and reload, fixed preview dimensions, editing with an effect selected, pause, reload and reduced motion.
