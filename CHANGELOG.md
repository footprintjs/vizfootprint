# Changelog

## Unreleased

### Added: date-text ordering warning

- Folded temporal domains report a positive inspected-string ordering witness.
  The built-in frame and line show the same scoped warning visibly and in the
  accessible name, in a separate annotation band. Original strings, intervals,
  SQL, brushing and replay are unchanged; an absent witness promises no safety.
  This amends the unreleased renderer protocol 1.12.

### Internal: temporal domain ownership

- Move the existing temporal fold and instant reader into their own module,
  with the domain type in a shared owner. Domain values, parsing, tie handling
  and the public frame exports are unchanged. No date-order warning is added.

### Correction: a date axis is folded by instant, not by text

- The fold made a date span by comparing the cells as text. That is
  chronological order only while every cell is spelled the same way. A
  column that mixes spellings is not in text order: `2026-04-01T23:00-05:00`
  sorts before `2026-04-02T01:00Z` and is three hours after it. A chart
  places a date as an instant, so the span could leave a row the chart
  draws outside its own axis, and the chart then said so about data that
  was only spelled differently.
- The fold now compares what `Date.parse` makes of each cell, the same
  reading the charts place it by. The answer is still the earliest and the
  latest cell as written, so a column folds to the pair it always did
  wherever text order was already chronological. It was not at a few edges
  even in one spelling (a day that does not exist, such as `2026-02-30`; a
  month 13; a clock time in a daylight-saving gap; a year before zero);
  there the fold now agrees with the chart.
- The reading is `Date.parse`'s: a date-time with no zone is read in the
  zone of the process that folds, and text that is not ISO-8601 is read as
  a date wherever the JavaScript engine reads it.
- A string no date can be read from is now an absence, as an invalid `Date`
  already was. It used to be compared as text and could become an end of
  the axis that no chart could read.

### Correction: a chart says "declared bounds" only where bounds were declared

- A chart that draws a mark outside the span of its axis says so in words.
  Two sentences exist: one for DECLARED bounds, which says either the
  bounds are wrong or the data is, and one for a span the chart was merely
  given, which blames nobody.
- A chart could not tell which kind of pair it held. The scatter and the
  line's value axis always said "declared bounds", also for a span a frame
  had folded from the rows, where nothing was declared.
- The chart is now told: `ChartDomain.declared` (`{ x?: boolean, y?:
  boolean }`), set by the stack door and the plain-view door for the axis
  whose pair was read off `bounds`. The scatter and the line choose their
  sentence by it, on both axes (`declaredOn`). The line's x axis, which
  never said "declared", now does where its bounds are declared.
- **A change for a host that hands a chart a `domain` itself:** with no
  `declared` the scatter and the line's value axis now say "outside the
  span this axis was given […]" where they said "outside its declared
  bounds […] — bounds say what the quantity CAN be…". Pass `declared: { y:
  true }` for a pair that is a declaration.
- Unchanged: a count axis (bar, histogram) and a mark with width (a
  histogram's bins, a heat map's columns, a box) say the neutral sentence
  either way. A count names both the pair it was given and the pair it
  drew. A bin's or a column's edges are the binning's choice, and a box
  reaches past the span when only an outlier does, so the sentence about
  wrong data would not be true of them.

### Correction: a logarithm, bounds or `zero` on an axis that is not a number axis is refused

- All three are statements about numbers. On a category or a date they
  were read as nothing: the axis was drawn as if the setting had not been
  declared, with no word.
- The definition door already refused `transform: 'log'` and `bounds` on a
  column declared as a date or a string. It now refuses `zero` there too
  (`frame.x.zero needs a number — view "net" binds x to "group", a
  string`). **A break:** a definition that declared `zero` on such a column
  built before.
- The door judges the column a mark binds at the start, where its type is
  declared. A column whose type is not declared, and a column a view is
  bound to later, are judged by the renderer. A view drawn alone, and a
  layer of a stack, now refuse any of the three on a channel the fold made
  a band of categories or a run of dates (`… on an axis the frame folded as
  a category. Drop it, or bind x to a number.`). On an axis the mark makes
  a band, a bar's category or a box plot's x, a logarithm or bounds are
  refused whatever the column, and `zero` where the fold made the column a
  category or a date (`… and a bar's category is a band. Drop it.`). **A break:** that chart drew before, with the
  setting ignored.
- So that the renderer can see `zero`, the fold echoes a declared `zero`
  on a channel it folded as a category or a date, where it could not apply
  it (`ResolvedChannel.zero`; recorded under protocol 1.12). On a number
  axis the fold applies it and the answer is unchanged.
- Not caught, two cases. `zero` on a bar's category or a box plot's x
  bound to a number column of undeclared type: the fold applies it to a
  span the band never reads, and does not echo it. And a logarithm on an
  independent channel over columns that are not numbers, in a stack: the
  fold gives an independent channel no scale kind.
- New export from `vizfootprint/def`: `needsANumberRefusal`, the one owner
  of the sentence.

### Correction: a declared axis with no span to fold reaches the picture of a view drawn alone

- The fold answered nothing for a channel with no readable cell (the read
  was refused, every cell was a silence, `basis: 'rows'` read no rows, a
  logarithm could place none). A curve, a zero line or bounds declared on
  that channel then reached no picture, with no word: a view that declared
  a logarithmic axis over values a logarithm cannot place drew a linear
  one.
- The fold now answers an entry for such a channel where one of the three
  was declared: the declaration, `unfolded: true`, `scaleKind` (what the
  column would have folded as), and no span. No span is invented. Where the
  column's type is unknown too, declared bounds or a declared logarithm say
  it is a number.
- A view drawn alone draws it: a logarithmic axis with the count of values
  it could not place; declared bounds as the axis over no rows; a declared
  zero line on the chart's own extent.
- **A stack does not, and is drawn exactly as before.** With no span each
  layer stands on its own extent, and one axis or one zero line over them
  would be untrue, so `layeredRenderer` reads the frame without such
  entries. That a stack drops such a declaration with no word is older than
  this change and is a task of its own.
- Still dropped, for a view too: `zero: true` on a channel with no span (it
  asks a span to reach zero, and there is none), and a zero line alone on a
  column whose type is unknown.
- **Protocol 1.12, for a reader of `RenderState.frame`:** a shared channel
  may now be this entry. It has no `scale` and no `domain`. Code that reads
  `domain` only after matching `scale` to a kind is unaffected. Code that
  treats "not quantitative and not categorical" as a date axis and then
  reads `domain` must add a check. New exports from `vizfootprint/def`:
  the type `UnfoldedDomain` and `scaleKindOf(channel)`, which answers what
  a shared channel's column is whether or not a span was folded.
- A channel that declared none of the three still gets no entry.

### Correction: the definition door refuses what the renderer refuses about a count

- The renderer refuses three declarations about a bar or a histogram,
  because each would draw something untrue. The definition door accepted
  all three, so a definition it passed could be refused when drawn. The
  door now refuses them too, in the renderer's own sentences:
  - bounds on the `y` a bar or a histogram binds that do not start at zero,
    or end below one (a count is drawn from zero whatever is declared);
  - `transform: 'log'` on the `y` a histogram binds (its `y` is its count;
    its bin axis, `x`, may still be logarithmic);
  - a bar or histogram layer that binds no `y` beside a layer that binds
    one (the count would be read against an axis that is not its own).
- A layer is judged by what its `initial` binds (a layer cannot be
  re-encoded). A plain view is judged by its `channels`, because one
  `reencode` would bind them: a plain bar that declares `y` with bounds
  [2, 20] is refused although it binds no `y` yet.
- **A break:** a definition that declared one of these built before and is
  now refused by `validateDashboardDef` and `buildDashboard`, with the way
  out in the sentence.
- In the renderer, bounds with a bound that is not a finite number (only a
  frame folded by hand can hold one) are refused under a count.
  `[Infinity, 0]` was refused before; `[0, Infinity]` was drawn exactly as
  if no bounds had been declared, and is now refused too.
- Each law has one predicate and one sentence, exported from
  `vizfootprint/def`: `COUNT_MARKS`, `boundsFitACount`, `countBoundsRefusal`,
  `histogramCountLogRefusal`, `countOffAxisRefusal`. The renderer asks the
  same ones.
- Not a door matter: a shared `y` whose rows reach below zero under a bar
  and a line depends on the data, and is refused when drawn.

### Correction: a count that binds no y is refused beside a layer with a y axis

- In a stack, a bar or a histogram that binds no `y` is scaled by its own
  ceiling and draws no axis. A layer beside it that binds `y` has one
  drawn. So the plot held one `y` axis that the count was not on, and every
  bar was read against numbers that were not its own, with no word.
- **That stack drew before and is now refused in words.** The sentence
  names the way out: bind the count's `y` to its count field, or give the
  count a frame of its own. With its `y` bound the layers share one scale
  or take two that the frame says in words, or the stack is told its next
  step in words (a bar on a scale of its own must be declared first; a
  shared `y` below zero, or with bounds a count cannot stand on, has its
  own sentence).
- Judged only where a `y` axis is drawn. A stack in which no layer binds
  `y`, or whose merged guide was folded with no `y`, draws none and is
  drawn as before.

### Added: a test that walks every axis key a plain view may declare

- `AXIS_KEYS` is exported from `vizfootprint/def`: the keys a definition may
  declare on the axis of a view with no layers (`transform`, `domain`,
  `basis`, `guide`, `zero`, `zeroGuide`, `bounds`).
- A new test takes that list and, for each key, builds a real definition,
  reads the view from the store, folds it through `viewFrameFor` and draws
  it with the scatter renderer. A key added to the definition fails the
  test until it has a case. For `transform`, `zero`, `zeroGuide`, `bounds`
  and `basis` the case fails if the key is lost at the session, the store,
  or the fold; for `domain` and `guide`, which have nothing to change on a
  view with no layers, it proves only that the entry survives. No
  behaviour changes.

### Added: `viewFrameFor`, the frame door for a view with no layers

- A definition may declare axis settings on a plain view (a logarithmic
  curve, a zero line, bounds, reaching zero, which rows), and since the
  change below the single-mark renderers honour what `RenderState.frame`
  holds. But the adapter's `frameFor` folds layers and answers `{}` for a
  view with none, so those declarations never reached the renderer.
- `viewFrameFor(session, { viewId, table, chartKind, encodings, columns,
  frame })` folds the channels the definition named and the view binds, and
  nothing else. An axis the definition said nothing about gets no entry, so
  it is still drawn on the chart's own extent with its own margin.
- Rows are read as for a layer: `basis: 'rows'` at the view's own address,
  `'table'` with nobody's clause. Silences are dropped by the same code.
- `chartKind` is required, in the definition's word: the mark decides the
  zero default, so a bar's and a box plot's magnitude axis folds to reach
  zero.
- A host that draws plain views calls it and pushes the answer when it is
  not empty. Nothing calls it for the host: a host that does not call it
  draws as before.

### Correction: a view drawn alone honours what its frame holds for its axes

- The five single-mark renderers (scatter, line, bar, histogram, box plot)
  handed their chart an empty domain whatever `RenderState.frame` held. A
  logarithmic position axis, a zero line, declared bounds and a span folded
  to reach zero were all dropped for a view with no layers, in silence. A
  stack of layers honoured them.
- A view drawn alone is now treated as a stack of one: for each channel it
  binds to x or y that has an entry on the frame, the same function that
  builds a layer's scales builds its own, and the same list of refusals
  judges it, naming the view.
- **Visible changes** for a view whose frame holds an entry for its axis:
  - the axis is drawn on the span the fold gives it, with no empty margin
    at its ends, as a layer's is. An axis with no entry keeps its own
    extent and its margin;
  - a category list is the fold's: slots in the fold's order, and an empty
    slot for a category with no row. Before, a plain bar or line ordered
    its slots by its rows whatever the frame listed.
- **Refused in words now, alone and in a stack**, where the picture was
  drawn wrong or a declaration was dropped:
  - a logarithmic `y` under a bar or a box plot, in the definition door's
    own sentence, and under a histogram, in the renderer's own (each was
    drawn linear, in silence);
  - bounds on a bar's or histogram's `y` that do not start at zero or end
    below one (the count was drawn from zero, in silence);
  - for a view alone: a scatter whose x was folded as categories (every
    point was drawn at one x), a zero line its mark does not draw, and a
    histogram whose x was folded as categories.
- In a stack that was already refused, the sentence shown first can now be
  a per-layer one (a zero line, a drag) where it was a cross-layer one (two
  bands, a box plot on a shared band, a line split into series). Both are
  true; the second follows once the first is fixed.
- A view with no entry for either axis is drawn exactly as before.
- Reached today by a host that folds a frame by hand; the adapter does not
  yet fold one for a view with no layers.
- New export from `vizfootprint/def`: `logOnExtentRefusal` (the one owner
  of the sentence for a logarithm on a magnitude).

### Correction: every chart says what stands outside the span its axis was given

- A chart handed a span draws on it, and a mark past the span is drawn at
  its true place, which is past the plot's edge. The scatter and the line's
  value axis counted those marks and said so, in the picture and in the
  accessible name. The bar, the histogram, the box plot, the heat map and
  the line's x axis drew them in silence. They now say it too.
- The new sentence blames nobody: `x has 2 bins that reach outside the span
  this axis was given [25, 75]`. A chart is not told whether its span is
  declared bounds or one a frame folded, so it does not say "declared".
- It quotes the pair as it was given, and the pair as drawn where they
  differ: a count axis (bar, histogram) is read from zero, `given [3, 5],
  drawn as [0, 5] because a count is read from zero`; a flat or logarithmic
  pair is opened.
- A date axis writes a day, or the whole instant where a bound is not the
  start of a day.
- Nothing is moved, hidden or refused; a chart with nothing outside, or
  with no span given, is drawn as before. The scatter's and the line's value
  axis sentences are unchanged.
- New helper `dateOfEpoch`; `OutsideAsk` gains `undeclared`, `count`,
  `noun`, `format`, and takes a mark's two ends as a pair.

### Correction: a refused stack is told a way out that draws, with three layers too

- A bar and a line on one shared `y` that cannot stand on one span are
  refused in words (the change below). Where three or more layers bind
  `y` the sentence said to resolve `y` as `independent`, which is refused
  in turn: a frame has two sides and no third. There the sentence now says
  to draw the count on a frame of its own, and it names every count that
  binds the `y` (two bars and a line: both bars). Where two layers bind
  `y` the sentence is unchanged.

### Correction: a bar and a line on one shared y are drawn on one span

- In a stack, a bar or a histogram is read from zero and scales by zero up to
  the ceiling. A line handed the same shared `y` scaled by the folded pair.
  On a `y` folded as 40…100 the bar stood on 0…100 and the line on 40…100,
  under one axis that read 0…100, so the line was mislabelled.
- Where a count binds the shared `y`, every layer that binds it now takes
  the count's span (zero up to the ceiling, never a ceiling below one), which
  is the span the merged guide already ticked.
- **Two stacks that drew before are now refused in words**, each a count
  and a line that bind one shared `y`: one whose `y` declares `bounds` that
  are not a count's span (they do not start at zero, or end below one), and
  one whose folded `y` reaches below zero. In both the two layers stood on
  different spans. The sentence names the way out: a bar declared first with
  `y` resolved as `independent`; a histogram on a frame of its own.
- Unchanged: a bar that binds no `y` beside a line on the shared `y`.

### Correction: a filter's bound keeps the row it was taken from, on the SQL engine too

- The SQL engine (DuckDB) was handed a filter's numbers as plain decimal
  text. DuckDB reads such text as a fixed-point DECIMAL, and its conversion
  to the DOUBLE a column holds is not exact, so a filter whose bound is a
  value in the data could leave that row out. Measured on 5,000 doubles,
  `"v" BETWEEN v AND v` found its own row for 4,860. The memory engine
  compares doubles exactly, so the two engines disagreed (a reviewer saw 21
  of 400 intervals one row short on DuckDB).
- The statement the SQL engine runs now writes a number with a fraction in
  exponent form, which DuckDB reads as a DOUBLE: 5,000 of 5,000, for
  `BETWEEN`, `>=`, `<=`, `IN` and `=`. Whole numbers are written as before.
- **What a result reports and what the log records are unchanged.**
  `evaluate().sql` and `CommitRecord.predicateSQL` keep the plain decimal
  text, byte for byte. Only the statement handed to the engine differs, and
  only where a bound has a fraction.
- Every statement of a call runs the exact text: the window, its separate
  count, and both statements of a find.
- Two limits. A number with a fraction compared with an integer column makes
  DuckDB cast the column to DOUBLE for that comparison, so on a host's own
  BIGINT table two neighbouring values past 2^53 compare equal. And the
  Mosaic adapter still hands a host's coordinator the plain decimal text.
- New exports from `vizfootprint/data`: `executablePredicateSQL` and
  `exactLiteralSQL`.

### Correction: a tap at the edge of a histogram picks the bucket that stands there

- A tap beside a histogram's plot is held at the plot's edge. At the right
  edge the value worked back from that pixel could fall past the last
  bucket's end in its last digit, so the tap cleared the selection where it
  should have picked the last bucket (94 of 200 logarithmic and 13 of 200
  linear generated histograms). The tap now reads the value through
  `pointerValue`, as the scatter's and the line's drags do.
- `pointerValue` answers the scale's own inverse for a domain with no
  length (one value): such a scale reports the same number for both ends,
  which is not what stands at the far end of its range.

### Correction: a line's drag across the whole plot holds its two end points

- A line over numbers records the value under the pointer unrounded, and
  always did. At an edge of its plot the edge pixel's value could differ from
  the axis's own end in its last digit, so a drag across the whole plot left
  an end point out: usually the highest (a reviewer measured 12 of 150 linear
  and 66 of 150 logarithmic drags), and on a logarithmic axis sometimes the
  lowest. A pointer held at an edge of the plot is now the axis's own end,
  exactly: the rule the scatter took in the change below.
- New export `pointerValue(scale, px)`, the one owner of that rule; the
  scatter and the line both call it.

### Correction: a drag on a scatter records the value under the pointer

- A scatter rounded the two ends of a dragged range so they read cleanly. A
  rounded end has moved: a drag that reached the edge of the plot, where the
  smallest or the largest value can stand, left that value outside its own
  range about half the time on a logarithmic axis. The scatter now records
  the value under each end of the drag as it is, never rounded, which is the
  rule the line chart already kept. A pointer held at an edge of the plot is
  recorded as the axis's own end, exactly.
- **Behaviour change:** a range recorded by a drag on a scatter carries all
  its digits (107.33333333333333 where it was 107.33). Round it where it is
  shown; `roundToAxis` is for that and is unchanged.

### Correction: one value on a logarithmic axis is drawn inside the plot

- A chart with a single distinct value on a logarithmic axis widened that
  value by plus and minus one before the logarithmic clamp, so a value below
  about 0.11 was drawn far outside the plot with nothing said (a line or a
  scatter with x = 0.001 put its point at −848 px). It now gets a decade
  either side and stands in the middle, on the scatter's two axes, the line's
  two axes, the histogram, the heat map and a frame's guide.
- `domainOr` takes an optional third argument, the axis's kind, and
  `extentFor` no longer widens one distinct value on a logarithmic kind. A
  chart of your own on a logarithmic channel should pass the kind.
- A drag across a scatter's logarithmic x is rounded to significant digits:
  as many as it takes to tell one pixel from the next at that value, and
  never fewer than four (`roundToAxis` takes the axis's kind and what a pixel
  is worth). It was rounded to decimals chosen from a linear span, so a drag
  around 0.001 recorded [0, 0]. This changes what a drag on ANY logarithmic
  scatter records, not only one with a single value.
- A value outside a declared pair on a logarithmic axis is counted against
  the axis as it is drawn (`outsideNotes` takes the axis's kind). Where that
  differs from the declared pair (a flat pair, or a low bound at or below
  zero) the sentence names both: "outside its declared bounds [0.05, 0.05],
  drawn as [0.005, 0.5] on a logarithmic axis".
- `logDomain` keeps its decade inside what a number can hold, and `logTicks`
  answers nothing for a span with no finite end. A value near the smallest
  number threw, and one near the largest could loop without end.
- A declared flat pair at or below zero on a logarithmic axis now gets the
  placeholder decade 1 … 10, as an undeclared one always did.
- A linear axis is unchanged.

### Correction: a line over numbers follows a logarithmic x

- A line chart whose x is a run of numbers ignored `domain.transform.x`:
  under a logarithmic x it placed its points linearly, while a frame's guide
  and a point layer on the same frame placed them logarithmically. One value
  stood on two different pixels. The line now takes the declared curve.
- A point whose x a logarithm cannot place (zero or below) is not drawn and is
  counted in the chart's accessible name and in the picture, with the means a
  logarithmic y cannot place. A drag reads back the logarithmic span.
- A line over dates or a band is unchanged: a date has no logarithm and a
  band has no scale, so the key is ignored there.

### Charts: a frame's guide is ticked the way a chart's own axis is

- **Behaviour change.** The one axis a frame draws for a stack of layers was
  ticked at three even cuts of its span, rounded to a tenth: 0 … 20 read
  "0 6.7 13.3 20", and a signed span did not label zero. It now follows the
  rules of the charts' own axes: round values inside the span, written to the
  step's precision or against one unit, as many as have room. It asks for
  four steps, as the line chart does (the scatter asks for five).
- The guide is ticked over the span the layers draw on. A constant column
  (a flat span) used to put its tick at the plot's edge while the mark stood
  in the middle, and a span given backwards was mirrored against the marks.
  A stack that holds bars or a histogram is read from zero, as those marks
  are drawn. New export: `countSpan`, the one rule the bar, the histogram
  and the guide share for a count's span.
- A y label wider than the margin is squeezed into it, and an x label near
  the edge is moved inside the drawing. Both used to be cut off.
- A logarithmic axis shows the decades that have room. A date axis keeps its
  three even steps, each read back as its day, and drops days that would
  touch.
- The guide is drawn by `<Axis>`; its elements are inside
  `<g class="vzf-axis-part" data-axis-orient="…">`.

### Charts: the bar chart's count axis is ticked at round values

- **Behaviour change.** The count axis a bar draws as the first scale of a
  two-scale frame was ticked at three even cuts of its ceiling, rounded to one
  decimal: a tallest bar of 130 read "0 43.3 86.7 130". It is now ticked at
  round values from zero ("0 50 100"), as many as a line of text allows, and
  large counts are written against one unit ("0.5M"). The ceiling itself is
  labelled only when it is a round value.
- The ticks are still placed by the bars' own scale, and zero is always one
  of them. A ceiling that is not a number draws no label, where it wrote "NaN".
- The axis is drawn by `<Axis>`; a label wider than the margin is squeezed
  into it.

### Charts: the box plot's value axis is ticked at round values

- **Behaviour change.** A box plot's value axis was ticked at five even cuts
  of the data's extent, rounded to two decimals: values 2 … 99 read
  "2 26.25 50.5 74.75 99", and values 0.001 … 0.004 read "0" five times. It
  now follows the scatter's and the line's rules: round values inside the span
  the axis drew, written to the step's precision, as many as have room.
- A label wider than the margin is squeezed into it. It used to be cut off by
  the edge of the drawing.
- A date axis keeps its four even steps, each read back as its day. Days that
  would touch are now thinned, and a day wider than the margin is squeezed
  into it (it used to start outside the drawing and read "6-04-01"). A span
  shorter than a day still reads as one day several times.
- The ticks are worked out only when the chart draws its axis.
- The axis is drawn by `<Axis>`.

### Charts: the axis part takes placed ticks, and draws the line chart's x axis

- **Breaking for a host that used `<Axis>` from the change below** (the
  packages are unpublished): a tick is now `{ position, label }`, already
  placed in pixels, where it was a value plus a `scale` prop. `placeTicks`
  does that step for value ticks. `edges` and `labelRoom` are one option,
  `labelBounds`, the drawing's left and right edges.
- A tick can name its `textAnchor`, be `slanted`, and carry a `title` (the whole
  text of a shortened label). With these the line chart's x axis (dates,
  numbers or bands, level or slanted) is drawn by the same part. What the
  chart draws is unchanged.
- New exports: `placeTicks`, `AxisTick`, and the slant's two numbers,
  `TICK_SLANT_DEG` (read by the axis part and the label-fitting rule) and
  `TICK_SLANT_DROP` (read by the axis part and the line chart's room for
  slanted labels).

### Charts: one axis part

- New primitive `<Axis>` (`orient`, `scale`, `ticks`, `at`, `range`, `edges`,
  `labelRoom`, `hue`): the line a scale stands on, its tick marks and their
  labels. The scatter's two axes and the line's value axis are drawn by it.
  What they draw is unchanged; each axis's elements are now inside one
  `<g class="vzf-axis-part" data-axis-orient="…">`, so their order in the
  markup changed. Select an axis by `[data-axis-orient]`, not by position.
- New exports: `Axis`, `AxisProps`, `AxisOrient`. The prop names may change
  while the other charts move to the part.
- Not in this change: the bar, histogram, box plot and heat map, the line's
  x axis and the frame still draw their own axes.
- README correction: it still said the last label of a horizontal axis could
  run past the right edge. That was fixed in the change below.

### Charts: axis labels are fitted the way the known chart libraries fit them

- **Behaviour change.** When the labels of a linear axis would run together, a
  scatter and a line now take a coarser round step (0 500 1000). They used to
  keep every k-th label with the first and the last forced, which on that axis
  left 0 and 1000 only. The tick count follows the room and the scale picks the
  step (Observable Plot's `tickSpacing`; the usual D3 `ticks(count)` call).
  When no round step leaves two labels that fit, every second (third, …) tick
  is kept, counted from zero; failing that, zero and one end; last, the first
  and the last round tick. An axis shows at least two labels. Zero keeps its
  label for as long as a second label fits beside it.
- A logarithmic axis keeps every label that has room, each measured by its own
  width (Vega's `labelOverlap: 'greedy'`). It used to drop every second label
  along the whole axis when only one end was crowded. The last tick can now be
  dropped; an axis left with two labels shows its first and its last.
- The label of an x tick near the edge of a scatter is moved in so that all of
  it is drawn (Highcharts' `overflow: 'justify'`). It used to run past the
  right edge and lose a character.
- **Breaking for a host that calls it directly:** `ticksThatFit` now walks the
  ticks and keeps what fits; it no longer keeps every k-th tick. For a linear
  axis use the new `roundTicksThatFit`.
- New exports: `roundTicksThatFit`, `labelsFit`, `labelCentre`.
- Not in this change: a margin a host can declare and one that grows with its
  labels; a line's x axis, the frame's shared axes, the box plot and the bar
  chart.

### Charts: a value label is shown whole, and two tick labels do not touch

- A value label wider than a scatter's or a line's margin was cut off at the
  edge of the drawing: "12345.0010" was drawn as "345.0010". It is now squeezed
  into the margin (`textLength`), every character kept.
- Tick labels that would run together are thinned to every second (third, …)
  tick, first and last always kept, on a scatter's two axes and a line's value
  axis, logarithmic axes included. A dropped tick is not drawn at all.
- New exports: `ticksThatFit`, `squeezedLength`, `TICK_CHAR_PX`,
  `TICK_LINE_PX`, `TICK_GAP_PX`.
- Not in this change: the last label of a horizontal axis can still run past
  the right edge and lose its last characters; and a margin that grows with
  its labels.

### Correction: `VizTheme` alone is enough for charts to draw

- A chart inside `<VizTheme>` with no `.vzf` element above it had no layout
  and was drawn unstyled (no axis lines, the browser's default ticks and
  labels): the wrapper declared the tokens and matched none of the
  component rules, which are all written under `.vzf`. The wrapper now carries
  `vzf` beside `vzf-theme`.
- What `<VizTheme>` wraps now inherits the theme's ink colour and type, as
  under any `.vzf`, and the theme's type scale reaches that text. Host content
  placed inside it takes them too. The wrapper still takes no box and paints
  no background, so a dark theme on a light page needs a surface that paints
  the theme's paper.

### UI: the time-travel rail is one keyboard stop

- Every bar on the rail was a tab stop. The rail is now one: Tab lands on the
  cursor's bar, Left/Right/Home/End move along the bars without travelling,
  and Enter or Space goes to the bar. Present mode's bookmark rail does the
  same.
- A bar's spoken name says where it stands: `step 3 of 40: #c2 select c2`,
  with `bookmarked` and `now` when they apply (it was `#c2 select c2`). The
  cursor's bar carries `aria-current="step"`. Code that finds a bar by its
  exact `aria-label` must change; `data-commit` is unchanged.
- While the keyboard is inside the rail the tab stop is the focused bar, so
  Tab leaves the rail in one press; outside it the stop is the cursor's again.
  Arrow keys with Alt, Ctrl or Meta are left to the browser.
- Present mode: when the cursor stands on no bookmark and has none behind it,
  no bookmark is marked as the current step (the first one was).
- `timeTravelModel`: `explore.stop`, `RailBar.position` and `.of`,
  `PresentStop.position` and `.of`. New exports: `railKeyTarget`, `railTabStop`.

### Security: the web source stops reading at its size limit

- `httpSource` read a whole body into memory and compared its size with
  `maxBytes` afterwards, for a table and for a resource read without a progress
  observer. A server that declared no length (or a false one, under a fetch
  that does not hold a body to its declared length) could fill the host's
  memory before the read was refused. The body is now read through its
  stream and cut off, with the transfer aborted, at the chunk that crosses the
  cap. What can be held is the cap plus one chunk.
- The `too-large` sentence for such a read now says "arrived and the read was
  stopped there", and the count is what had arrived, not the body's full size.
- A caller's abort signal is honoured between chunks on every read.
- A body chunk that is a raw buffer or another byte view is read as the bytes
  it is; a chunk that is not bytes is refused `malformed`. After a refusal the
  stream itself is cancelled.
- Not covered: a host `fetch` whose response has no WHATWG stream (`body` is
  `null`, or a stream of another kind) is still read whole, and the cap is
  checked afterwards.

### Charts: an axis a chart sizes itself follows the data (changes how charts look)

- A scatter padded its own x axis by 5 data units and its y by 0.5, and a line
  its value axis by 0.5. Data near zero was drawn as a thin blob in the middle
  of the plot. The room is now 5% of the data's span at each end.
- Ticks on those axes stand at round values (multiples of 1, 2 or 5 times a
  power of ten) instead of even cuts of the span, and each label is written
  to the step's precision. A −0.5…0.5 axis reads −0.4, −0.2, 0, 0.2, 0.4; it
  read "0 0 0 0 1" on x and "0 0 0 0 0" on y. Large values are written against one unit:
  −3.710M … −3.704M.
- Every scatter and line with no declared `domain` changes: data in the
  hundreds gets slightly more room than before, tick positions and their
  number change, and a line's labels are no longer rounded to one decimal.
  A declared `domain` keeps its span and is ticked by the new rule.
- A drag across a scatter records its two ends rounded to what the axis can
  show: a hundredth for an axis of ten or more (as before, except a value
  exactly on a half, which now rounds by its true value), finer for a smaller
  one. A drag across an axis from 0 to 0.001 would have recorded [0, 0].
- A zero guide that cannot be drawn names its axis to four significant digits.
  It rounded to a hundredth, which wrote an axis from 0.001 to 0.002 as
  "[0, 0]".
- New exports: `roomyExtent`, `roundTicks`, `roundStep`, `stepDecimals`,
  `roundToAxis`,
  `EXTENT_ROOM`, type `RoundTick`.
- Not in this change: a left margin that grows with the longest label, and
  thinning ticks whose labels would touch (see the entry above).

### Security: a selection value is never written into the recorded SQL unquoted (behaviour change)

- A point select accepted any value. An array was written into the commit's
  `predicateSQL` as its elements joined by commas with no quoting, so
  `value: ["1) OR (1=1"]` recorded `("category" IN (1) OR (1=1))`; through the
  Mosaic adapter the same text reached the clause the engine filters with. The
  same held for a RegExp, a function and an object with its own `toString`,
  and for those values inside a match list, a cell side, a range bound or a
  walked id list.
- `mosaicDescriptorSQL` now refuses every such value (`TypeError`; a selection
  port answers `unsupported-shape`). A plain record is still rendered as the
  constant `[object Object]`, as the system's own commits always were.
- `session.dispatch` refuses a select or filter whose value is not one plain
  value (string, number, boolean, `null`, a real date) with `guard-failed`, and
  says what to send instead. That covers every form: a point, a list of
  values, a cell, a range, and a walk (the node it starts from, the node a
  path runs to, and every id it reaches).
- A date is rendered only when it is a real `Date` with nothing of its own on
  it, read through the language's own methods. An object placed over
  `Date.prototype` could answer for a date's parts with text of its own, and
  that text reached SQL a database ran.
- A point select with an array value used to land. It is refused: send several
  values as `values`, and a range with the `filter` verb.
- New in `vizfootprint/data`: `isPlainValue`, `isPlainDate`, `notOnePlainValue`.

### Security: the DuckDB worker address is written into its script as data

- The browser arm started DuckDB's worker from a one-line script with the
  worker address pasted between quote marks. An address holding a quote mark
  ended the string, and the rest ran as script in the worker. The address is
  now parsed as an absolute URL and written as one string literal.
- A `bundles.*.mainWorker` that is not an absolute URL is refused with a
  sentence. A relative one never worked: the worker starts from a `blob:` URL,
  which is no base.

### A test records the row it got, and a replay checks it

- A test's commit now carries `ledgerRow` beside its p-value: the position,
  threshold, verdict and budget it got in the error budget where it was made.
  The stored value of every new test commit is larger by that row; logs written
  before this still replay.
- `ReplayResult.tests` gains `rejudged` and `unchecked`. `rejudged` lists each
  test whose row, computed by the replaying session, is not the row the test
  recorded, with both rows and what differs. `unchecked` lists the readable
  tests that carry no readable row. A log replayed into a dashboard with
  another procedure or other settings used to be judged again with nothing to
  show for it; it is still judged by the replaying dashboard, and now says so
  test by test.
- A carried row is named by its recorded row, so a replay no longer needs the
  analysis declared to give the row its original name.
- New types on `vizfootprint/session`: `ReplayedTests`, `RejudgedTest`,
  `LedgerRowDifference`.
- `compare()` and the fold's diff read a test by its act and p-value. The
  ledger row beside it is not state: the same test with the same result on two
  paths is not a change.
- The check compares rows. It is not a signature: a log whose p-value and row
  were both rewritten consistently passes it.

### Correction: a replayed session carries its error budget (behaviour change)

- `session.replay(log)` used to start the replayed session with the full error
  budget although the log held tests. The next test was then judged as the
  first, at the loosest threshold: saving and replaying handed out a fresh
  budget. The recorded p-values are now fed through the budget in arrival
  order, every branch counted, without running any test again.
- Replayed into the dashboard that made the log, the session stands where the
  original stood. The rows are computed by the replaying session: the log does
  not record the procedure, its settings or the original verdicts, so a
  dashboard configured differently gives its own verdicts for the same p-values.
- `ReplayResult` gains `tests: { carried, unreadable }`. A test whose record
  cannot be read is entered at p = 1 and listed in `unreadable` with a reason.
  That is the cautious side under LORD++ and is not guaranteed to be under
  alpha-investing.
- `why({ kind: 'hypothesis' }).fdr` is now present on a replayed session for a
  test the replay re-performs (one that also wrote a column or a table).
- An analysis that is not declared as a test can no longer report a test
  result: `analyze` rejects. It used to spend a budget step with no test commit
  behind it, which no replay could account for.
- A consumer that relied on a replayed session having an empty ledger
  (`overview().fdr.tests === 0`) must stop: that was the fault.

### Correction: error budget is spent only for a test that lands

- An analysis module written by hand (not built by `defineAnalysis`) could
  report a p-value such as `NaN`. The session spent error budget on it and
  landed a test commit no reader can read. The session now refuses it, as
  `defineAnalysis` always has for its own modules. One rule, `isPValue`, is
  asked at every door.
- The budget used to be spent the moment a module reported its result, while
  the module was still running. A module that reported and then failed had
  spent a step with no commit behind it, and one that reported twice had spent
  two steps for one commit. The budget is now spent once, after the run has
  returned a result. A second reported result is refused.
- In each refused case `analyze` rejects, no budget is spent and nothing lands.

### Correction: a `why` answer carries what the record could not establish

- `why()`'s kernel tier gains `kernel.limits` (`KernelSliceLimits`): whether a
  budget cut the slice, how reads were known and counted, which commits took
  untracked input, which read a value from before the run, how many edges are
  not certain, and the record reader's own notes. The answer used to keep the
  commit ids and drop all of it, so a cut or partly-blind chain looked complete.
- `flags.kernelLimitsReported` is `true` when the reader reported any of those,
  including a run where no reads were recorded. `false` means none was
  reported; it is not a claim that the chain is complete.
- Reading an answer is unaffected. Code that BUILDS a `CrossTierSlice` or a
  `WhyFlags` by hand must add the two fields.
- The `viz.why` tool's description tells the agent to report a chain with
  limits as partial.

### Migration: the time-travel bar renders a model (breaking, `vizfootprint-ui`)

- `<TimeTravelBar>` takes one `model` prop in place of `commits`, `cursor`,
  `head`, `bookmarks`, `branches` and `pathName`. It derives nothing from the log.
- New: `timeTravelModel(input)` (data logic, no React), `useTimeTravel(view)`
  (a model and the view's five time actions, ready to spread onto the bar),
  `timeTravelOf(state)` and the types `TimeTravel`, `TimeTravelInput`,
  `TimeTravelModel`, `ExploreModel`, `PresentModel`, `PresentStop`, `RailBar`,
  `RailCoverage`. Each action of the door hands back what the session said
  (`DescribeOutcome`), so a custom bar can tell a reader a seek was refused.
- The demo-agent app now names the path beside the rail, as the gallery and
  the studio desk already did: the door always passes it.
- Correction: a cursor naming a commit that is not in the log used to draw an
  empty rail under "no commits yet". The rail now draws the head's lineage and
  its sentence says the cursor is not among the recorded steps. `RailScope`
  gains `cursorMissing`.
- Correction: "no commits yet" is said only of an empty log.

Migration:
1. With a session view: `const time = useTimeTravel(view)` then
   `<TimeTravelBar {...time} />`; drop the six removed props and the five
   action props you wired by hand.
2. With your own store: `model={timeTravelModel({ commits, cursor, head,
   bookmarks, pathCount: branches.length, pathName })}`.

### Migration: the UI theme is a typed token set (breaking, `vizfootprint-ui`)

- `vizfootprint-ui` has a theme layer: `ThemeTokens` names every design token,
  `slateLight` and `slateDark` are complete shipped themes, and `<VizTheme>`
  replaces the theme as a whole or overrides part of it for a subtree.
- **Removed, with no alias:** `resolveTheme`, `themeStyle`, `themeAttr`,
  `applyTheme`, `ThemeConfig` and `ColorInput`. They reached 27 of the 76
  `--vzf-*` properties the stylesheet names.
- `<VizCockpit theme>` now takes `ThemeTokens`; light or dark is the separate
  `mode` prop.
- Correction: design tokens are declared on the outermost `.vzf` / `.vzf-theme`
  element only. A nested component used to re-declare the defaults on itself,
  so a themed cockpit did not theme a sheet, note or editor placed inside it.
  A nested `data-theme` re-declares only the tokens that differ between light
  and dark.
- The theme rules have zero specificity, so a host rule naming `.vzf` now wins
  whatever the load order and whichever mode is in force.
- `--vzf-zero` and `--vzf-map-empty` have no default declaration. They are read
  with a fallback to `--vzf-ink-faint` and `--vzf-surface-2`. A host that read
  either property itself must add the same fallback; `EMPTY_FILL` is exported
  for the second.
- A theme that names an unknown token, or gives one a value that is not a single
  CSS value, is refused with a `TypeError` naming the token. An empty font
  string used to be skipped and is now refused.
- Behaviour that no longer happens by itself: a single `colors.brand` used to
  derive its deep shade, tint and ink, and `mode: 'dark'` used to mix tints
  toward the dark ground. `<VizCockpit theme={{ colors: { brand } }}>` still
  compiles and now changes the base only. Use `accentColors`.
- `accentColors` picks the ink by contrast. The old rule chose white over many
  mid-tone fills where the dark ink was far more readable. It accepts `#rgb`
  and `#rrggbb` only (4- and 8-digit hex is refused) and returns lower-case
  six-digit hex.

Migration:
1. `themeStyle({ colors: { brand: '#36f' } })` becomes
   `tokensToCSSVars({ colors: accentColors('brand', '#3366ff') })`, or wrap the
   subtree in `<VizTheme tokens={…}>`. With a dark ground pass `'dark'` as the
   third argument. The `{ base, deep, tint }` form becomes the four fields
   written out: `{ brand, brandDeep, brandTint, onBrand }`.
2. `mode: 'dark'` inside the config becomes `mode="dark"` on `<VizTheme>` or
   `<VizCockpit>`; `mode: 'auto'` is the absence of the prop.
3. `fonts` is `fontFamily`; `textScale: 1.2` is `typography: { scale: '1.2' }`.
4. `applyTheme(el, config)` becomes setting each entry of
   `tokensToCSSVars(tokens)` with `el.style.setProperty`, and setting the
   element's `data-theme` attribute yourself when you force a mode.

### Correction: an export refuses a row count it cannot trust

- A data door's `count` that is not a whole, non-negative number of rows refuses
  the export with `reason: 'count'`. It used to be read as 0, so the receipt
  said the view was empty and the file complete while the door had delivered
  rows. A fractional count used to be rounded down, dropping rows silently.
- A count smaller than the rows the door itself answered is refused the same way.
- A count that changes between pages refuses the export with `reason: 'moved'`,
  like a changed version or cursor.
- A page holding more rows than were asked for refuses the export with
  `reason: 'misaligned'`. It used to be cut to fit.
- `ExportWalkRefusal` gains `'count'`. A door that answers the window it was
  asked for, with a count that covers it, is unaffected.

### Correction: an export refuses a row option that is not a number

- `exportWindows` and `exportFromSession` refuse the whole export with
  `reason: 'option'` when `pageRows` or `rowCeiling` is given and is not a
  finite number. `rowCeiling: NaN` used to export an empty body under a receipt
  saying `truncated: false`, and an infinite ceiling was written to the receipt
  as `null`. Finite values are clamped exactly as before; an omitted option
  (`undefined` or `null`) is still the default. A value that coerced to a number
  before — a numeric string, a boxed number — is refused too. `ExportWalkRefusal` gains `'option'`.

### Migration: required routing port (major)

- Routing now requires a consumer-owned scorer, declared policy and decision;
  remove the optional AgentFootprint peer and every runtime import from it.
  The host remains development-only for integration tests and the example app.
- Capture node/policy/scorer facts before callbacks and validate/project foreign
  scores and verdict evidence. Unknown, omitted or duplicate IDs and non-number
  scores produce the existing empty unmatched fallback. Non-number refusal is
  an intentional correction: the previous validator admitted those values.
  Preserve raw NaN/infinity numeric evidence for the supplied decision rule.
- Capture synchronous decisions immediately and asynchronous decisions at their
  first delivery; contain rejecting callbacks without an unhandled rejection.
- Capture asynchronous scores at actual observer delivery too, including Promise
  subtypes that retain and change their payload after the observer returns.
  Native resolution before observer delivery is not a snapshot guarantee.
- The actual packed files now enforce the host-free source/build boundary, and
  a chart-only consumer installs/bundles without that host. Existing route and
  real mock-Agent attribution tests remain; the host-backed tests live outside
  library source and keep their own no-emit type check.

Migration:
1. Create a port with your scorer, complete policy and decision function.
2. Pass it as `routeIntent(phrase, nodes, port, options)`; move old options fourth.
3. Keep any host adapter in application/test code, or remove that package for charts only.

- The preceding compatibility patch accepted AgentFootprint 16 alongside 15;
  the routing-port major above replaces that optional peer with consumer input.
- Correct spacing in the migration documentation and restore literal punctuation
  in the package description.

## 1.0.0 — 2026-11-19

### Migration: next major — stable engine 14 and Foottrace 2.1

This is a breaking host/dependency contract. Viz moves from 0.1.0 to its next major,
1.0.0; all four workspace privacy flags stay unchanged.

- Require the host's `footprintjs ^14.0.0` as a peer and use engine 14.0.0 in development.
  `AnalysisDef.build()` returns the host's chart and Viz executes it, so both must
  resolve one engine. Older engines and the RC-only range are no longer accepted.
  Keep runtime `foottrace ^2.1.0` and the existing one-physical-reader checks.
  The genuine hosted lock selects published Foottrace 2.2.0 within that range.
- Develop and test against published AgentFootprint 15 and the compatible published
  Storydeck 0.14.1 Studio alias. Regenerate the real lock with npm; do not relabel old
  lock entries or substitute source-candidate archives. Preserve main's locked
  development toolchain while updating these packages and their required inputs.
- Replace the stored ContextFootprint 0.1.0 development archive with published 0.1.1.
  Its assertion/comparison API matches the existing tests. The packed comparison
  example copies the actual locked install offline; every comparison, attribution,
  bundle-boundary and cleanup assertion remains in force.
- Required CI checks the commit's locked source graph and keeps all original build,
  type, browser/profile and both four-column 100% coverage gates. It no longer fetches
  sibling producer runs. External compatibility observations cannot block a merge.
  The RC-only per-command byte/compiler snapshots retire; normal lock integrity,
  physical identity, actual compiler tests and source-to-packed-manifest equality
  remain. This is not a claim that normal checks reproduce the retired snapshots.
- Keep only the normal installed-identity import closure and its behavior tests.
  The candidate-only RC route and its fault fixtures never existed on main;
  preserve their unchanged source on `archive/rc-native-input` at
  `75d7e9828b156a6aab4aa2e0e3fec5c607526ba8` rather than adding inactive code.
- Pin the Node 22/24 source and real-browser jobs to supported Ubuntu 24.04.
  The moving `ubuntu-latest` alias selected Ubuntu 26.04, where the locked browser
  install's requested apt fonts were unavailable. The browser tests, 20-minute
  job limits and existing coverage thresholds remain unchanged.
- Retain the actual reviewed-head Viz pack, SHA256 and source/run provenance from
  hosted CI for app snapshot consumption. A successful package build does not prove
  an app uses it.
- Keep main's development tools: Playwright 1.61.1 and Vitest/coverage 4.1.10,
  together with their locked inputs. A whole-lock refresh is a separate tool
  upgrade, not part of this migration. The capped-Sheet test uses the platform's
  one CSS-pixel bottom check and directly asserts that the last row is rendered
  inside the viewport; its canvas, last-row identity and other assertions remain.

### Corrections to the previous migration notes

- The RC notes omitted the host-chart engine ownership contract, assumed source
  producer availability could gate required CI, and retained a sibling comparator
  archive. Those were defects in the notes; the peer and normal-install rules above
  now state the intended boundaries. Historical native fixtures/proofs are retained.
- The earlier notes offered no durable hosted packed snapshot and no changelog.
  The reviewed-head artifact and this migration record supply those missing pieces.
