# Report calculations and refresh

<!-- Language: en -->

Reports count unique cases by their logical identity within the selected build.
Repeating a test does not increase the number of assigned cases.

## Results and coverage

The latest started attempt is selected for each case. Only `PASO`, `FALLO` and
`BLOQUEADO` count as final results. An `EJECUTANDO_AI` attempt remains pending
for coverage and percentages, even if an earlier result exists. An attempt
still marked `SIN_CORRER` does not replace the result of a started attempt.
Build trends apply the same rule.

The format and execution mode matrix counts completed attempts; the summary
counts unique cases. Their totals can differ when a case is repeated. API
telemetry includes all completed attempts in the build and preserves executed
case versions even when a later version is currently assigned.

## Latencies

P95 uses nearest rank: sort valid samples and select position `ceil(0.95 * n)`,
starting at 1. It is not the maximum or average of individual percentiles. API
combines responses from all completed attempts; Chatbot combines turns from
the latest attempt per case if that attempt completed. Zero latency is retained;
missing, negative and nonfinite values are excluded. Without samples, the field
returns zero and does not establish a measurement.

## Refresh and exports

An earlier response cannot replace a more recent search or metrics for another
project or build. Errors from obsolete requests are also discarded. A failed
refresh shows a retry notice; previous data, when retained, is identified as
such. A successful retry restores the report.

Local PDF and XLS exports share an HTML case table with one row per case. XLS
is an HTML document compatible with spreadsheet applications, not an XLSX
workbook. Download requires the current export permission.

## Detail, shared history and context

Detail lists expose every bug, failure and evidence record through Show more and a visible record counter. Suite, priority, status, owner and mode filters use each evidence record's persisted context. The bug filter distinguishes open, closed, linked and unlinked records; evidence inherits its case's bug links. Evidence completeness is filtered separately from case outcome.

Shared history preserves data from the same context on failure, displays a notice and supports retry. Changing project, build or permissions invalidates previous responses and clears links, modal and decision. Sharing, revoking and risk actions also check context before applying results. Build comparisons select the component's actual chronological predecessor, including builds outside the ten most recent.

## Conversational metrics and time

HTTP errors use observed turn status codes; a failed expectation with HTTP 200 does not count as a transport error. Manual turn assertions and automated aggregate assertions represent one source and are not added twice. Structured expectations are preserved as readable, escaped JSON in PDF/XLS.

latency_sample_count distinguishes a measured zero latency from missing samples; the UI shows No measurement when samples are absent. Cumulative effort includes all attempts; average per case retains effort per unique case. Average per attempt uses completed attempts only and drives the remaining-time estimate. Without completed attempts, no estimate is available. PDF/XLS export the full build report, as indicated by the export control; detail filters do not apply.
