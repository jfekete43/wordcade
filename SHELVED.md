# Shelved

Code taken out of the live site on purpose, kept here so it can go back in
as it was. Nothing in this file runs. Each entry carries the exact markup
that was removed, where it came from, and what else has to be true for it to
work again.

`tests/shelved.test.mjs` checks both halves of every entry: that the app no
longer carries the code, and that this file still does, character for
character. If you restore something, delete its entry here and that suite
will tell you if you missed a piece.

---

## Discord button (menu modal)

**Removed:** 2026-11-26
**Lives in:** `index.html`, the social row of the Menu modal &mdash; the flex
`<div>` holding the X, Discord and Ko-fi buttons, just under `Sign Out`.
**Why:** parked for now, to come back later.

It was the middle of three buttons. X is first, Ko-fi last; put it back
between them and the row is as it was.

```html
                    <button class="btn-quiet" style="border-color: #5865F2 !important; padding: 8px 12px;" onclick="window.open('https://discord.gg/xBVDym8TF9', '_blank', 'noopener')">
                        <svg viewBox="0 0 127.14 96.36" width="16" height="16" fill="#5865F2"><path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.31,60,73.31,53s5-12.74,11.43-12.74S96.2,46,96.12,53,91.08,65.69,84.69,65.69Z"/></svg>
                    </button>
```

### Restoring it

1. Paste the block above back between the X button and the Ko-fi button.
   `index.html` is CRLF, so paste it with CRLF line endings
   (`tests/line-endings.test.mjs` will catch it if not).
2. Check the invite code in the URL is still live: `discord.gg/xBVDym8TF9`.
   An invite that has expired sends people to a dead page, which is worse
   than no button.
3. Delete this entry, and the entry for it in `tests/shelved.test.mjs`.

### Left in place deliberately

- `#5865F2` is still listed in `docs-consistency.test.mjs`'s `ALLOWED`
  literal-colour list, so restoring the button does not trip that check.
  It is Discord's brand blue and is not in the palette by design.
- The **Discord digests** are a separate feature and still run: the Cloud
  Functions that post the daily Sprint and weekly Marathon standings to a
  webhook. See `DEPLOY.md`. Removing the button did not touch them, and
  taking the button away does not stop the posts.
- `social/` holds the server icon and the X avatar and header art. Those are
  uploaded to the platforms themselves, not served by the site, so they stay
  whatever the menu shows.
