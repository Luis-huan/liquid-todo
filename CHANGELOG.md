# Changelog

Notable changes to Liquid Todo. The version of the installed app matches the installer version.

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
