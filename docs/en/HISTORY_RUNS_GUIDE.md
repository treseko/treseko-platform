<!-- Language: en -->
# Execution History

History lets you inspect runs without starting new tests. Apply filters with
**Search** or Enter; refresh keeps them applied. The URL preserves filters,
the page and selected detail so you can return to the same context.
**Clear filters** returns to the first page.

Choose 25, 50 or 100 results per page; the total reflects the applied filters.
If loading fails, the error is shown, previous results remain available and
**Retry** reloads the same search.

Details show general observations, classic steps, API requests, responses and
assertions, or conversation turns and evaluation according to the persisted
case format. Manual conversations also retain their evidence. Evidence and
frozen configurations are read-only. The frozen evidence policy controls
sensitive data redaction.

The list previews up to three evidence items; the remaining count opens the
detail. **Without evidence** requires the entire run to have no screenshots,
attachments or structured API or conversation results.

Access uses `historial.ver`, `historial.detalle` and `historial.evidencias`, as
well as project membership. Reading history does not grant permission to
execute tests. On mobile, cards expose the result and detail action.

Example: filter **FAILED**, search, open the detail and close it. Refresh keeps
the search. Changing page size returns to the beginning of those results;
a late response from an earlier search cannot replace them.


**Case status** finds runs containing at least one case with that status.
**Run result** filters the overall result: while AI cases are executing it
shows **In progress**; afterwards failures take precedence, followed by blocked,
passed and not run. Both filters can be combined. A run with one passed and one
failed case matches Case status PASSED, but does not match Run result PASSED.
The running-case count is separate from the not-run count.

Applied filters appear as individually removable tags. Collapsing advanced
filters keeps these tags visible; restoring an advanced filter from the URL
expands the panel. URL captures also appear in details, without duplicating
attachments. API details show each request duration and the execution total
separately. Creating bugs from a Chatbot report requires bug read/create
permissions and project write access; the server still checks every request.
