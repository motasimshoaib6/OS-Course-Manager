# Operating Systems Course Manager

A small offline web app for organising an Operating Systems course: weekly modules,
topics with rich lesson notes, and assignments. Built with plain HTML, CSS and
JavaScript. No account, server, API key or internet connection is needed.

## Folder structure

```
os-course-manager/
├── index.html   Page layout and all pop-up dialogs
├── style.css    Green-and-white design, mobile layout
├── script.js    All app logic: data, saving, pages, editor, backups
└── README.md    This file
```

## How to run it

**Option A - simplest:** double-click `index.html`. It opens in your default browser.

**Option B - from VS Code:**

1. Open VS Code, then **File > Open Folder...** and choose `os-course-manager`.
2. Install the free **Live Server** extension (Extensions icon on the left, search "Live Server", by Ritwick Dey).
3. Right-click `index.html` and choose **Open with Live Server**.

**Pick one option and keep using it.** The browser keeps separate data for
`file:///...` (option A) and `http://127.0.0.1:5500` (option B). If you switch,
the app will look empty or show the sample course - your data is not gone; it is
saved under the other address. Export from one and import into the other to move it.

## Where your data is saved

- Everything is saved automatically in your browser's **localStorage** on this computer.
- It survives refreshing and closing the browser.
- It does **not** sync to your phone, another laptop or another browser.
- It **can be lost** if you clear browsing data / cookies / site data, use a private
  (incognito) window, or reinstall the browser.
- Browsers allow about **5 MB** per site. Text uses very little; images use most of it.

**Make a backup every week:** Backup & Data > **Export backup (JSON)**. Keep the
file in Google Drive, OneDrive or a USB drive. To restore: **Import backup...**.

## Rich-text editor

The editor is built into `script.js` (no third-party library), so it works
**fully offline**. It supports headings, bold/italic/underline, highlight, inline
code, bulleted and numbered lists, quotes, tables (with add/remove row/column),
code blocks, images and diagrams, links, horizontal lines and coloured boxes for
**Important**, **Example**, **Note**, **Problem** and **Homework / Assignment**.

Safety: lesson content is cleaned by an allow-list sanitiser before it is saved and
again before it is shown. Scripts, `onclick`-style attributes, styles, iframes and
`javascript:` links are removed. Week, assignment and other text fields are always
shown as plain text.

## How to test the features

1. **Weeks:** click **+ Add Week**, leave the title empty and press Save - you should
   see an error. Fill it in and save. Then **Edit week** and **Delete week** (a
   confirmation appears first).
2. **Topics:** open a week, click **+ Add Topic**. Use the circle to mark it
   completed, the arrows to reorder, **Rename**, and **Delete**.
3. **Content:** click **Edit content**, try each toolbar button, then **Save & view**.
4. **Refresh test:** press **F5**. Everything should still be there.
5. **Search:** type `scheduling` in the top search box and press Enter.
6. **Assignments:** add one, change its status from the dropdown, search for it, delete it.
7. **Backup:** Backup & Data > Export. Then Import the same file - you see a summary
   and must confirm before anything is replaced. Try importing a non-JSON file - you
   get an error and nothing changes.
8. **Errors:** press **F12** and open the **Console** tab - there should be no red errors.

## Common problems

| Problem | Fix |
| --- | --- |
| Page has no styling | `style.css` must be in the same folder as `index.html`, with exactly that name. |
| Buttons do nothing | `script.js` must be in the same folder. Press F12 > Console to see the error. |
| My data disappeared | Are you using a different browser, a private window, or the other opening method (file vs. Live Server)? Otherwise import your latest backup. |
| "Browser storage is full" | Delete some large images, or use smaller screenshots. |
| Imported file rejected | Use a file exported by this app. The red box lists what is wrong. |
| Online image does not show | Images added by web address need internet. Upload a file instead. |

## Known limitations

- Undo/Redo (Ctrl+Z) covers typing and formatting. Table row/column changes and
  inserted blocks cannot be undone with Ctrl+Z - press **Cancel** to discard all
  unsaved edits instead.
- Drag-and-drop of text inside the editor is turned off (it could bypass the safety
  filter); use cut and paste. Dropping an image file still works.
- Formatting uses the browser's `document.execCommand`. It is marked "deprecated"
  but still works in Chrome, Edge and Firefox.
- Weeks are ordered by week number; topics are reordered with the arrow buttons
  (no drag-and-drop).
