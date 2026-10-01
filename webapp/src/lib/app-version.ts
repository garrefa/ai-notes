// How the viewer names its own version, everywhere it shows it (the sidebar footer, Settings):
// "AINotes v0.2.0 (123)", the build number in parentheses when the build knows one.
export function appVersionLabel(): string {
  const build = __APP_BUILD_NUMBER__ === null ? "" : ` (${__APP_BUILD_NUMBER__})`
  return `AINotes v${__APP_VERSION__}${build}`
}
