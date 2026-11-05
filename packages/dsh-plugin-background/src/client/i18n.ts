/** Settings page copy. The plugin ships English only. */
export const en: Record<string, string> = {
  nav: "Background",
  title: "Background",
  description:
    "Paint an image behind the whole interface. Point at an absolute path on the machine running DSH, or at an https URL.",
  enable: "Enable background",
  image: "Image path or URL",
  imageHint:
    "Absolute local path, for example /home/you/wallpaper.jpg, or an https:// URL. Local images are served through the authenticated file route, so they never leave the Host.",
  invalidImage: "Enter an absolute path or an http(s) URL.",
  preview: "Preview",
  previewTitle: "Background",
  previewBody: "Panels stay readable over the image.",
  previewEmpty: "Set an image to preview it here.",
  previewFailed: "This image could not be loaded.",
  panelOpacity: "Panel opacity",
  panelOpacityHint: "How opaque interface panels stay over the image.",
  dim: "Dim",
  dimHint: "Darkens the image so text stays readable.",
  blur: "Blur",
  blurHint: "Blurs the image; higher values hide detail.",
  reset: "Reset to defaults",
  loading: "Loading configuration…",
  unavailable: "This configuration is not available.",
  readOnly: "Configuration is read-only.",
  writeError: "The Host refused the change.",
}
