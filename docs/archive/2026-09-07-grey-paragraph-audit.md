# Grey-paragraph audit — all four estate sites (2026-09-07)

**Audience:** the owner (decision list) and future sessions doing the cuts. **Status:** TRACKED, one-off data dump (archive). **Last verified:** 2026-09-07 03:45 Phoenix — file:line numbers were spot-checked on ~20 items by the auditing agent, NOT all 230; no URL was verified live. Produced by a read-only Opus audit dispatched from the conductor session after the owner rule of 2026-09-07 02:50 ("We need less grey paragraphs. If a feature isn't self sufficient with just the way it works we should flag it for a paragraph instead of defaulting"). The live TODO item is in `docs/TODO.md` ("OWNER RULE 2026-09-07 02:50 Phoenix"); this file is the list it points at.

**Convention:** `N. **REC** — "text" — file:line — where it renders — reason`. Error/refusal copy, one-line empty states, `title=` tooltips and pure data lines are excluded. `[prior-trim]` marks an in-code comment saying the paragraph deliberately survived the 2026-08-17 estate-wide trim — cutting one reverses an earlier owner decision.

## Counts

| Site | KEEP | CUT | SHORTEN | Total |
|---|---|---|---|---|
| 1 — Library catalog | 24 | 55 | 33 | 112 (items 1–112) |
| 2 — Board games | 14 | 22 | 5 | 41 (113–153) |
| 3 — Audiobooks/ebooks | 9 | 11 | 2 | 22 (154–175) |
| 4 — Apex heygabi.ai | 22 | 19 | 14 | 55 (176–230) |
| **Total** | **69** | **107** | **54** | **230** |

Counts are MEASURED from the numbered items below (script over this file, 2026-09-07 04:05 Phoenix). The auditing agent's own headline said 76/102/52; its per-item recommendations — the part that gets acted on — add up to the figures above, so those are the ones recorded.

Densest pages: library `/queue` (`pages/DetailsQueuePage.tsx`, 7 paragraphs + a disclosure, already trimmed 2026-08-17); library `/` (`pages/CollectionPage.tsx`, 9 paragraphs, 8 conditional filter notes that stack); apex `/status` (12 `.section-note` paragraphs). Runners-up: the library book page's edit stack (`WorkFields` + `CoverPanel` + `Editions` + `DeleteWork` = 20 paragraphs, 4 exact duplicates) and `/status/pipelines`.

## SITE 1 — Library catalog (`library.heygabi.ai` + `padhard.heygabi.ai`) — `apps/web/src`

### Sign-in / shell (`App.tsx`)
1. **CUT** — "Our books, on the shelf and on the Kindle." — `App.tsx:199` — signed-out gate, any URL — a tagline under an `<h1>Library</h1>` that repeats it.
2. **SHORTEN** — "The same Google account as the audiobook catalog. Signing in here does not create a…" — `App.tsx:203` — signed-out gate — only the first clause is non-obvious → "Same Google account as the audiobook catalog."

### Collection page (`/`)
3. **SHORTEN** — "Marked N books read, from N ratings you have written on the audiobook site. Change…" — `pages/CollectionPage.tsx:734` — `/` top strip after a read-sync — the count is data; the undo instruction is the only helper clause → "Change any on the book's own page."
4. **KEEP** — "**Recorded twice** means the same book is in the catalog as two separate records…" — `pages/CollectionPage.tsx:1173` — `/` with the Recorded-twice filter on — the board-game catalog uses "duplicates" for two copies; without this the empty result reads as a bug. [prior-trim]
5. **SHORTEN** — "A **universe** is the tier above a series — one world shared across several of them…" — `pages/CollectionPage.tsx:1181` — `/` with Universe filter on — → "One world across several series — most books belong to none."
6. **KEEP** — "**Format** and **Type** match a book that **has** one, not one that has only that…" — `pages/CollectionPage.tsx:1195` — `/` with Format/Type ticked — any-vs-only semantics are not inferable from checkboxes.
7. **SHORTEN** — "**My list** is your cross-catalogue reading list — the same one the audiobook site writes…" — `pages/CollectionPage.tsx:1208` — `/` with My-list/Read ticked — → "My list is shared with the audiobook site; Read is this catalogue's own."
8. **CUT** — "**Cover needed** includes books wearing a stand-in — an image we know is not that book's…" — `pages/CollectionPage.tsx:1237` — `/` with a Needs filter on — the chip labels already say it.
9. **SHORTEN** — "In **Type**, **Collector's edition** is one bucket for every special printing — exclusive…" — `pages/CollectionPage.tsx:1249` — `/` with Type ticked — → "Collector's edition covers every special printing."
10. **SHORTEN** — "Physical books only. The household's ebooks have their own shelf now — they are on the…" — `pages/CollectionPage.tsx:1273` — `/` recent-additions strip — → "Physical books only — ebooks are on the ebooks site."
11. **CUT** — "Physical books only — books held **only** as an ebook file are on the ebooks site." — `pages/CollectionPage.tsx:1306` — `/` after pressing "See all" — duplicates #10 two elements away; the "Show them here too" button beside it says the rest.

### Book page (`/work/:id`)
12. **CUT** — "Put it on the wishlist — a want, not a copy you own." — `pages/WorkPage.tsx:535` — book page, Want-this collapsed — the button says "Want this"; wishlist ≠ own is already the button's meaning.
13. **SHORTEN** — "Already on your wishlist. Ask again if you want it in another form — a hardcover of a…" — `pages/WorkPage.tsx:534` — book page, already-wanted state — → "Already wanted. Ask again for another format."
14. **SHORTEN** — "Marked read from your {rating} — change it above and it stays changed." — `pages/WorkPage.tsx:411` — book page, read-state row — → "From your rating — change it above."
15. **CUT** — "Noted. Automatically gathering content warnings and propagating them to matching titles is designed but not yet built…" — `pages/WorkPage.tsx:568` — book page, after requesting a warning check — a roadmap note pointing at a docs path; belongs in `docs/`, not the UI.

### Reviews / content notes (book page panels)
16. **CUT** — "This is written to the same place as your audiobook reviews — it will show up on both sites." — `components/Reviews.tsx:275` — book page → Reviews composer — the owner's own calibration example.
17. **SHORTEN** — "{MAX} characters or fewer. This is written to the same place as the audiobook site's content warnings — it will show up on both sites… One note per topic; adding the same one again replaces it." — `components/ContentNotes.tsx:280` — book page → Content notes composer — length belongs on the input's `maxLength`/counter → "Shown on the audiobook site too. One note per topic."
18. **CUT** — "Published sources have been checked for this book and listed none." — `components/ContentNotes.tsx:221` — book page → Content notes, checked-empty state — a state word, not a paragraph; fold into the heading.

### Audio match / series link (book + series pages)
19. **KEEP** — `REJECTION_COST`: "'Not this one' hides the recording from this book everywhere it is claimed: the shelf…" — string at `lib/shelf-view.ts:1839`, rendered `components/AudioMatchReview.tsx:176` — book page → ✎ Edit this book → Audio tab, above the reject buttons — the consequence of an irreversible-looking press; nothing else on screen says the review/TBR bridges are affected.
20. **CUT** — "**Marked as not this book.** It is hidden from the shelf, the series ladder, the audiobook filter…" — `components/AudioMatchReview.tsx:215` — same panel, after rejecting — restates #19 after the fact.
21. **SHORTEN** — "The audiobook catalog has no recording matched to this book. Nothing to confirm — if you own it on audio…" — `components/AudioMatchReview.tsx:161` — Audio tab, no-match state — → "No recording matched. A series match can be confirmed on the series page."
22. **CUT** — "This one comes from the series match you confirmed, not from a title match, so there is no single recording…" — `components/AudioMatchReview.tsx:223` — Audio tab, series-derived row — the row's own "via series" mark carries it.
23. **CUT** — "Set and save a series above first — then, if the audiobook catalog holds it, you can confirm the match here." — `components/AudioSeriesLink.tsx:75` — series page, no series set — a disabled control with a one-word reason would do.
24. **SHORTEN** — "The audiobook catalog has this series. Confirming links all in "X" to it — each reads as owned on audio…" — `components/AudioSeriesLink.tsx:139` — series page, unconfirmed match — → "Confirming marks every volume the catalog holds as owned on audio."
25. **CUT** — "All in "X" are treated as owned on audio wherever the catalog has the recording. Confirmed…" — `components/AudioSeriesLink.tsx:124` — series page, confirmed state — restates #24 post-hoc.
26. **CUT** — "No audiobook series in the catalog matches "X". Nothing to confirm — if you own these on audio…" — `components/AudioSeriesLink.tsx:169` — series page, no match — first sentence is the whole fact.

### Editing panels (book page)
27. **SHORTEN** — "Which one this is, when the title is only the series line. Shown under the title. The title itself is not editable — it is the join to your audiobook reviews." — `components/WorkFields.tsx:188` — ✎ Edit → volume field — → "The title is not editable — it joins your audiobook reviews."
28. **CUT** — "Shown with the credits. Leave blank for a book without one — most novels — and nothing is shown at all." — `components/WorkFields.tsx:208` — ✎ Edit → illustrator/translator field — blank-means-nothing is the default expectation.
29. **SHORTEN** — "Start typing to pick an existing series — that is what groups this book with the rest of it. An *audio* tag means…" — `components/WorkFields.tsx:228` — ✎ Edit → series autocomplete — → "An *audio* tag means the audiobook catalog knows this series."
30. **CUT** — "For a printing split across more than one physical book — the two-volume leatherbound of…" — `components/WorkFields.tsx:272` — ✎ Edit → "multiple volumes" checkbox — the checkbox label already says it.
31. **CUT** — "Emptying a field clears it, and puts that question back on the *what is missing* list." — `components/WorkFields.tsx:279` — ✎ Edit footer — expected behaviour of an empty field.
32. **CUT** — "This book has no author recorded, so nothing can be attached to it yet — filling the author in is always safe." — `components/EditTitleAuthor.tsx:181` — ✎ Edit title/author, author-blank — the field is visibly blank and required.
33. **CUT** — "Add the author to unlock reviews." — `components/EditTitleAuthor.tsx:199` — same panel — duplicates #32 nine lines later.
34. **KEEP** — "Clearing this marks the book as author-unknown — refused if reviews follow it." — `components/EditTitleAuthor.tsx:216` — same panel — names a refusal before it happens.

### Covers (book page)
35. **CUT** — "Marked as a **stand-in** — the image above is not this book's own cover, and this book stays on the 'cover needed' list…" — `components/CoverPanel.tsx:144` — Cover panel, stand-in state — the "stand-in" badge above says it.
36. **SHORTEN** — "No cover found. Every automatic source has already been asked; this one needs a person." — `components/CoverPanel.tsx:150` — Cover panel, empty — → "No cover found — every automatic source was asked."
37. **CUT** — "The link to the image **file**, not the page it sits on. It is fetched and checked before anything is saved…" — `components/CoverPanel.tsx:215` AND `components/Editions.tsx:243` (identical, two places) — Cover panel / Editions cover form — the placeholder can carry "https://…/cover.jpg".
38. **CUT** — "JPEG, PNG, WebP, GIF or AVIF, up to N MB. The file is checked by its own contents, not by what it claims to be." — `components/CoverPanel.tsx:250` AND `components/Editions.tsx:280` — same two forms — `accept=` on the input plus the size in the error is enough.
39. **CUT** — "Nothing is lost by swapping: covers this app hosts are stored under a name derived from the image itself…" — `components/CoverSwap.tsx:170` — ✎ Edit → Choose from known covers — four lines of storage internals for a reversible click.
40. **SHORTEN** — "No covers are known for this book — no printing carries one, it has worn no other, and Open Library has nothing…" — `components/CoverSwap.tsx:108` — CoverSwap empty — → "No covers known. Paste a link or upload a file."
41. **CUT** — "Only one cover is known for this book, so there is nothing to swap between yet." — `components/CoverSwap.tsx:118` — CoverSwap, single-candidate — don't render the control.
42. **KEEP** — "The web search is the last resort for books the free cover sources cannot supply — it spends money (~6¢) and asks before each run." — `components/EditBox.tsx:339` — ✎ Edit → Search the web for a cover — money.
43. **CUT** — "Use **Choose from known covers** above to pick from covers the catalog already knows." — `components/EditBox.tsx:333` — same panel — points at a button two rows up.
44. **SHORTEN** — "The search did not find a cover for this book. That is a normal answer for the titles that reach this step…" — `components/EditBox.tsx:348` — after a failed cover search — → "No cover found — a normal answer here."
45. **KEEP** — "The image did not load in your browser, even though the server could fetch it — usually a site that blocks hotlinking. Saving it would leave a blank tile." — `components/EditBox.tsx:383` — cover-candidate result — explains a visibly contradictory result.

### Copies / editions / accessories (book page)
46. **SHORTEN** — "Nothing recorded. This is for what arrived beside the book — a plushie, an enamel pin, an art print, a slipcase. It is kept on this page only and never counted on the collection." — `components/Accessories.tsx:177` — Accessories, empty — → "Nothing recorded. Extras that arrived with the book; never counted on the collection."
47. **CUT** — "Nothing recorded. An edition existing is not the same as a copy on the shelf — and nor is it the same as wanting one." — `components/Copies.tsx:291` — Copies, empty — the panel is titled Copies.
48. **SHORTEN** — "More than one member here is called "X", so this cannot be linked to an account without guessing which…" — `components/Copies.tsx:627` — Copies → person field, ambiguous name — → "Two members share that name — saved as typed, not linked."
49. **CUT** — "Saved as typed. No member here goes by that name — which is the ordinary case for somebody outside the estate." — `components/Copies.tsx:634` — same field — reassurance for a non-problem.
50. **CUT** — "Linked to X's account — the card will follow their name if they change it." — `components/Copies.tsx:621` — same field, linked — "· linked" chip already renders.
51. **KEEP** — "Names of estate members are not suggested here — that needs the Members permission. Typing the name still records it in full." — `components/Copies.tsx:640` — same field, no Members permission — a missing autocomplete is otherwise indistinguishable from a broken one.
52. **CUT** — "A scanned book is recorded as a paperback until someone says otherwise." — `components/Editions.tsx:486` — Editions → format field — the field shows Paperback selected.
53. **CUT** — "Recorded from {source}. Correcting it does not change that." — `components/Editions.tsx:840` — Editions row — provenance is already the line above.
54. **SHORTEN** — "No barcode printed on this copy — checked the object. The blank ISBN becomes a recorded fact instead of a gap." — `components/Editions.tsx:829` (same text `components/RescanPrompt.tsx:452`) — Editions/rescan ISBN field — → "Records the blank ISBN as a checked fact, not a gap."
55. **KEEP** — "One physical volume can be two catalog rows — an omnibus holding two books carries one barcode. The ISBN stays where it is…" — `components/RescanPrompt.tsx:168` — rescan prompt, shared-ISBN branch — the option is meaningless without it.

### Aliases / related / watches / delete (book page)
56. **SHORTEN** — "No other names recorded. This is for a book printed under a second title, or an author filed elsewhere under a pen name — the two cases no similarity score can work out for itself." — `components/Aliases.tsx:141` — Other names, empty — → "For a second title or a pen name."
57. **KEEP** — "The book keeps the title and author it has here. This adds a name lookups may use — it never rewrites the ones the reviews are filed under." — `components/Aliases.tsx:193` — Aliases form — people reasonably fear an alias renames the book.
58. **SHORTEN** — "Nothing linked. This is for connections a series column cannot hold — the same universe, an omnibus and its parts, a companion volume, or reading order across two series." — `components/Related.tsx:164` — Related, empty — → "For links a series column cannot hold — omnibus, companion, cross-series order."
59. **KEEP** — "Nothing in the catalog answers to that. A book has to be catalogued before it can be linked — otherwise a typo makes a second row for a book you already have." — `components/Related.tsx:286` — Related search, no match — explains why there is no "add it anyway".
60. **CUT** — "These two are already linked — {kind}. Saving adds a second kind of link rather than replacing it." — `components/Related.tsx:314` — Related, duplicate link — the existing link is visible in the list.
61. **SHORTEN** — "Nothing flagged. Add a note when something about this book looks wrong and you want to come back to it." — `components/Watches.tsx:91` — Watches, empty — → "Nothing flagged."
62. **CUT** — "No changes recorded. The log starts when this feature shipped — silence before that is absence of records, not absence of edits." — `components/Changes.tsx:81` — Changes, empty — a note about the app's own history, not the book's.
63. **KEEP** — "This book appears to have reviews. They live in the shared review store keyed by title and author, so deleting the record here does **not** delete them…" — `components/DeleteWork.tsx:156` — Delete, blocked/warned — a destructive action's true blast radius.
64. **SHORTEN** — "Remove this book from the catalog entirely — for a record that should never have existed, like a phantom from a bad scan. A duplicate of another book is a different problem…" — `components/DeleteWork.tsx:98` — Delete panel intro — → "For a record that should never have existed. A duplicate is a different problem."
65. **CUT** — "The full record — this work and every printing and copy above — is written to the change log first, as the undo material. Nothing here is reversible from the UI yet…" — `components/DeleteWork.tsx:186` — Delete panel footer — implementation detail; "not reversible" belongs on the button.

### Scanning / add (`/add`, `/scans`)
66. **SHORTEN** — "Applies to books you add next. Any row can disagree, and each book's page can fix it." — `components/AddBookPanel.tsx:592` — `/add` → format picker — → "Applies to books you add next."
67. **KEEP** — "Each photo costs about a penny to read, so it is one deliberate tap — never automatic." — `components/AddBookPanel.tsx:693` — `/add` → photo modes — money.
68. **SHORTEN** — "Point at the front cover, straight on, filling the frame. A cover also gives the series and volume, which a spine rarely prints." — `components/AddBookPanel.tsx:695` — `/add` → single-cover mode — → "Point at the front cover, straight on, filling the frame."
69. **CUT** — "Photograph one book's cover, or pick a photo, and what it says is read into a row you can check." / "Take a photo of a shelf, or pick one, and the books on it are read into a list you can check." — `components/AddBookPanel.tsx:810` — `/add` idle state — the mode buttons in `lib/add-modes.ts:85–114` already carry one-line blurbs.
70. **CUT** — "Point the camera at the barcode on the back. The five-digit price code beside it is skipped automatically." — `components/AddBookPanel.tsx:799` AND `:812` — `/add` barcode mode — the price-code clause is the only content and it is invisible machinery.
71. **CUT** — "Some books are worth having both ways. Add it if you want it separately, or leave it." — `components/ScanLines.tsx:489` — `/add` scan row, already-owned-inside-omnibus — the two buttons say it.
72. **KEEP** — "A second want of the same book would be two rows asking for one thing. If you are holding it, switch the target to Shelf above and press again." — `components/ScanLines.tsx:524` — scan row, duplicate wish — names the control that resolves the block.
73. **KEEP** — "You are adding this as {X}. Open Library records this printing as {Y} — you are the one holding it, so take whichever is right." — `components/ScanLines.tsx:563` — scan row, format disagreement — a visible contradiction that needs an owner.
74. **CUT** — "Nothing half-finished. Scan a stack of barcodes{, or photograph a shelf,} and whatever you do not sort now waits here." — `pages/ScanJobsPage.tsx:72` — `/scans` empty — first sentence suffices.

### Arrivals / pre-orders / wishlist / TBR
75. **SHORTEN** — "N books here are paid for and still on their way. When the parcel turns up, this puts the lot of them on the shelf at once." — `components/Arrivals.tsx:204` — Arrivals modal — → "Marks the lot as arrived."
76. **KEEP** — "Untick anything that did **not** turn up — a volume still to ship, a pledge fulfilling in waves. Unticked rows stay exactly as they are." — `components/Arrivals.tsx:216` — Arrivals modal — the last clause is the non-obvious safety fact.
77. **CUT** — "Nothing is ticked, so there is nothing to mark. Close this and it is as though you never opened it." — `components/Arrivals.tsx:270` — Arrivals, nothing ticked — disable the button instead.
78. **CUT** — "Pick the wrong one and nothing is lost — the copies panel on the book page can put it back." — `components/PreorderPrompt.tsx:76` — pre-order arrival prompt — reassurance about a reversible choice.
79. **SHORTEN** — "Nothing on the list. A book lands here when one of its copies is *wanted* — add one here, press Want this on a book's page, or…" — `pages/WishlistPage.tsx:194` — `/wishlist` empty — → "Nothing wanted yet."
80. **CUT** — "Marking one as owned keeps the row — when you wanted it, and what you were going to pay — rather than starting a new one." — `pages/WishlistPage.tsx:219` — `/wishlist` header line — behaviour nobody will doubt.
81. **CUT** — "This is the same list as the audiobook site's — one entry for the book, whichever format you finish." — `components/Tbr.tsx:177` — book page → TBR button — repeated at #82 and #84.
82. **KEEP** — "…the same list as the audiobook site's, so a book you add there shows up here — and finishing it in any format takes it off both." — `pages/TbrPage.tsx:276` — `/tbr` header — ONE statement of the shared-list fact should survive; this is the home of record.
83. **CUT** — "Taken off your TBR — you have read it. Add it again above if you mean to re-read it." — `components/Tbr.tsx:171` — TBR, just-cleared — the row vanishing plus "Add to my TBR" says it.
84. **CUT** — "Nothing on your to-read list yet. A book page has an 'Add to my TBR' button, and so does the audiobook site — it is the same list." — `lib/reading-list-filter.ts:147` — `/tbr` empty — third copy of the shared-list fact.
85. **SHORTEN** — "N entries were repeats — the same book in another format. Each book is one card now, with a link to every format you have." — `pages/TbrPage.tsx:287` — `/tbr` when folding happened — → "N repeats folded — one card per book."
86. **CUT** — "They may also be books the two sites spell differently — the link on each card searches the sibling shelf by the title on your list." — `pages/TbrPage.tsx:359` — `/tbr` elsewhere-section — a second explanation under an already-explained section.
87. **SHORTEN** — "N books on your list are not in this catalogue — they will be audiobooks or ebooks the household holds elsewhere…" — `lib/tbr-elsewhere.ts:77`/`:83` — `/tbr` and `/` list filter — → "Held elsewhere — audiobook or ebook, no copy here."

### Series / universes
88. **KEEP** — "**Certainly missing** is worked out from the volume numbers you already own — a book 2 and a book 4 mean there is a book 3. Everything else rests on a named source…" — `pages/SeriesPage.tsx:122` — `/series` stat strip — the two stats are indistinguishable without it.
89. **CUT** — "The audiobook catalog has never heard of it, so only your own volume numbers say anything here." — `pages/SeriesPage.tsx:234` and `pages/SeriesDetailPage.tsx:229` — `/series`, `/series/:name` — the "no source" mark carries it.
90. **CUT** — "These are in the series but have no place on it, so they neither fill a gap nor create one." — `pages/SeriesDetailPage.tsx:340` — "off the number line" — the heading says it.
91. **SHORTEN** — "Two or more of these are on the shelf. An ebook and a hardcover of one book is not this…" — `pages/SeriesDetailPage.tsx:326` — owned-twice — → "Two or more physical copies — not one book in two formats."
92. **KEEP** — "Nothing here is guessed. If you know of a volume no source lists, record it with where you know it from — that is the only way it can ever appear above." — `pages/SeriesDetailPage.tsx:364` — above "Add a volume we know exists" — the evidence rule the server enforces.
93. **KEEP** — "With no length recorded the app says *'of at least N'*, which is all the evidence supports. Saying the number here lets it say the series is finished — so it needs a source, and the server will refuse it without one." — `pages/SeriesDetailPage.tsx:1184` — declare length form — names a refusal before it happens.
94. **CUT** — "A volume needs a number and either a link or a note saying how you know." — `pages/SeriesDetailPage.tsx:1136` — same form — field labels / disabled button.
95. **SHORTEN** — "Nothing in this catalog belongs to {name} yet — which is an ordinary answer, not a gap. Most of this world may be in the audiobook catalog." — `pages/UniversePage.tsx:162` — `/universe/:name` empty — → "Nothing here yet — most of this world may be in the audiobook catalog."
96. **CUT** — "The audiobook catalog reads the same list, so a world can be mostly over there." — `pages/UniversePage.tsx:135` — `/universe/:name` header — duplicates #95.

### GABI panel, estate search, export, people, worklist
97. **CUT** — "Ask about these books — what is missing, what a book says, what changed lately." — `components/GabiPanel.tsx:344` — GABI panel, empty — the example prompts below it demonstrate this.
98. **KEEP** — "GABI can look things up. It cannot change anything yet — edits are still made on a book's own page." — `components/GabiPanel.tsx:350` — GABI panel — a capability boundary people will otherwise test.
99. **CUT** — "She remembers the last half hour of a conversation, so you can come back to it in a new tab. After that it is gone." — `components/GabiPanel.tsx:359` — GABI panel — duplicated by #100 when it matters.
100. **SHORTEN** — "Picking up where you left off — GABI still has the last N things said here, from within the past half hour." — `components/GabiPanel.tsx:386` — GABI panel on resume — → "Picking up where you left off."
101. **CUT** — "Every shelf at once — audiobooks, these books, and the board games. The box on the collection page searches only the books catalogued here." — `components/EstateSearch.tsx:47` — estate-search hint — the component is labelled "Search the whole estate".
102. **CUT** — "Every row of every table, stamped with the applied migrations so a restore knows which schema it is looking at. **This is the one to keep.**" — `pages/ExportPage.tsx:99` — `/export` — keep only #103.
103. **KEEP** — "One row per book — formats, ISBNs, copies and read-state flattened beside it. A **flattened view, not the database**…" — `pages/ExportPage.tsx:115` — `/export` — the one genuine trap (CSV looks like a backup and is not).
104. **CUT** — "Generated when you press the button. Nothing is stored on the server and nothing is sent anywhere…" — `pages/ExportPage.tsx:128` — `/export` footer — privacy reassurance nobody asked for.
105. **CUT** — "Anyone with a Google account can sign in. Everyone listed here as anything other than pending can see the collection." — `pages/PeoplePage.tsx:80` — `/people` header — the roles table states each role.
106. **KEEP** — "A lookup **fills the answer in** — it does not ask first. Everything it writes is listed under *Recently filled in* below, with an Undo beside it." — `pages/DetailsQueuePage.tsx:438` — `/queue` — writes-without-asking is the one surprising behaviour. [prior-trim]
107. **KEEP** — "Counted from the run log. {model} at low effort; the estimate is tokens only and excludes Anthropic's own charge for the web searches." — `pages/DetailsQueuePage.tsx:493–503` — `/queue` cost strip — honesty marker on a money figure. [prior-trim]
108. **CUT** — "A book stays listed until you press Refresh, so you can read what its lookup filled in." — `pages/DetailsQueuePage.tsx:618` — `/queue` — the Refresh button is right there.
109. **SHORTEN** — "Written by a lookup without being read first. Undo puts the value back to empty and the question back on the list; it never touches anything typed by hand." — `pages/DetailsQueuePage.tsx:683` — Recently filled in — → "Written by a lookup, unread. Undo never touches hand-typed values."
110. **CUT** — "A lookup found these and could not write them — the value was not a usable year, number or piece of text…" — `pages/DetailsQueuePage.tsx:930` — stuck rows — the heading plus the rows say it.
111. **CUT** — "Already know the answer? Write it down — free, and it stops this being asked again." — `pages/DetailsQueuePage.tsx:1165` — row form — the form is visibly a form.
112. **KEEP** — "**Answered** means somebody looked and wrote down what they found — 'this is a standalone', 'nobody knows' — with a source. It is not the same as…" — `pages/DetailsQueuePage.tsx:802` — column headings — two lookalike headings are unreadable without it. [prior-trim]

## SITE 2 — Board game catalog (`boardgames.heygabi.ai`) — `boardbuddy/Board_Game_Catalog/apps/web/src`

113. **SHORTEN** — "First time here? Signing in doesn't let you in by itself — it puts you in the queue, and an owner approves you." — `SignIn.tsx:101` — sign-in — → "Signing in puts you in the queue; an owner approves you."
114. **KEEP** — "Camera not working? Photograph one barcode at a time, or pick a picture you already have — nothing taken here is saved to your library." — `components/BarcodeQueue.tsx:320` (same text `components/ScanPanel.tsx:757`) — `/scan` — keep one, cut the duplicate.
115. **KEEP** — "Some of those are in no free database — they are on the queue under whatever retail title we could find, to be named at review…" — `components/BarcodeQueue.tsx:373` — `/scan` after unknown barcodes — explains why rows look wrong.
116. **CUT** — "Nothing is added to the collection until you review it." — `components/BarcodeQueue.tsx:388` — `/scan` — duplicated at `pages/ScanJobsPage.tsx:386`.
117. **SHORTEN** — "Anything read off a code or a photo waits in the queue until you have dealt with it — nothing disappears because you only got through half." — `pages/ScanJobsPage.tsx:386` — `/scan/jobs` — → "Nothing is added until you review it."
118. **KEEP** — "Safari only allows camera access over `https`. Open the deployed site rather than a local network address…" — `components/CameraStage.tsx:91` — `/scan` camera stage on Safari — a silent failure otherwise undiagnosable.
119. **CUT** — "Multiple photos welcome. Each becomes a separate job in the queue." — `pages/ScanJobsPage.tsx:551` — upload control — the input is already multiple.
120. **CUT** — "These were catalogued before the game they belong to, and have just been filed under it." — `pages/ScanJobsPage.tsx:1144` — review — the rows show the new filing.
121. **CUT** — "Everything on this photo is dealt with. It stays here until you delete it." — `pages/ScanJobsPage.tsx:1190` — finished job — the Delete button says the second half.
122. **KEEP** — "Photograph the shelf again to get a fresh reading of it. If it keeps happening on new jobs that is worth reporting…" — `pages/ScanJobsPage.tsx:757` — unreadable job — tells the person when a retry is NOT the answer.
123. **CUT** — "This one was looked up before suggestions were kept. Press 'Look up again'…" — `pages/ScanJobsPage.tsx:1408` — legacy row — a migration artefact explained to the user.
124. **SHORTEN** — "No data. This is not matched to BoardGameGeek, so there is nothing to compare against — which is not the same as owning everything." — `components/Completeness.tsx:72` — `/items/:id` → Completeness — → "Not matched to BGG — nothing to compare against."
125. **CUT** — "Not checked yet. BoardGameGeek has not been asked what exists for this game. The weekly sweep will pick it up" — `components/Completeness.tsx:80` — "Not checked yet" is the whole fact.
126. **CUT** — "Everything BoardGameGeek lists as official for this game is set aside below…" — `components/Completeness.tsx:118` — the set-aside section has its own heading.
127. **KEEP** — "Checked {date}. Official components you could still buy and read only — promos, collectibles… N not yet classified, and counted in neither figure." — `components/Completeness.tsx:194` — states what the headline number excludes.
128. **KEEP** — "Every status change is recorded here and nothing can remove it — including deleting the copy, or the game." — `components/CopyHistory.tsx:44` — `/items/:id` → History — permanence.
129. **SHORTEN** — "The copy stays in the catalog and stops counting as held. This save is recorded in the game's history, which nothing can edit or delete." — `components/CopyEditor.tsx:247` — copy status editor — → "Stops counting as held. Recorded permanently in history."
130. **CUT** — "Pick one, then Save changes below. Nothing is lost either way — every printing stays recorded." — `components/CoverPicker.tsx:136` — cover picker — the Save button is visible.
131. **CUT** — "One cover is known for this game, so there is nothing to pick between." — `components/CoverPicker.tsx:114` — don't render the picker.
132. **KEEP** — "Tick anything you want as well. Nothing is ticked to start with — adding a game is not the same as wanting everything made for it." — `components/WishlistExpansions.tsx:213` — `/wishlist` add flow — a checkbox list defaulting to off is worth saying once.
133. **CUT** — "Open the game to see everything filed under it." — `components/WishlistExpansions.tsx:129` — the game link is right there.
134. **CUT** — "Adding it here records that you want **another** one." — `components/ScanPanel.tsx:817` — `/scan` wishlist target, already-owned — the target selector says "Wishlist".
135. **KEEP** — "Takes a minute or two and costs about a penny. Photographing the box is usually faster." — `components/ScanPanel.tsx:879` — paid lookup — money.
136. **CUT** — "Start with a base game — expansions and accessories file underneath it." — `pages/CollectionPage.tsx:345` — `/` empty — first-run advice.
137. **KEEP** — "Looks each game up on the web and fills only the blanks — anything already recorded is left alone." — `pages/DetailsQueuePage.tsx:191` — `/details` — writes-without-asking.
138. **CUT** — "Only games are listed. Anything filed under one takes its publisher from the game…" — `pages/DetailsQueuePage.tsx:200` — restated at `pages/ItemPage.tsx:900` and `:263`.
139. **KEEP** — "Each lookup takes twenty seconds to a minute and this page waits for it… leaving the page open is the sure thing." — `pages/DetailsQueuePage.tsx:209` — `/details` — in-code comment records a shorter, wrong version was already tried.
140. **CUT** — "Filled-in games stay listed until you press Refresh list." — `pages/DetailsQueuePage.tsx:288` — button is adjacent.
141. **SHORTEN** — "Only blanks are filled — anything already written down stays as it is. The free lookup uses the same sources as the scanner; searching the web costs a few cents and is the only thing that finds a publisher." — `pages/ItemPage.tsx:891` — → "Only blanks are filled. The paid web search is the only thing that finds a publisher."
142. **CUT** — "Anything filed under a game takes that game's publisher, and is not asked for a year…" — `pages/ItemPage.tsx:900` — third copy of #138/#141.
143. **CUT** — "Anyone can sign in, but only people you approve here can see the collection." — `pages/PeoplePage.tsx:86` — the Pending section demonstrates it.
144. **KEEP** — "What we have already asked GameUPC, UPCitemdb and Claude, so a repeat scan does not pay for the same answer twice. None of this is your collection…" — `pages/PeoplePage.tsx:217` — cache panel — a Clear button whose blast radius is otherwise frightening.
145. **KEEP** — "These share a name with something else you own. For each one: can you play it without the other box?" — `pages/RetagPage.tsx:89` — `/retag` — the question IS the interface.
146. **KEEP** — "Every photo and barcode session ever taken in, newest first, and what each one produced. Nothing here is deleted when a job finishes." — `pages/ScanHistoryPage.tsx:135` — permanence.
147. **CUT** — "Scan a barcode or photograph a shelf on the Add games page and it will be recorded here." — `pages/ScanHistoryPage.tsx:148` — empty — first-run advice.
148. **CUT** — "A game lands here when one of its copies has the status *wanted*…" — `pages/WishlistPage.tsx:235` — `/wishlist` empty — data model explained to the reader.
149. **KEEP** — "Shop links search that shop for the item's name — most of this list was crowdfunded and never sold at retail, so an empty result is a real answer." — `pages/WishlistPage.tsx:258` — stops empty shop results reading as broken links.
150. **CUT** — Arrivals: "Untick anything that did not turn up…" + "Nothing is ticked, so there is nothing to mark…" — `components/Arrivals.tsx:163` and `:244` — keep 163, cut 244.
151. **CUT** — "The form stays open so you can work along a shelf." — `components/QuickAdd.tsx:250` — quick add — the form visibly stays open.
152. **CUT** — "An expansion needs a base game — pick one, or name the one to wait for." — `components/WishlistAdd.tsx:486` — belongs on the disabled Save button.
153. **CUT** — "This is where links come off." — `pages/ItemPage.tsx:973` — related links — the buttons say "Unlink".

## SITE 3 — Audiobook / ebook catalog (`audiobooks.heygabi.ai`, `ebooks.heygabi.ai`) — `bookbuddy/audiobook_catalog/site`

154. **KEEP** — "Ebooks are not tagged here — the ebook shelf is permission-gated, so this page cannot see what is on it…" — `index.html:41315` (`div.lm-note`) — TBR/list row media tags — a missing tag would otherwise read as "I don't own it".
155. **CUT** — "Sign in with Google to keep a to-read list." — `index.html:43109` — book modal, signed out — a sign-in button would say it.
156. **KEEP** — "Opens Audiobookshelf in a new tab — {note}." — `index.html:43309` — book modal shelf link — in-code comment records a real incident (an unexplained Cloudflare Access sign-in).
157. **CUT** — "The site now uses live Google sign-in. Sign in once to carry this account forward…" — `account-modal.js:232` — account modal, legacy session — a migration notice long past its moment.
158. **SHORTEN** — "Streamed from the household library — no book files are kept on this device. Your place in the book is saved to your account." — `listen.html:281–282` — player footer — → "Nothing is stored on this device; your place is saved to your account."
159. **CUT** — "Your spot is saved as you listen — per book, per person… The skip interval stays on this device, because it is a thumb habit." — `listen.js:942–946` (`#ls-note`) — under the transport — the longest grey block in the estate; duplicates #158 and explains three settings nobody asked about.
160. **CUT** — "Nothing is downloaded to this device. Back to the shelf." — `read.html:542` — reader footer — third statement of the privacy claim.
161. **CUT** — "Read in the browser — nothing is downloaded." — `ebooks.html:651` — reading card — same claim again; the button says "Read". [prior-trim — file comment says "Do not grow this paragraph back"]
162. **KEEP** — "This book's pages are fixed images with the type printed into them…" / "Ink mode inverts the whole page, so pictures, maps and diagrams are inverted too…" — `reader.js:1417` and `:1420` — reading-mode toggle — explains a visible result the control cannot.
163. **KEEP** — "The token is what makes a run request real — the machine ignores requests without it. It is kept in this browser's localStorage and never committed." — `admin.html:129` — pipeline token — custody of a secret.
164. **CUT** — "Only your own role is readable from a browser; the full roster lives…" — `admin.html:260` and `:267` (two copies) — role card — implementation detail; at minimum de-duplicate.
165. **SHORTEN** — "The status card fills in the first time the pipeline runs" — `pipeline-status.js:105` — never-run — → "Fills in on the first run."
166. **KEEP** — "Requested — the machine checks every 3 minutes, so it starts within ~3 min (or is skipped if a run is already going or the cooldown is active)." — `pipeline-status.js:196` — after pressing Run — a request that does nothing visible for three minutes needs this.
167. **CUT** — "Leave the date empty for no scheduled meeting." — `club.html:469` — edit club — an empty optional date field.
168. **KEEP** — "Needs the estate bot in your server; only questions posted from now on appear." — `club.html:559` — GABI's-questions toggle — a prerequisite outside the app.
169. **KEEP** — "Finished the book yourself? Use 'I'm finished' on the book's discussion page instead — these buttons end the read for the whole club." — `club.html:570` — Finish/Abandon — prevents a club-wide action taken by mistake.
170. **CUT** — "Join the club to RSVP — everyone can still download the calendar file." — `club.html:914` — meeting card, non-member — don't render the RSVP buttons; keep the calendar link.
171. **KEEP** — "Only these accounts can run the club… Adding or removing accounts on this roster is done by a site moderator or admin…" — `club.html:1846` — manager roster — a permission boundary with a named escalation path.
172. **KEEP** — "Tagged to a section — hidden (question and results both) from members who haven't reached it yet." — `club-read.html:499` — poll composer — spoiler behaviour is invisible to the author.
173. **CUT** — "Review (optional — posts to the catalog's reviews)" — `club-read.html:453` — rating composer label — trim the parenthetical.
174. **CUT** — "Checks the library books and board games too — the search box above covers only this catalog…" — `estate-search-mount.js:150–151` — estate-search fold — the summary already reads "Search the whole estate".
175. **CUT** — "How to play / hints" list (5 `<li>`) — `guess-game.html:455–458`, `:464–465` — rules panel — the game teaches itself in one round.

## SITE 4 — Apex (`heygabi.ai`) — `catalog-platform/sites/heygabi-home/public`

176. **CUT** — "Remembered on this site only." — `index.html:799`, `docs/index.html:449`, `series/index.html:481`, `universes/index.html:494`, `status/index.html:79`, `status/agents/index.html:64`, `status/api/index.html:221`, `status/pipelines/index.html:78`, `status/processing/index.html:63` (`p.hg-cog-note`, 9 copies) + library `components/ThemeCog.tsx:136` — theme cog on every page — a preference nobody expects to sync.
177. **SHORTEN** — "Your choice is remembered on this site only — each catalogue keeps its own look until you change it there." — `admin/index.html:752` — `/admin` theme cog — cut with #176.
178. **CUT** — "'Do we own this in any format?' — one title, checked against every shelf at once." — `index.html:850` (`hint=`) — `/` search box — the placeholder and the button do this job.
179. **CUT (as a group)** — the six `p.what` card taglines — `index.html:904, 918, 939, 967, 1013, 1051` — `/` catalog cards — name + host line already identify each; if any survive, the admin one (1051) is the only one stating a gate.
180. **CUT** — "Not a shop and not a library — nothing here is for sale or for loan." — `index.html:1064` — `/` footer.
181. **KEEP** — "No tracking and no cookies. The search asks for a sign-in because it looks across the private shelves." — `index.html:1071` — `/` footer — explains why a public-looking page demands a login. [prior-trim]
182. **SHORTEN** — "One approval admits a person estate-wide; revoking shuts every door in minutes. Grants stage until the card's *Save permissions*; status buttons take two taps." — `admin/index.html:769` — `/admin` header — → "One approval admits estate-wide. Grants stage until Save permissions."
183. **CUT** — "Every runbook, design note and decision the estate has written down — three repositories, searched together, section by section." — `docs/index.html:458` — `/docs` header.
184. **KEEP** — "This searches a SNAPSHOT of the docs, republished by the home machine — anything written since the date above is not in it yet." — `docs/index.html:511` — staleness marker. [honesty marker]
185. **KEEP** — "No results means nothing in the docs says it, which is not the same as it not being true." — `docs/index.html:515`. [honesty marker]
186. **CUT** — "Every series the estate holds, volume by volume — who has which book…" — `series/index.html:496` — `/series` header.
187. **KEEP** — "A volume listed means it is in a catalog — some entries are wanted, not owned…" — `series/index.html:534` (also `series/series.js:525`, `universes/index.html:576`, `universes/universes.js:420` — four copies) — keep one, cut three.
188. **KEEP** — "'Nobody has this one' means nobody on the shelves *you* can see…" — `series/index.html:540` — a per-viewer result presented as an estate fact. [honesty marker]
189. **CUT** — "Every fiction the estate tracks across formats — tap one to see its books, audiobooks and games together." — `universes/index.html:507` — `/universes` header.
190. **CUT** — "Chasing one series? Series lists them volume by volume." — `universes/index.html:515` — make it a link.
191. **SHORTEN** — "Every service, read straight from its own public health endpoint. Green means… Run controls moved to Pipelines." — `status/index.html:101` — `/status` header — → "Read from each service's own health endpoint. Run controls are on Pipelines."
192. **CUT** — "A physical server mirroring the library from Drive… the tunnel was fixed 2026-08-20…" — `status/index.html:171` — shelf section — a dated changelog entry in a status page.
193. **CUT** — "How this estate works with AI agents — every rule below is a lesson that cost real time first. v2 · 2026-08-25." — `status/index.html:229` — agents-rules section subtitle.
194. **KEEP** — "The private estate-backups R2 bucket, written by backup.yml… Each row is graded on its oldest store…" — `status/index.html:265` — backups — the grading rule changes how every row reads.
195. **KEEP** — "Sizes are Cloudflare's own rounded figures and the cost is storage only — R2 also bills operations…" — `status/index.html:301` — storage — honesty marker on a money figure.
196. **KEEP** — "What each Worker says it is running, from its own /api/health. ⚠️ This is the **live build**, not the deploy log…" — `status/index.html:320` — versions — prevents the table being used as a rollback source.
197. **SHORTEN** — "index.heygabi.ai — one cross-catalog pointer table. A row's age is how long since that source last pushed, not how old its data is." — `status/index.html:333` — → "Age = time since that source last pushed."
198. **SHORTEN** — "The audiobook pipeline's own records… This page cannot see the pipeline's next run…" — `status/index.html:343` — → "Ages are from the last recorded run; the next run is not visible here."
199. **CUT** — "Each catalog's own API, reachable straight from its /api/health." — `status/index.html:355` — third "read from /api/health" on one page.
200. **KEEP** — "Reachability only — these hosts send no CORS header, so a green dot means 'answered a request,' not 'returned 200.'" — `status/index.html:363` — external hosts.
201. **SHORTEN** — "Errors, refusals worth seeing and deploy markers… This is a noticeboard, not a log…" — `status/index.html:382` — event ring — → "A capped noticeboard, not a log — the full stream is `wrangler tail`."
202. **CUT** — "Re-read every 30 seconds while this tab is open." — `status/agents/index.html:106` and `status/processing/index.html:104` — the freshness strip already shows an age.
203. **SHORTEN** — "Claude capacity — what is running, what has landed… Pushed from the conductor session…" — `status/agents/index.html:82` — → "Pushed from the conductor session — this shows the last published board."
204. **CUT** — "Newest first — dispatched, landed, failed. The conductor decides how far back the feed goes…" — `status/agents/index.html:114`.
205. **KEEP** — "Pushed with scripts/push-agent-board.mjs. Nothing on this page can start, stop or kill an agent…" — `status/agents/index.html:160` — a read-only page that looks like a control panel.
206. **SHORTEN** — "The keys that let machines outside the estate report in…" — `status/api/index.html:242` — → "Generate a key here and paste it into the machine — no secret is sent to anybody."
207. **CUT** — "Run controls for the estate's pipelines — devops and approvers only…" — `status/pipelines/index.html:96` — duplicated at `:110`.
208. **SHORTEN** — "Stops and starts the ingestion process flow… Pause asks what kind…" — `status/pipelines/index.html:132` — → "Only 'Until I unpause' survives a quiet GPU and the 12am window."
209. **KEEP** — "At latest. This is the longest it can last, not a promise…" — `status/pipelines/index.html:188` — pause-until form — a control that does not do what its label implies.
210. **KEEP** — "Standing weekly quiet hours… A blocker is **absolute while it is in force**…" — `status/pipelines/index.html:239` — blockers — precedence across four mechanisms.
211. **KEEP** — "While any of these is running the machine counts as in use… Type the name Windows uses (the image name, like Wow.exe)…" — `status/pipelines/index.html:264` — the image-name rule is the difference between working and silently not.
212. **SHORTEN** — "One stage in isolation, for recovery work… that is the most recent run only, not a history." — `status/pipelines/index.html:322` — → "Outcomes shown are the most recent run only, not a history."
213. **SHORTEN** — "Each row opens its real workflow on GitHub… The three Deploy rows share one workflow; pick the target there." — `status/pipelines/index.html:338` — → "Opens the real workflow on GitHub; the three Deploy rows share one — pick the target there."
214. **SHORTEN** — "GABI's knowledge base as it grows… Pushed from the home machine…" — `status/processing/index.html:81` — → "Pushed from the home machine — this shows the last published board."
215. **KEEP** — "Per-book progress as the pipeline last reported it. A percentage here is the pipeline's own count of finished units, never an estimate made by this page." — `status/processing/index.html:122`.
216. **CUT** — "Waiting, not running — audiobook-with-review, EPUB, text PDF and the deferred PDFs…" — `status/processing/index.html:130` — the lane labels list themselves.
217. **KEEP** — "Books that failed, and the scanned PDFs nothing can read yet. ⚠️ These two are different…" — `status/processing/index.html:154` — stops pointless retries.
218. **KEEP** — "Newest first. ⚠️ The date is when the pack became servable — not when the file was transcribed…" — `status/processing/index.html:164` — honesty marker the owner explicitly required.
219. **SHORTEN** — "Pushed with scripts/push-agent-board.mjs… The two per-book buttons above are the only things on this page that write anything…" — `status/processing/index.html:173` — → "The two per-book buttons file a request the machine reads on its next run — they start nothing."
220. **CUT** — "Joined the estate index — this card is written from the estate's own catalog registry." — `assets/apex-catalog-cards.js:165`.
221. **KEEP** — "It is sealed in your browser before it is sent, so the owner can never read it… Leave it blank and your catalog runs on the owner's key instead…" — `assets/apex-request-catalog.js:510` — API-key field — a secret's custody plus a money consequence.
222. **SHORTEN** — "The estate owner reviews every request before a catalog is created. Nothing is built by pressing this…" — `assets/apex-request-catalog.js:717` — → "This files a request; nothing is built by pressing it."
223. **CUT** — "What shows on this page once it exists. Change it freely." — `assets/apex-request-catalog.js:465` — display-name field.
224. **KEEP** — "Worth knowing before you ask: a board-game catalog takes longer to stand up than a book one…" — `assets/apex-request-catalog.js:89` — sets an expectation the UI cannot.
225. **CUT** — "Required. Every entry in the estate's universe list records why it exists." — `assets/universes.js:981` — "Required" on the label is enough.
226. **KEEP** — "A verse is a decision the owner records in the estate's universe list, so this asks him rather than adding one. Even a yes takes a rebuild of both catalogs…" — `assets/universes.js:806` — the delay is otherwise read as a failure.
227. **KEEP** — "Nothing here merges on its own… there is no undo button…" — `series/series.js:939` — pending-merge queue (approvers) — irreversible, two-way, no undo.
228. **KEEP** — "The numbering here runs to N, which is high enough that it is probably not a volume count — so nothing is guessed…" — `series/series.js:286` (and `:298`) — explains why the gap analysis is absent.
229. **KEEP** — "Blockers are absolute while they are in force…" — `assets/ingestion-time.js:730` — same rule as #210 rendered dynamically; one of the two should own it.
230. **CUT** — "The pause until {t} has finished — ingestion is free to start again. The expired timer clears itself…" — `assets/ingestion-time.js:769` — self-clearing housekeeping.

## Duplicate strings worth one decision each

- "Remembered on this site only." — 9 apex copies + 1 library = 10.
- "A volume listed means it is in a catalog — some entries are wanted, not owned…" — 4 apex copies.
- "The link to the image file…" and "JPEG, PNG, WebP…" — 2 copies each in the library.
- "nothing taken here is saved to your library" — 2 board-game copies.
- "nothing is downloaded to this device" — 3 audiobook-site copies.
- "the same list as the audiobook site's" — 3 library copies.
- "Point the camera at the barcode… price code" — 2 copies in one file.
- "Only your own role is readable from a browser" — 2 copies in one function.
- "Re-read every 30 seconds while this tab is open." — 2 apex copies.

## NOT VERIFIED

- `audiobook_catalog/frontend/src` is EMPTY (0 files; directory scaffolding only). The live frontend is `site/*.html` + `site/*.js`, which is what was audited. `frontend/dist`, `frontend/public`, `frontend/docs` not opened.
- `site/index.html` is 9.4 MB and generated — read by region (lines ≥ 40 800 and `<p>`/`<small>`/`.empty`/`var(--muted)` markup), not end to end; its generator `app/web/html_builder.py` was not read.
- `site/build/`, `site/archive/` skipped. Board_Game_Catalog `packages/*` and `apps/worker` not scanned (frontend only).
- `assets/estate-search.js` (the shared estate-search web component vendored into all four sites) was excluded to avoid quadruple-counting — needs its own pass; a change there lands on all four sites at once.
- No URL was verified live; routes come from `router.tsx` path literals and file paths.
- #179 (apex card taglines) is a judgement call at the edge of the definition.
- `[prior-trim]` markers come from in-code comments, not a docs cross-check: items 4, 106, 107, 112, 161, 181.
