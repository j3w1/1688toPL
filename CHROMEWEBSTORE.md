# Chrome Web Store Listing — 1688toPL

Last updated: 2026-10-26. **SEAL implementation, version 2.10.0; unpublished to the store.** This file is the store metadata source of truth, not authorization to submit or release. Current verification is tracked below; historical test counts do not establish acceptance of this candidate.

## Store Listing

**Extension name:** 1688toPL, matching the production manifest.

**Short description:** Keep local 1688 and store spreadsheet orders, prepare packing lists, and copy product data and pictures to Excel.

**Detailed description — draft:**

```text
Turn 1688 purchases and supplier spreadsheets into accurate container packing lists, barcode labels and carton marks.

Import selected 1688 orders or a marked supplier workbook. Add purchases from other sources manually or from JSON. Keep original product descriptions, quantities, prices and photos together in a local order library.

If a complete order's total balances but its discount allocation is ambiguous, compare the valid treatments and confirm before saving. Reuse that confirmed treatment only while the same order's financial evidence is unchanged. Select products in Orders, review their proposed barcodes together and confirm once. Complete-order context determines groups and variant endings while only selected products receive assignments; existing codes remain intact.

Supplier workbooks can update one existing same-store purchase after a visual current-versus-updated review. Unit-price changes are distinguished from quantity-driven totals; matched codes and custom product details survive, while imported rows and unsealed carton facts use the new workbook as authority. Sealed history and other dependencies remain protected. New-purchase import remains available for separate repeat orders.

Supplier workbook import includes an editable product-code review. Check one base per source group, adjust variant and size endings, and see the full barcodes before saving. Invalid codes, unresolved sizes and ownership conflicts stay visible until resolved; the final import saves the reviewed purchase and its codes together.

Prepare products in Orders with CE codes, Spanish names and Chinese categories using editable local rules. New codes use the original purchase calendar month. Review size/material suggestions, paste a 1688 supplier packing report or enter Pcs/box once, then review carton/remainder proposals. Preserve actual uneven cartons and honest unknown contents or measurements. Eligible repeat purchases can share reviewed codes while retaining separate purchase values; shipped code lineages cannot accept new members.

Packing selects whole orders into a named container. Confirm loaded/left-behind cartons, inspect the derived read-only packing list and seal a versioned manifest. Global Backlog updates automatically; historical Se quedó remains reproducible. Reviewed amendments preserve prior revisions and protect cartons committed elsewhere.

Delete unused orders together with their owned cartons and unsealed container inclusions after one review. Sealed shipment dependencies show the actual container names and protect the full selection from deletion. Containers, other purchases and retained physical history remain intact.

Choose Excel... to configure one selected-product table, then copy its image or download it as one editable Excel worksheet with embedded photos and carton marks. Both outputs use the same columns, details and language. Linked carton dimensions and weights show saved physical evidence, grouping equal measurements and preserving differences. Other copy formats retain source values, photos and chosen columns. Download the complete container revision separately as an editable workbook with Packing list, Cartons and Se quedó sheets. Optional detailed automation JSON contains full costs, charge reasons and source identifiers independently of workbook column choices. Print barcode labels and carton marks as offline PDFs.

Open your 1688 order list, select purchases and choose Import selected. Manage products/cartons in Orders, include whole purchases in Packing, review loading and export the selected revision. Supplier purchase workbook import retains its template and cell-level review; a matching-content warning helps identify accidental repeat imports without blocking deliberate new purchases.

Orders, source/report history, original photos, container revisions, notes and settings stay in your browser. Back up the whole library or a reviewed preparation scope to a lossless local file. Importing uses your existing 1688 session; uncached product pictures may load from Alibaba CDN. No analytics, online translation or developer-operated order upload is used.

Use one buyer account per library. Unsupported page layouts or inconsistent totals fail without replacing the last good saved order. Review suggestions and physical carton counts before relying on labels. Keep a full backup before clearing your browser profile or uninstalling.
```

**Category:** Shopping, proposed; confirm in Dashboard.

**Single purpose:** Prepare locally stored purchase orders, product codes and packing labels for Excel and printing.

**Primary language:** English, with Chinese/Spanish interface choices and preserved source text.

## Graphics & Assets

| Asset                  | Required dimensions     | Status / source                                                                                                                                                                                                                                                               |
| ---------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Icon                   | 128 × 128 PNG           | [Present](icons/icon128.png); rights/store suitability not established.                                                                                                                                                                                                       |
| Screenshot             | 1280 × 800 or 640 × 400 | [Orders](screenshots/order-library.png), [dark Orders](screenshots/order-library-dark.png), [Orders carton reconciliation](screenshots/order-cartons.png), [container loading](screenshots/container-loading.png); synthetic documentation images, store composition pending. |
| Additional screenshots | Same store sizes        | [Spreadsheet import](screenshots/store-spreadsheet-import.png), [label editor](screenshots/label-editor.png), [Settings](screenshots/settings.png).                                                                                                                           |
| Small promo tile       | 440 × 280               | Not created.                                                                                                                                                                                                                                                                  |
| Optional marquee       | 1400 × 560              | Not created.                                                                                                                                                                                                                                                                  |

Synthetic documentation images were refreshed for the renamed candidate, including the [packing export dialog](screenshots/packing-export.png). Store-sized composition is still pending. Confirm rights for 1688/Alibaba, spreadsheet and Casa Elida artwork or replace it before submission. A user-selected logo also needs appropriate rights. Do not imply affiliation.

## Permissions Justification

The production [manifest](manifest.json) requests these permissions; test-only localhost/inspection permissions do not ship.

| Permission / match                                                          | Type           | User-facing purpose                                                                                                          |
| --------------------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `tabs`                                                                      | Permission     | Open/reuse order readers and selected source orders; detect interruptions and close only owned reader tabs.                  |
| `alarms`                                                                    | Permission     | Continue checkpointed steps during a requested import.                                                                       |
| `clipboardWrite`                                                            | Permission     | Copy chosen values, pictures and generated labels after the user's copy action.                                              |
| `unlimitedStorage`                                                          | Permission     | Retain local orders, history, preparations and original pictures beyond small default limits; storage failures still report. |
| `https://cbu01.alicdn.com/*`                                                | Host           | Fetch/cache public product originals without credentials.                                                                    |
| `https://trade.1688.com/order/new_step_order_detail.htm*`                   | Content script | Read supported legacy detail pages and offer save/CSV controls.                                                              |
| `https://air.1688.com/app/ctf-page/trade-order-detail/index.html*`          | Content script | Read supported detail pages, save/refresh and offer CSV.                                                                     |
| `https://air.1688.com/app/ctf-page/trade-order-list/buyer-order-list.html*` | Content script | Discover selected/filtered orders and follow list pagination.                                                                |
| `https://work.1688.com/*`                                                   | Content script | Mount import controls only when a supported buyer list is found, including embedded matching frames.                         |

The action opens a full workspace tab. No downloads, scripting, activeTab, cookies, history or clipboard-read permission is declared.

## Privacy & Data Use

**Handles user data: yes, locally.** No developer-operated upload or analytics endpoint is used.

| Data                                                                                                            | Local handling / network boundary                                                                                               |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Supplier/store/member IDs, references, purchase dates, products, prices, quantities, discounts/freight/payables | Validated snapshots/history for reconciliation and requested copying/export.                                                    |
| Supplier workbooks, filenames, source rows, embedded photos                                                     | Parsed locally; originals and chosen source evidence retained. No parsing service/file upload.                                  |
| Notes/tags, optional WeChat IDs, workflow, features, payment references and costs                               | Stored separately from source and retained in appropriate backups. No WeChat contact, payment processing or supplier messaging. |
| Preparations, codes/shared identities, carton contents/marks/measurements/confirmations and checkpoints         | Stored locally; relevant backup/exports preserve ownership and physical evidence.                                               |
| Photo edits, label settings/logos, vocabularies, themes and tag colors                                          | Local display/label rules and full backups; scoped backups retain their documented subset.                                      |
| Job diagnostics                                                                                                 | Bounded financial failure evidence exported only on request; no HTML, descriptions/photos or session data in reports.           |
| Mode/language/filter/copy choices and Activity read state                                                       | Browser preferences, outside library backups; panel minimization is tab-session state.                                          |
| Supported source pages / remote photos                                                                          | Normal requests reach 1688 using the signed-in browser; public photo requests reach Alibaba CDN. No credential extraction.      |

Full backups include only cached photos reachable from retained orders/history/ownership/container revisions; scoped backups retain canonical originals needed for the scope. Identical images are losslessly deduplicated in compressed files. Deleting orders removes source/history/preparation and unused local originals after reference checks; shared photos and carton deletion history may remain. Restores validate atomically and preserve newer edits. Jobs are not restored. Uninstalling/clearing a profile can delete local data.

Detailed packing automation JSON is default-off. When enabled it includes full costs, charge reasons and IDs for the complete selected container revision, including frozen Se quedó, regardless of XLSX columns. Label/mark PDFs retain their existing companion summaries. User-copied clipboard contents and downloaded files are controlled subsequently by the operating system/user.

### Data Use Certification

Publisher confirmation in Dashboard is outstanding:

- [ ] Data is not sold to third parties.
- [ ] Data is used only for the order-library purpose.
- [ ] Data is not used for creditworthiness or lending.

## Privacy Policy

**Public policy URL:** not provided/published. Before submission, publish the practices above with effective date, publisher identity and contact. Match the Dashboard disclosure to local financial/website-content handling and 1688/CDN requests. Do not claim the extension stores no user data.

## Distribution

Visibility/regions are unselected. Repository rename, local implementation or Git push does not authorize store submission.

## Developer Info

**Publisher/contact email:** not supplied; do not infer legal identity from repository ownership.

**Support route:** not confirmed.

**Homepage candidate:** [j3w1/1688toPL](https://github.com/j3w1/1688toPL).

## Version History

| Version | Date       | Changes                                                                                                                                                                                                             | Status                                                                                                      |
| ------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 2.10.0  | 2026-10-26 | Explicit ambiguous-discount review with reusable financial receipts; order-scoped product selection and one confirmed code assignment.                                                                              | Local integration candidate; verification recorded below. No publication or store submission.               |
| 2.10.0  | 2026-10-24 | Unified selected-product Excel image/workbook preview with linked carton measurements; removed unused recovery and legacy carton-editor workflows while preserving backup/history compatibility.                    | Local verification completed; installed acceptance pending. No publication or store submission.             |
| 2.10.0  | 2026-10-22 | Orders smart carton reconciliation, purchase-calendar codes, container loading/seal/amendments, immutable three-sheet output and compatible shipment/report backups.                                                | Local implementation; unpublished. No store submission.                                                     |
| 2.9.0   | 2026-10-22 | 1688toPL branding; opt-in detailed JSON; reachable/canonical backup photos; compatible scoped restore/settings initialization; shared XLSX/PDF media; repeat-workbook warning; organized illustrated documentation. | Historical local handoff: 1,047 unit tests and all 538 Chromium tests passed. No store submission.          |
| 2.9.0   | 2026-10-22 | Integrated manual/JSON/store orders, physical cartons, inline capacity planning, Organize, photo tools, operational costs and two-sheet packing exports.                                                            | Historical repository integration; [PR #20](https://github.com/j3w1/1688toPL/pull/20). No store submission. |

Earlier release and verification chronology remains in Git history. It is not current-candidate acceptance.

## Review Notes

### Authoritative spreadsheet purchase updates — local candidate, 2026-10-26

The candidate adds a same-account/store target review, before/after row and price comparison, stable identity mapping and one atomic source/preparation/carton update. Excel replaces current supported source and unsealed physical facts, while matched CE codes and authored details remain. Missing rows retire their owned cartons; history, payment/exclusion checks, code ownership and sealed shipment protections remain authoritative. No new permissions, remote service or IndexedDB migration is introduced. Private workbooks and backups remain outside tracked fixtures.

Final local `npm run verify` passed all **1,602 unit tests** and **663 Chromium cases** (39.7 minutes), plus source syntax, documentation and the production build. The browser cases cover complete updates, Back/Cancel, no-op detection, explicit ambiguous-row mapping, unsaved photo previews, multiple purchase targets, all three languages, narrow layouts and bounded 52-row review. Native IndexedDB regressions cover preserved codes/details, transaction rollback/retry, reopening/restore, newly sealed blockers and retained deletion tombstones. Synthetic desktop/narrow screenshots were regenerated and inspected; changed-file formatting and diff checks passed. The explicit 2.10.0 development build verified **30 manifest resources**. The repository trial also built successfully but returned `loaded:false`, `staged:false`, `verified:false`, `reason:no-local-trial-target`; installed acceptance remains unverified. Native Excel and physical printing were not run. Earlier results below belong to their recorded candidates. No owner-library mutation, push, merge or store publication is part of this local delivery.

### Refresh reader recovery — local candidate, 2026-10-26

Multi-order refresh now recovers a marked reader that disappears between verification and retargeting, and a reader lost during a detail request uses the existing bounded replacement path instead of falsely failing the order on its last read attempt. Cleanup tolerates an already-gone owned reader. Missing IDs alone permit recovery; unrelated browser errors and sign-in/user-navigation protection retain their existing behavior. If all three supported creation methods produce unusable IDs, Activity pauses with a translated recovery message and retains its pending orders rather than exposing a raw numeric tab error. No permission or schema changes are required.

The screenshot establishes paused jobs with missing-tab errors, but does not identify which lifecycle race or browser limitation occurred. Verification passed with 80 focused background/controller/translation unit cases and five targeted Chromium cases. The native regression closes a recovered marked reader during retargeting, completes a two-order refresh through its replacement, checks source financial rows and preparation/carton preservation, and verifies reader cleanup. Existing persistent retry, background-reader focus and sign-in recovery cases also passed. Source syntax passed; the explicit development build verified all 30 manifest resources. No real purchase was refreshed or replaced during diagnosis. Installed-browser acceptance remains separate; the trial configuration is still unavailable.

### Ambiguous order discount review — local candidate, 2026-10-26

Orders provides **Prepare products...** for explicitly selected product rows. Its confirmation groups the selection by purchase and product family, showing source details/articles, original purchase months, existing/proposed barcodes and Spanish names, Chinese categories and materials. Scoped detail editors remain unsaved until **Confirm preparation**. Local suggestions preserve custom values and intentional blanks. Family inference uses article/model evidence before variants and sizes; matching marketing titles alone require a grouping choice. Selection stays in Orders; the main popup contains no product checkboxes or select-all action. Complete-order context is projected onto selected rows; later siblings reuse their base and unchecked groups reserve nothing. Existing authored grouping, codes and shared identities retain precedence; current/historical ownership and source revisions remain guarded.

### Family preparation and reader registration — local candidate, 2026-10-26

Follow-up rechecks passed all 95 workspace unit cases and the 18 browser cases identified by the broad regression sweep, including compact three-product geometry, deferred format errors, legacy unfinished sizes and explicit dictionary replacement. Synthetic screenshots were refreshed. The release gates remain the complete repository verification plus green checks on the PR and resulting main commit. Installed-extension acceptance, native Excel and physical printing are separate evidence; no owner purchase is deleted, reimported or automatically recoded for these tests.

The follow-up candidate adds model-series and historical-family context, editable family/style/size identities and coding modes, shared base/ending previews, and code-only suggestion reset. Source-labelled packaging dimensions and article tokens do not become barcode alternatives. Local product-name/category, color, material and size dictionaries include generic vocabulary from current purchase types and upgrade untouched defaults while retaining owner customizations. Import progress distinguishes discount reviews from genuine failures and offers direct recovery. Existing saved purchases are not automatically recoded. Final verification and installed-extension evidence are recorded separately after the candidate checks complete; this paragraph does not establish publication readiness.

The reviewed candidate separates standalone model products from sibling article families before deriving variant/size endings. The synthetic horse/elephant regression expects a bare base for the standalone article and A/B for the elephant family. Optional reviewed family evidence is validated and retained through preparation/backup without a database migration. Saved purchases are not automatically recoded.

Reader creation now opens directly at the job-marked order URL, checkpoints provisional ownership and checks registration at 0/100/250/500/1000/2000 ms before fallback. Exact-marker recovery avoids treating registration delay as permanent loss; duplicate cleanup preserves unrelated and sign-in tabs. Adoption/navigation trigger an immediate readiness check even if the browser completion event already fired. Import reports expose bounded lifecycle methods, stages and normalized error codes without HTML or raw API payloads.

Verification for this batch passed the full 1,531-case unit run, followed by focused final rechecks and one additional material-vocabulary regression. Thirty-nine targeted Chromium cases passed across the final run and corrected-fixture rechecks: preparation, uncertain-family review, scoped/manual detail handling, selected-only writes, the horse/elephant example, size resolution, concurrent/stale changes, rollback/history, reopening/full/scoped restore, bounded lists, three-language phone layouts, normal import, discount recovery and the same Orders Refresh action for one/two/eleven orders. Synthetic screenshots were regenerated and inspected at desktop and phone widths. Native test routing uses an attachment barrier for an extension-created reader's first synthetic-domain request; this is test infrastructure evidence, not installed-browser acceptance. No real purchase was used as a test.

Final source syntax, documentation and diff checks passed. The explicit development build and quick trial both built 2.10.0 with all 30 manifest resources verified. The trial found no configured local target (`loaded:false`, `staged:false`, `verified:false`), so no owner extension was staged or reloaded. Repository-wide formatting reports existing warnings in untouched `manifest.json` and `tests/browser/image-navigation-readiness.spec.mjs`; changed-file formatting is checked separately. Installed-owner acceptance, native Excel, physical printing, the complete browser suite and publication were not performed for this batch.

Unknown selected sizes open a separate unsaved ending review. Enter an ending or explicitly omit it, validate the resulting full barcodes, then return to the assignment confirmation. Invalid endings, duplicate barcodes and changes to shared unselected identities block validation. Size decisions use the same reservation and revision checks as other preparation edits; cancellation reserves nothing.

Orders whose payable reconciles under multiple discount treatments now require **Review discounts** instead of reporting incomplete products. The review compares exact source amounts and product allocations, suggests the separate seller reduction only when the source discount breakdown matches, and requires **Confirm and save**. An unchanged reviewed account/order can reuse its validated receipt; changed financial evidence requires another review. Bulk imports continue other orders and expose the review action in Activity. Existing missing-row, unsupported-field and inconsistent-total checks remain active.

The source footer, confirmed treatment and exact financial-evidence key stay in the local snapshot/history/backups. No new permission, external service or IndexedDB migration is introduced. The supplied private HTML remains outside tracked fixtures; a read-only probe confirms its 15 rows produce the two reviewed treatments, both retaining ¥5,890.00 goods net and ¥5,960.00 payable. Its source and owner library were not modified.

Local verification covers all **1,497 unit cases**: the full run passed 1,496 and one temporary-server startup failed because Chromium rejected the OS-assigned port 1719; that exact case passed on an isolated fresh-port rerun. The final affected authoring/automation subset also passed all 90 cases after adding the size review. Across focused runs, **54 affected Chromium cases** passed, including the 23-case confirmation/assignment/layout batch and subsequent targeted checks for whitespace and nested size review in all three languages. The 46 purchase-code units cover complete-order variant inference, partial assignments sharing a base, identical identities, explicit workbook declarations, custom conflicts, interleaved source groups, account isolation and consumed/shared lineage. Browser coverage includes actual incremental persistence, backup/restore and reopening, selection-only review, Back/Cancel, offscreen rows, concurrent claims, captured source evidence, stale async results, duplicate clicks and phone layouts in English, Spanish and Chinese. Ambiguous-size tests verify unsaved cancellation, invalid/duplicate/whitespace rejection, explicit no-size, retained choices across a code claim and final persistence. Independent review found and then verified the fixes for selected-sibling-dependent group ordering and implicit whitespace no-size; no actionable finding remains from those reviews. Synthetic screenshots were regenerated and inspected at desktop and phone widths, including the translated size dialog. Earlier unchanged discount-review coverage remains valid, including transaction abort, history, full/scoped restore, changed evidence, explicit treatment confirmation and import recovery.

The explicit development build and repository trial loop succeeded, verifying all 30 manifest resources. The trial reported **no local trial target**, with `loaded:false`, `staged:false` and `verified:false`; no installed extension was reloaded. Installed-extension acceptance, native Excel, hardware scanning, physical printing and the complete browser suite were not run for this candidate. Synthetic fixtures and screenshots contain no owner orders. No publication, merge, store submission or owner-library mutation is authorized by this local implementation.

### Repository publication candidate — 2026-10-26

The owner authorized publishing the accumulated discount-review, selected-product preparation and reader-recovery changes through one pull request, merging only after green checks, and verifying the post-merge main workflow. Run the complete `npm run verify` release gate for this candidate; the pull request and linked workflow runs record the resulting release evidence. No Chrome Web Store submission is requested. Installed-extension acceptance remains separate because no machine-local trial target is configured.

### Repository publication — 2026-10-24

The owner authorized publishing the accepted integration to `main` through one pull request and requiring green post-merge CI. The pull request and its linked workflow runs record final publication verification; the dated observations below retain their original scopes. At publication preparation, source/docs checks, all 1,460 unit tests and the complete 2.10.0 production build passed. Full local Chromium verification and hosted CI are required before merge. This is repository publication only; no Chrome Web Store submission is requested. No configured installed target is available, so installed-extension acceptance remains outstanding.

The first hosted run exposed four dialog-test races: a closed dialog becomes hidden before its asynchronous `close` event resolves the caller. The deletion and scoped-detail tests now await the exposed completion promise before asserting results or reopening a review. Result, cancellation, no-write and nested-editor assertions remain intact; application behavior and test budgets are unchanged. Final results are recorded in [PR #26](https://github.com/j3w1/1688toPL/pull/26).

### Unified Excel preview and unused-workflow cleanup — local candidate

The local candidate replaces the image-only opener with **Excel...** and a bundled document icon. The same configured product table supports **Copy image** and **Export Excel (.xlsx)**. The workbook contains one editable sheet, all captured products and only selected columns/details; photos and carton marks remain embedded media. Complete-container packing-list export retains its separate three-sheet revision scope and explicit optional-JSON disclosure.

Carton dimensions, weight and volume use linked physical evidence with individual overrides and explicit aggregate bases. Equal complete measurement sets collapse; different sets remain grouped inside one product row. Shared cartons do not multiply physical totals. Blank supplier dimension/weight placeholders are removed; optional **Carton no.** remains blank for later manual completion.

Saved-default reset, previous-packing recovery and the retired ordinary-carton editor/receipt/count-basis workflows are removed from the current source/build rather than hidden. New saves no longer create their checkpoints. Required legacy backup/history validation, active reconciliation, order-deletion retirement, immutable shipment evidence and ownership checks remain.

Current checks passed: 1,460 unit tests, 17 focused Chromium Excel-output cases, changed-file formatting, documentation, and a complete 2.10.0 build with 30 resources, including imported stylesheets. The full Chromium sweep passed 616 of 617 cases; its Chinese viewport failure was corrected without weakening the assertion, and all 28 affected layout/editor cases then passed across English, Spanish and Chinese. The full suite was not repeated after the final CSS layout correction. Synthetic screenshots were regenerated. Earlier verification sections below describe their own snapshots.

The final `npm run try -- --quick` reused the completed unit evidence, rebuilt the complete development extension and passed. No local target was configured: `loaded:false`, `staged:false`, `verified:false`. No installed extension or owner library was changed. The correction also packages the scoped-detail stylesheet, validates imported CSS resources and keeps supplier overflow menus trailing beside the new details action.

The single-sheet export uses the preview's fonts, bold descriptions/quantities/materials, colors, alignment and row sizing. Code badges use the same painter while retaining the underlying code strings. The centered title is **CE唛头 · List**, **CE唛头 · Lista** or **CE唛头 · 清单**. One-store filenames use `<store name>_货清单.xlsx`; multiple stores use the local export date followed by `-list.xlsx`, `-lista.xlsx` or `-货清单.xlsx`.

Native Excel 16.0 opened a fully synthetic four-product workbook successfully: one worksheet, correct rich-text/font sizes, bold numeric quantities, four underlying codes with matching badge overlays, four photos and two merged carton marks. A native range image was rendered and visually checked without clipping. The isolated workbook/application were closed and clipboard contents restored. This is targeted native export evidence, not installed-extension or physical-print acceptance. No permission or database/backup schema change is requested; publication and merge remain separate.

### Spreadsheet declarations and scoped product details — local candidate

The candidate treats nonblank `var` declarations as complete suggested barcode endings. Measurements in descriptions remain source evidence and do not automatically append size characters; blank declarations keep normal recognition. The review exposes declaration/source-cell evidence, deliberate custom edits and code reset. Existing saved purchases are not automatically recoded. Reviewed correction removes only selected size endings while rechecking current ownership, revisions, physical marks and shipment history.

Product details can be edited for the whole order, one CE group or one variant during spreadsheet review and later in Orders. Chinese category remains shared by the group for carton marks; variant Spanish names and materials retain exceptions. Bulk edits keep custom values and deliberate blanks by default, with explicit replacement and affected counts. Import commits details with source assets, cartons and codes; Orders uses existing preparation/history guards. There is no schema or permission change.

Verification passed on Windows with native Node.js 24: all 1,457 unit tests and 50 targeted Chromium cases across import, scoped editing, history, guide/template and output checks. The final affected modal/source-refresh/suggestion cases were rerun after review fixes. Coverage includes A–F declarations with differing measurements, blank/mixed declarations, shared identities, selected-field and custom-blank preservation, Back/reset, source-only and preparation races, Undo/Redo, queued IndexedDB failure rollback, reopening and backup/restore. Source syntax, documentation, translations, changed-file formatting and diff checks passed. The repository-wide format check still flags two unchanged files that also fail formatting at HEAD: manifest.json and tests/browser/image-navigation-readiness.spec.mjs. Synthetic screenshots were regenerated and the affected captures inspected. Only the template Guide worksheet changed; its other eight ZIP members remained byte-identical, preserving formulas, cached values and photo layout.

The actual supplied workbook was checked read-only with the corrected preview: group 5 now suggests A–F with no size endings, retaining 6寸 through 10寸 descriptions and the original source total. Private workbook/backup files and their financial rows are not tracked fixtures. The local trial builds version 2.10.0 and verifies all 30 manifest resources, but no configured target is available, so loaded/staged/verified remain false. The browser tool refused the installed chrome-extension URL, blocking the real-order correction; the owner purchase was not modified. Full `npm run verify`, the complete Chromium suite, installed acceptance, native Excel, physical printing, publication and merge were not run.

### Order deletion with unsealed cartons — 2026-10-24

The local candidate adds one deletion review and an account-scoped atomic cascade: retire exclusively owned cartons, remove unsealed memberships/loading decisions and order-specific staged changes, then remove source/history/preparation and reconciliation drafts. Containers, other purchases, shared ownership and required originals survive. All sealed revisions and permanent shipment lineages remain protected, with actual container names; foreign legacy ownership and linked payments block the entire selection. The final transaction rechecks current state, including a seal performed after review. No schema or permission change is required.

Verification passed on Windows with native Node.js 24: the full 1,445-test unit suite, including 62 container/physical-mark regressions, plus the subsequently added focused lineage-name regression. Thirty-five targeted Chromium cases passed across deletion, dialog, spreadsheet orders, database/photo cleanup, code ownership, repeat purchases and payment protection. Coverage includes rollback, bulk/account isolation, earlier sealed revisions after amendment, staged report/preparation/carton cleanup, tombstones, reopening and backup/restore. English, Spanish and Chinese narrow-window checks passed; synthetic desktop/narrow dialog captures were inspected. Syntax, formatting, documentation and diff checks passed, and the development build verified all 30 manifest resources.

The repository trial loop reported no configured local target: loaded, staged and verified remain false. Installed-extension/owner acceptance, the complete Chromium suite, full local `npm run verify`, native Excel and physical printing were not run for this correction. The owner's real library was not modified. The spreadsheet-import work remains preserved on the local integration branch; this correction has not been pushed, published or merged.

### Spreadsheet import code review — 2026-10-24

The local integration candidate adds workbook checks → editable grouped code review → atomic **Import and assign codes**. The `group` and `var` markers keep their existing meaning. Base and ending edits use the current purchase-month and ownership rules; unknown sizes and conflicting codes block final import. Current and historical owner details remain visible, and the reviewed source/photos/cartons/codes save together. [Code-review screenshot](screenshots/store-import-code-review.png) uses synthetic products.

Checked on Windows with native Node.js 24: all 1,445 unit tests passed; 21 targeted Chromium tests passed. The four affected browser cases passed again after the final validation-feedback adjustment. The backend regressions also verify database reopening and full backup/restore of edited assignments, source rows, original images and carton evidence. Source parsing, translation/automation/template checks, formatting and documentation checks passed. The development build verified all 30 manifest resources. Screenshot regeneration passed; the affected import captures were inspected. The template edit changed only its Guide worksheet; Orders, formulas, cached values, formatting and other archive parts were preserved and the edited Guide was rendered for inspection.

`npm run try` reported no configured local trial target, with loaded, staged and verified all false. Installed-extension acceptance, the complete Chromium suite, full local `npm run verify`, native Excel and physical printing were not run. This candidate remains on the local integration branch without publication or merge.

### Scoped tag restore correction — 2026-10-24

Later packing restores preserve background and text colors for newly assigned order/product tags while retaining same-named local definitions and existing settings. Unassigned incoming definitions are excluded from the merge. Synthetic regressions cover both scoped-initialized and manually saved settings, repeated restores and database reopening.

Checked locally on Windows with native Node.js 24: changed JavaScript syntax and documentation checks passed; all 1,435 unit tests and 20 targeted Chromium tests passed; the development build verified all 30 manifest resources. `npm run try` reported `no local trial target: nothing loaded` with loaded, staged and verified all false. Installed-extension/owner acceptance, full `npm run verify`, native Excel and physical printing were not run for this correction. These results do not establish installed-extension acceptance or store readiness.

### SEAL 2.10.0 local verification — 2026-10-23

The local candidate was checked with native Node.js 24 on Linux using synthetic fixtures and temporary browser profiles. These results cover the Orders/container implementation; they do not establish owner workflow acceptance or store readiness. The complete verification, **npm run verify run as 4 serialized CI shards**, belongs to commit `8de6633adc03f5089c3157d53c9f2f3eaf7c516f`, tree `e64a3cf59a24f6b061e62d7fbf790791feff47e6`; the four browser parts use the same frozen commit and build, with `CI=1`, trace off, full Chromium and no headless-shell browser. This follow-up changes only this verification record and the browser CI job budget from 15 to 25 minutes so dependency setup does not cancel a passing shard. Application, tests, assets and all test/case budgets remain unchanged; hosted verification runs again on the exact follow-up head.

| Evidence                                  | Result                                                                                                                                                                                                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source syntax and documentation           | Passed.                                                                                                                                                                                                                                                       |
| Unit regressions                          | Passed: 1,435 tests; zero failures, cancellations or skips.                                                                                                                                                                                                   |
| Production rebuild                        | Passed: complete extension 2.10.0; 30 manifest resources checked.                                                                                                                                                                                             |
| Complete Chromium suite                   | Passed: all 567 unique tests in four serialized CI shards (142 + 142 + 142 + 141); zero failures, skips, retries or flaky results.                                                                                                                            |
| Real synthetic operator paths             | Passed: China 1,350-unit/15-carton import; exact uneven 1688 report (63 pieces, 57.22 kg, 0.461256 m³); and 100/45 remainder reconciliation, each through loading and seal.                                                                                   |
| Migration, restore and immutable evidence | Passed automated synthetic checks, including actual pre-SEAL 2.9/464 full/monthly archives, original photo bytes, semantic quantities/value, held legacy evidence, ownership/witness dependencies and stale/forged-write refusal.                             |
| Physical marks and PDF generation         | Passed automated recorded/current mark, fresh relabel/keep, returned-carton recovery, historical reprint and stale-render/no-side-effect checks. PDF evidence is separate from physical printing.                                                             |
| Portable local trial                      | Passed tests and complete development build, then reported `no local trial target: nothing loaded`; loaded, staged and verified were all false. No installation or owner database was touched.                                                                |
| Synthetic screenshots                     | Passed generation of 13 repository images and two narrow captures. Changed images were viewed; the complete export-preview image was retained from its reviewed, byte-identical prior capture after a loading race in regeneration. No older UI was restored. |
| Installed extension / owner acceptance    | Not run: no local trial target is configured; the old owner install/database were deleted by owner order and were excluded.                                                                                                                                   |
| Native Excel                              | Not run. Actual XLSX, formula, media and clipboard assertions are automated evidence.                                                                                                                                                                         |
| Physical print / hardware scanner         | Not run.                                                                                                                                                                                                                                                      |

The extension key and durable `1688-order-library` database/backup compatibility identifiers remain unchanged. Fresh physical relabel confirmation inside a cancelable shipment amendment is refused; keep/history and proposed printing remain available. Complete the amendment or use unsealed cartons before recording actual relabeling. The SEAL remains open for owner workflow acceptance; no store submission is claimed.

### Historical 2.9.0 handoff verification

The renamed 2.9.0 handoff and its verification corrections were checked on 2026-10-22 using native Node.js 24 on Linux and synthetic data in temporary browser profiles. The export tests explicitly opt into detailed automation JSON while retaining workbook, cost and summary-content assertions. Narrow export controls remain clickable without forcing pointer actions.

| Evidence                               | Result                                                                                                                                                                                                                                                |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source syntax and documentation        | Passed.                                                                                                                                                                                                                                               |
| Unit regressions                       | Passed: 1,047 tests; zero failures or skips.                                                                                                                                                                                                          |
| Production rebuild                     | Passed: complete extension; 28 manifest resources checked.                                                                                                                                                                                            |
| Chromium                               | Passed: all 538 tests, serialized; zero failures or skips. The 23-test affected packet also passed.                                                                                                                                                   |
| Backup/restore                         | Passed synthetic browser checks: referenced original photos and history retained, unreferenced cache images omitted, a backup above 64 MiB restored/exported, compressed restore/corruption checks and scoped annotation/month equivalence preserved. |
| Installed extension / owner acceptance | Not run: no local trial target configured. No installed library was used for tests.                                                                                                                                                                   |
| Synthetic screenshot regeneration      | Not run for this verification batch; existing documentation images are synthetic.                                                                                                                                                                     |
| Native Excel                           | Not run for this candidate. Downloaded XLSX content checks are browser evidence.                                                                                                                                                                      |
| Physical print / hardware scanner      | Not run. Generated PDF checks do not establish physical acceptance.                                                                                                                                                                                   |

Earlier Chromium/Edge/native-Excel results apply only to their checked snapshots. These local results do not establish live 1688 compatibility, owner acceptance or store-publication readiness.

### Known limitations

- One buyer account per library; unsupported layouts, installments, unknown adjustments or unreconciled totals fail explicitly.
- Local naming is rule-based; unknown or ambiguous products/sizes/materials need review.
- Independent libraries do not coordinate code numbering. Current assignments and sealed code history reserve identities within each library.
- Capacity proposals require physical confirmation. Partial aggregate measurements remain unknown unless supported by actual evidence; missing measurements retain their coverage disclosure.
- Excel pictures float; other spreadsheet apps, custom row heights and native in-cell conversion require their own verification. Packing export creates a new XLSX.
- Unique originals still consume backup/storage memory. Uncached remote photos need a connection.
- Publisher details, live policy, rights-cleared/store-sized assets and Dashboard choices remain unfinished.

### Rejection history

No supplied or verified store review/rejection history. No submission package or publication is claimed.
