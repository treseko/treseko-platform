# Treseko Flow: record browser journeys

<!-- Language: en -->

Treseko Flow is an optional extension for Chrome and Edge. It is installed
separately from the platform and records actions in a browser tab to create an
editable journey or a Playwright script. You do not need it to use Treseko
unless you want to record journeys.

## Choose how to use it

| What you need | Flow |
| --- | --- |
| Record and replay browser actions | Install Flow, open the page, record, then use **Replay** in the extension. |
| Use Treseko without the extension | Create or import an automation script and run it with a compatible Automation Worker. |
| Send a recording to Treseko | Record in Flow, choose **Send to Treseko**, review the draft in an automated case editor and save it from Treseko. |

The extension does not include Treseko, Node.js or `@playwright/test`. Flow's
**Replay** repeats actions in Chrome or Edge; it does not run the Playwright
file. To execute the saved script, use Treseko's dry run or automated execution
with a compatible Worker.

## Record and save a journey

1. Install Treseko Flow from the extension's distribution channel. It is not
   included in the Treseko Community package.
2. Open the target page in Chrome or Edge and click the Flow icon. The extension
   captures the selected tab; its workspace can open in a separate window or
   side panel, according to Settings.
3. Start recording, grant the site access requested by the browser, and perform
   the actions on the page.
4. Stop recording and review the list. Edit values or selectors, add checks,
   reorder steps or remove steps that do not belong.
5. Replay the journey in the browser to check the local capture if you want.
   This does not verify that the Node Playwright runtime can run the script in
   the Worker.
6. To transfer it, leave a signed-in Treseko tab open with an automated case
   editor. If several Treseko installations are open, choose the destination
   tab. **Send to Treseko** loads the script into the editor as a draft; review
   it and save the case in Treseko.
7. Run the saved case from Treseko with a compatible Worker. For local
   applications, the Worker must be able to reach the application URL; from
   the Worker, `localhost` means the machine where that Worker runs.

You can also export the script from Flow and import it into Treseko. Transfer
from the extension does not create or save cases automatically.

## Actions it can capture

Flow creates steps for common interactions such as clicks, typing, selection,
keys, scrolling, hover, viewport changes, browser dialogs, supported drag and
drop actions and page navigation. It can add visibility, text, value, URL and
title checks. Selectors and values remain editable before transferring or
exporting the script.

Capture depends on the browser and on what the page exposes. Flow cannot control
Chrome or Edge internal pages, native operating system dialogs or file pickers.
Iframes and pop-up windows require permissions and may be ambiguous when more
than one target matches. Review the journey and sensitive data before saving.

## Privacy

The journey is stored locally in the browser. The script is transferred only
when you click **Send to Treseko** and choose a destination tab; the extension
uses that tab's existing session. Values recognized as sensitive are not saved
as text: the script uses variables that must be configured in the Treseko case
data or environment.
