# F10 iOS native QA evidence (in progress)

Device F0BDF23C-0286-4183-97E3-3BCC61D4267D, iPhone17Pro/iOS26.5/402x874. Native Maestro input only. Artifacts base /private/tmp/proops-f10-native. No code, DB, Android, Metro or git writes by this worker.

## Verified by actual image inspection and settled assertions

- Monthly zero: ios-clear-monthly/.maestro/tests/2026-10-03_202626/ios-clear-monthly/takeScreenshot/ios-cleared-monthly-native.png shows 0,00 and disabled Save after native backspaces.
- Monthly exact 220001 cents: ios-monthly-settled/.maestro/tests/2026-10-03_202802/ios-monthly-settled/takeScreenshot/ios-exact-monthly-settled.png, with exact 2.200,01 assert before further actions.
- Deadline and monthly inactive drafts survive switching: ios-mode-restore-retry/.maestro/tests/2026-10-03_202932/ios-mode-restore-retry/takeScreenshot/ios-deadline-preserved-draft.png and ios-monthly-preserved-draft.png. Deadline 02/03/2027 gives 132000 cents for five monthly contributions; returning monthly preserves 220001 cents.
- Native calendar selects 31/01/2027: ios-select-january31/.maestro/tests/2026-10-03_203037/ios-select-january31/takeScreenshot/ios-january-calendar-before-selection.png and ios-january31-monthly-draft.png. Before initial, calendar visibly shows 31/01, 28/02, conclusion 31/03, two full 220001-cent monthly events and last 219998 cents.
- Initial one cent on 03/10/2026 produces four events and last 219997 cents: ios-initial-one-cent/.maestro/tests/2026-10-03_203119/ios-initial-one-cent/takeScreenshot/ios-initial-one-cent-date.png and ios-final-monthly-calendar.png. Conclusion 31/03/2027, real deadline warning 02/03/2027. Reserve unchanged deadline03/09/2027, firsttoday, calculated250000 cents/12 events.
- One actual save only: ios-save1 log records exact assertions then Save tap. Sheet closed; root captured in failed title assertion image ios-save1/.maestro/tests/2026-10-03_203206/ios-save1/screenshots/step-010-assertCondition-Plano_de_metas.png. Root has another section named Plano de metas, so that failure is ambiguous selector. Corrected proof ios-root-proof-corrected exits0 with Save absent and actual native combined labels present.
- Reopen read1: ios-read1-sources/.maestro/tests/2026-10-03_203649/ios-read1-sources/takeScreenshot/ios-read1-monthly-source.png and ios-read1-initial-and-dates.png show persisted monthly220001, firstJan31, initial1today, conclusionMar31/count4 and warning. ios-read1-close exits0; no second Save.
- Actual Escuro app theme selected and photographed in ios-dark-ui-select/.maestro/tests/2026-10-03_204206/ios-dark-ui-select/takeScreenshot/ios-profile-dark-selected.png. Original app selection was Claro (ios-profile-theme-scroll2.png), simulator appearance light/content_size large; recorded ios-original-visual-settings.json.
- Native simulator dark + content_size extra-extra-extra-large applied through supported simctl ui. This is a named Dynamic Type category; no exact 1.3 assertion.
- F10 concealed sheet: ios-private-result/.maestro/tests/2026-10-03_204407/ios-private-result/screenshots/step-006-assertCondition-Previsão_da_meta_oculta.png and ios-private-close-finance/.../ios-private-result-settled.png. Editable sources remain visible; hint and prediction show Previsão oculta with mask; actual hierarchy ios-private-result-hierarchy.json contains no derived conclusion/calendar. Source accessibilityLabel Previsão da meta oculta is not the actual native label, so that assert failed; native text is Previsão oculta.
- XXXL dark F08 effect uses full readable amount rows on separate lines: ios-crossread2-visible/.maestro/tests/2026-10-03_204732/ios-crossread2-visible/takeScreenshot/ios-crossread2-dark-large-effect.png, showing all 36600/3000/-12719,36/-52319,36 values with growing labels and no truncation.

## Reported issue and root work

- Hidden root card retained month caption (••••••/mês até mar/2027) in ios-dark-large-private-open/.../ios-dark-large-private-goals.png. Root confirmed caption used actual goal deadline, not v2 calculated conclusion, and is implementing caption/privacy correction. Existing progress percentage is outside forecast privacy scope per root.

## Honest runner limits

- Immediate post-key screenshots sometimes precede the final settled controlled-field amount; later hierarchy and exact assertions prove final input. Evidence does not establish a 10-second render delay or distinguish app from driver timing.
- Maestro eraseText/bulk input and offscreen selectors were not trusted for acceptance. Native backspace/digit taps plus settled assertions were used. Starting swipe on segmented changed selected mode; final drafts were restored and asserted.
- scrollUntilVisible could report the management link visible but subsequent tap selected Agent tab. Later navigation uses observed controls and known appproops://finance/goals through Maestro.
- Read2 partial: ios-crossread2-visible failed only the 03/10/2026 assertion because that field was below viewport at XXXL. Failure image visibly proves deadline31Mar, computed220000/count4,firstJan31,initial1. Final date/last219999 capture pending after root layout/privacy fix release.
- Reduce Motion has no simctl ui command. Native Settings UI check and exact restoration remain pending; no claim yet.
- Financial non-mutation and CAS/revision evidence belongs to root DB oracle; this worker does not infer DB success from Maestro exit.
