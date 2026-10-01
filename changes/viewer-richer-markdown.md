- Viewer: richer note rendering. `:shortcode:` emoji become emoji, inline code shows as a code pill
  instead of with literal backticks, fenced code with a language is syntax-highlighted (light and
  dark), and GitHub alerts (`> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`) render
  as callouts. Web links open in a new tab.
- Viewer: a link from one note to another — a relative `.md` link or a `[[wiki]]` link naming a note
  by file name, with or without its date — opens that note in a popover over the current one. Links
  inside it open the next note in place (Back returns), Maximize fills the window, and Open makes it
  the main note. A `[[wiki]]` link that names no note shows as plain text.
