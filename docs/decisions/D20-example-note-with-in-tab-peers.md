# D20: The example is a real shared note, edited by in-tab peers

Status: `DECIDED`

## Context

jot needs an example that shows the engine at work: several people writing, live carets,
blame with more than one author, edits merging. A public note was rejected (D15). A scripted
animation would show none of the real machinery. The landing page already plays a local
illustration in its fan; opening it should lead to the real thing. jot AI (PR "ai") also needs
a way to write into a note as its own author.

## Decision

- **`/new?example` creates a real shared note at once.** It gets a fresh id, connects, and
  after the first sync, if the note is empty, the demo collaborators seed it (the offsite
  plan). Then the address moves to `/n/<id>` with the same editor. Nothing exists on the
  server until someone asks for an example; examples expire after 90 days like any note
  (D06).
- **The demo collaborators are in-tab peers:** real Yjs clients inside the visitor's tab.
  Each has its own `Y.Doc` (so its own client id), a headless Lexical editor (no root
  element) with `YCollabExtension` on that doc, and its own `Awareness`. The peer's doc and
  the note's doc stay in sync both ways through `update` events, each side applying the
  other's updates under an origin the other side skips, so nothing loops. Each writes a
  registry entry (D19) of kind `demo` under its own client id, so blame names it; its
  awareness state is relayed into the note's with `applyAwarenessUpdate`, so the provider
  sends its caret to everyone. The relay doesn't change: to it, a peer is one more client
  on the page's socket, removed with that socket's other states when it closes.
- **One reusable module,** `editor/peers/peer.ts` (`createInTabPeer`), so jot AI writes the
  same way, with kind `ai` and `askedBy`.
- **The script** (about 20 s): Ana (demo) adds a to-do and a table row; jot AI (demo) turns
  the agenda sentence into a bulleted list while "you" type in it, through the page's own
  editor, so the visitor is the third author; then both go idle. It finds its targets by
  text, so a step whose part someone edited away is skipped. Under reduced motion it lands
  at once. ⋯ → Replay demo puts its parts back and runs it again.
- **Only the tab that created the example runs them,** marked in sessionStorage
  (`jot:example:<id>`), and only while it holds the Web Lock `jot-example:<id>`: a duplicated
  tab copies sessionStorage, so it waits for the lock and takes over, idle, when the original
  closes. Ana checks the note is empty on her own copy, in the update that writes the plan,
  so a plan is never doubled. Other windows see their edits and carets through the relay. A
  reload of that tab brings them back idle; leaving the page stops them and removes their
  presence.
- **Every peer instance gets a new Yjs client id,** never a reused one: a reused id writing
  against a stale copy (a duplicated tab that went offline before taking over) would create
  items whose ids already exist. Blame groups a person's client ids by the stable person id
  (`demo-ana`, `demo-jot-ai`), and a peer writes its registry entry only on its first
  change, so a reload that only brings the carets back adds nothing to the note.
- **Peers write only while the note takes edits:** binding active and not full. A note that
  turns read only or full stops the script, and Replay demo waits until it takes edits.
- **Blame is on** when the example opens, since several authors are the point; the banner
  says "Example note · Ana and jot AI are demos in your browser" so nobody takes them for
  strangers.

## Consequences

- Every opened example is a stored note (a Durable Object and a few KB). Bots that don't run
  JavaScript create nothing.
- A peer's updates count as the page's edits waiting until the relay confirms them, like
  the person's own.
- Each peer reconciles a second Lexical editor on every change to the note. That is cheap at
  example sizes; a peer should stay only while it has work to do or presence to show.
- Peers live and die with the page. If the tab closes mid-script, the edits already made
  stay and the rest never happen.
