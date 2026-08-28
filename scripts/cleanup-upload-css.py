from pathlib import Path
path = Path('/home/ubuntu/nya-nya-nya-audit/app/globals.css')
text = path.read_text()
marker = '\n/* Standalone Upload Center shell: no public-site chrome, full viewport, shared operations sidebar. */'
if marker not in text:
    raise SystemExit('cleanup marker not found')
text = text.split(marker, 1)[0].rstrip() + '''\n\n/* Standalone Upload Center shell: no public-site chrome, full viewport, shared operations sidebar. */
.upload-center-standalone { min-height: 100dvh; background: var(--bg); }
.upload-center-standalone .ops-shell { width: 100%; min-height: 100dvh; margin: 0; overflow: hidden; border: 0; border-radius: 0; box-shadow: none; }
.upload-center-standalone .ops-main { min-height: 100dvh; }
.upload-center-standalone .upload-team-remove-button,
.upload-center-standalone .upload-team-platform-picker summary { display: grid; place-items: center; line-height: 1; }
.upload-team-media-field > small.upload-team-media-placeholder { display: block; min-height: 1.1rem; }
.upload-team-media-field > small.upload-team-media-placeholder svg { display: none; }
@media (max-width: 1023px) {
  .upload-center-standalone .ops-shell { grid-template-columns: 1fr; }
  .upload-center-standalone .ops-admin-mobile-bar { position: sticky; z-index: 55; top: 0; display: grid; min-height: 4rem; padding: .7rem 1rem; border-bottom: 1px solid var(--line); background: var(--surface); }
  .upload-center-standalone .ops-sidebar { position: fixed; z-index: 70; inset: 0 auto 0 0; display: flex; width: min(19rem, 88vw); height: 100dvh; transform: translateX(-105%); transition: transform 180ms cubic-bezier(.23,1,.32,1); }
  .upload-center-standalone .ops-sidebar.is-mobile-open { transform: translateX(0); }
  .upload-center-standalone .ops-sidebar-backdrop { position: fixed; z-index: 65; inset: 0; display: block; border: 0; background: rgb(0 0 0 / 58%); }
  .upload-center-standalone .ops-main { grid-column: 1; min-height: calc(100dvh - 4rem); padding: .75rem; overflow-x: hidden; }
  .upload-center-standalone .ops-sidebar-mobile-close { display: grid; place-items: center; width: 2.25rem; height: 2.25rem; }
}
@media (min-width: 1024px) {
  .upload-center-standalone .ops-admin-mobile-bar,
  .upload-center-standalone .ops-sidebar-mobile-close,
  .upload-center-standalone .ops-sidebar-backdrop { display: none; }
  .upload-center-standalone .ops-shell { display: grid; }
  .upload-center-standalone .ops-main { grid-column: 2; }
}
@media (max-width: 760px) {
  .ops-shell.is-upload-center .ops-sidebar { display: flex; }
}
@media (prefers-reduced-motion: reduce) {
  .upload-center-standalone .ops-sidebar { transition: none; }
}
'''
path.write_text(text)
print('cleaned')
elijkse = None
