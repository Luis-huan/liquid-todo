# Changelog

Notable changes to Liquid Todo. The version of the installed app matches the installer version.

## 1.2.0 - 2026-09-15

### Added

- Ticking a task off in Today drops it to the bottom of the column, and a new task is added
  straight above the finished ones, so the open work stays together at the top.
- Today is kept in three bands: work carried over from an earlier day on top, the ordinary open
  tasks in the middle (these are the ones you can drag freely), and finished work at the bottom.
- The day that just ended now shows what slipped: unfinished tasks rise to the top of Yesterday
  with their "moved to today" badge, and the finished ones settle below them.

### Changed

- Only Today has check boxes. Yesterday and Next day are plain lists, so nothing can be ticked
  off by accident in the plan or in a day that is already over; Yesterday still shows what was
  completed with a strike-through. Next day shows its task total instead of a "0 / n" count.
- Carried over tasks keep their badge when they are dragged around. The badge is cleared by
  ticking the task off, which is what the badge was always about.
- Task rows sit inside the glass instead of overhanging the panel edge, and both the rows and
  their text are one size smaller, which also thins out the list. The card that follows the
  pointer during a drag is now as wide as the row it came from.
- History separates its days with a full-width rule, and each date is centred and bolded above
  its own done/total count, so a date can no longer be mistaken for one of the tasks below it.
- History and the Yesterday column present every finished day the same way: unfinished work on
  top, finished work below it. Days that were recorded by an older version are straightened out
  when they are shown, so the order always matches the new rollover rule. The saved order itself
  is left alone, and Today still follows your own drag order.
- Desktop layer pinning and "keep on top of windows" are mutually exclusive. The widget can sit
  behind other applications on the desktop layer, or float above them, never both.

### Fixed

- The widget no longer jumps in front of other applications. Re-attaching to the desktop layer
  used to lift the window even when Windows had silently dropped the desktop ownership — which
  happens when Explorer restarts, when the display or theme changes, and when a fullscreen game
  or video switches modes. The desktop is now verified before any lift, and the ownership is
  re-checked every 12 seconds so it can be restored silently on the spot.
- Show Desktop is only resisted while the widget is pinned to the desktop layer. As an ordinary
  window it disappears with the desktop, and clicking it brings it back to the front.
- Yesterday's leftovers are placed above the day's plan, as intended. Both groups used to share
  order 0, so the plan could end up above the work carried over from the day before.
- Dragging a task up or down inside Today or Next day did nothing. The new position is now taken
  from where the row actually sat when it was released; asking which drop area was under the
  pointer resolved to the whole column whenever the list was mostly empty, and dropping onto a
  column left the order untouched.
- A carried over task goes back to the top of Today when it is unticked again, instead of landing
  at the end of the ordinary open tasks. Dragging it only reorders it among the other carried
  over tasks, and a finished task can only be moved within the finished block.
- The desktop layer helper now runs as one long lived process instead of starting PowerShell for
  every call, which is what makes the frequent ownership checks affordable.

## 1.1.0 - 2026-09-11

### Fixed

- The tray icon was blank in installed builds. The packaging list only shipped the desktop layer
  script, so `tray.png` never reached the app resources and the tray fell back to an empty image.
- "Start with Windows" did nothing. The login item was only registered when toggling the tray
  checkbox, never when the app started. It is now registered on launch whenever the OS state
  differs from the saved setting, so a manual change in Windows Task Manager is respected.

### Changed

- The window frame now matches the liquid glass. The 18px transparent margin around the panels is
  gone, so the glass edge is the window edge.
- Glass fill is roughly 27% more transparent, so more of the wallpaper shows through.
- The history window title is capitalised (`History`).

### Removed

- The "Live desktop backdrop" option that streamed the desktop through the glass. The glass now
  always refracts the saved wallpaper, which removes the capture pipeline and its side effects.

### Packaging

- The installer only contains the compiled app bundles, so development artifacts can no longer
  end up inside a published build.

## 1.0.0 - 2026-09-10

### Added

- First public release: three day columns (Yesterday, Today, Next day), drag and drop within and
  across days, midnight rollover, a six day history window, liquid glass panels sampled from the
  wallpaper, desktop layer pinning with a fallback, tray menu, and light/dark glass themes.

### Fixed

- The history window sampled the main window's slice of the wallpaper, so its glass did not line
  up with the desktop behind it.
- Panel titles sat on the rounded glass rim instead of inside the panel.
