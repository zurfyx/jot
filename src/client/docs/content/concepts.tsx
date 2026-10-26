import { lazy, Suspense } from 'react';

import { Code } from '../Code';
import { LEXICAL_Y_DOCS, SNIPPETS } from '../sources';
import { DocLink, PageHeader, Source } from '../ui';

// Lexical and Yjs load only when this page is opened.
const Inspector = lazy(() => import('../Inspector'));

export function ContentInYjs() {
  return (
    <>
      <PageHeader crumb="Concepts / How content lives in Yjs" title="How content lives in Yjs" />
      <p>
        The whole note is one Yjs node, <code>lexical-y</code>. Text stays text. Each line ends in a{' '}
        <b>¶ marker</b> that carries the line's type and fields, and blocks that aren't lines, like
        tables, become nested nodes. Type in the editor and watch the root change; hover a line or a
        row to pair them.
      </p>
      <Suspense fallback={<div className="docs-inspector is-loading" aria-hidden="true" />}>
        <Inspector />
      </Suspense>
      <h2>Reading the tree</h2>
      <ul>
        <li>
          <b>The root's attributes:</b> <code>lexical-y</code> is the layout version, and{' '}
          <code>k:&lt;type&gt;</code> records how each element type is stored, on its first write.
        </li>
        <li>
          <b>Text</b> carries its formats: <code>f:bold</code>, <code>f:italic</code>. A link is a
          format wrapper, <code>w:link</code>, whose value holds the link's fields.
        </li>
        <li>
          <b>A ¶ marker</b> ends a line: <code>t</code> is its type (left out for a paragraph) and{' '}
          <code>p:&lt;field&gt;</code> its schema fields, like a heading's <code>p:tag</code>.
        </li>
        <li>
          <b>List items</b> are lines in a group: <code>g</code> names the group's type,{' '}
          <code>g:listType</code> its identity, and <code>l</code> the item's level.
        </li>
        <li>
          <b>
            <code>b:&lt;type&gt;</code> nodes
          </b>{' '}
          hold blocks that aren't lines, such as a table, its rows and its cells, each with lines of
          its own. Try typing <code>- </code> or <code>## </code> at the start of a line.
        </li>
      </ul>
      <h2>Why lines, not nodes</h2>
      <p>
        Typing, splitting and joining lines are text edits: Enter inserts a marker, and Backspace at
        the start of a line deletes one. Yjs merges them the way it merges any text, so two people
        splitting the same paragraph at once both keep their text. Indenting a list item changes its
        marker's level, not its place in a tree.
      </p>
      <h2>Storage kinds</h2>
      <p>
        <code>@lexical/y</code> derives how each element type is stored from the node structure its
        class declares in <code>$config()</code>, first match wins: a block with inline children is
        a <b>line</b>; an inline element with <code>mergeAdjacent</code> is a <b>format</b>; a block
        whose children are only lines, with <code>mergeAdjacent</code>, is a <b>group</b>; anything
        else is <b>nested</b>. <code>describeStorage()</code> prints the result for your editor.
      </p>
      <Code source={SNIPPETS.inspect} />
      <p>
        These names are frozen as layout 1. Changing one makes a new layout version, which older
        clients open read only. The full wire format is in the{' '}
        <a href={LEXICAL_Y_DOCS}>
          <code>@lexical/y</code> docs
        </a>
        .
      </p>
    </>
  );
}

export function Presence() {
  return (
    <>
      <PageHeader crumb="Concepts / Presence and cursors" title="Presence and cursors" />
      <p>
        Who's here and where their caret is aren't part of the note. They travel in Yjs{' '}
        <b>awareness</b>: a small, short-lived state per client that the provider relays, and that
        disappears when the client leaves.
      </p>
      <Code source={SNIPPETS.presence} />
      <h2>Cursors that survive edits</h2>
      <p>
        <code>binding.getCursor()</code> turns the Lexical selection into Yjs relative positions,
        anchored to characters rather than offsets: a caret to the character on its left, a range to
        its first and last characters. A peer resolves them against its own copy with{' '}
        <code>binding.$resolveCursor()</code>, inside a read, so a caret stays put while others type
        before it. It returns <code>null</code> when the position can't be resolved.
      </p>
      <h2>In jot</h2>
      <ul>
        <li>
          Each browser keeps a name, like "Calm Otter", and a colour: an index into eight peer
          colour tokens, so colours follow light and dark (
          <Source path="src/client/editor/presence.ts">presence.ts</Source>).
        </li>
        <li>
          <Source path="src/client/editor/RemoteCarets.tsx">RemoteCarets.tsx</Source> draws each
          peer's caret and selection over the page from <code>createDOMRange</code>. The name shows
          while the caret moves, and shrinks to the bar after three seconds.
        </li>
        <li>
          The same states give the avatars at the top right and Note info's "Here now", where
          someone whose caret moved in the last minute is editing, and anyone else is idle (
          <Source path="src/client/editor/people.tsx">people.tsx</Source>).
        </li>
        <li>
          Awareness comes from strangers, so names and colours are checked before they're drawn: a
          name is cut to 40 characters, and a colour is wrapped into the palette.
        </li>
      </ul>
      <h2>Collaborators inside the tab</h2>
      <p>
        A peer doesn't need another browser. The example note's demo collaborators, "Ana (demo)" and
        "jot AI (demo)", and <DocLink slug="ai">jot AI</DocLink> are in-tab peers: each has its own{' '}
        <code>Y.Doc</code> and client id, a headless editor, and an <code>Awareness</code> of its
        own. Their awareness changes are applied to the note's, which the provider sends like any
        other, so their carets show in every window. The example runs its demo only in the tab that
        created it; other windows see it through the relay (
        <Source path="src/client/editor/peers/peer.ts">peers/peer.ts</Source>).
      </p>
      <h2>On the relay</h2>
      <p>
        The Durable Object relays awareness without y-protocols' <code>Awareness</code> class, whose
        timer would keep the object from hibernating. It keeps each client's last state, forwards
        changes, and announces a client's removal when its socket closes (
        <Source path="src/worker/awareness.ts">awareness.ts</Source>). Clients time out stale states
        on their own.
      </p>
    </>
  );
}

export function Offline() {
  return (
    <>
      <PageHeader crumb="Concepts / Offline and merging" title="Offline and merging" />
      <p>
        Two copies of a Yjs document merge whatever each did while apart: each sends what the other
        is missing, and both end up with the same content, in any order. That's all reconnecting is.
      </p>
      <Code source={SNIPPETS.merge} />
      <h2>Work offline</h2>
      <p>
        jot makes this something you can try: ⋯ → Work offline, or a click on the status pill,
        closes the note's socket and keeps it editable. The pill counts what's waiting ("Offline · 3
        edits waiting") until you press Reconnect; once the server has confirmed every edit, it says
        "Back online · merged" for a few seconds. Open the note in two windows, take one offline,
        type in both, and reconnect.
      </p>
      <Code source={SNIPPETS.workOffline} />
      <h2>What happens on reconnect</h2>
      <ol>
        <li>The socket reopens. On a lost network the provider retries with backoff.</li>
        <li>
          The server sends <b>sync step 1</b>: its state vector, a compact summary of what it has.
        </li>
        <li>
          The client answers with <b>sync step 2</b>: every update past that vector, its offline
          edits included. It sends its own step 1, and the server answers the same way.
        </li>
        <li>The server applies the client's updates and broadcasts them to everyone else.</li>
      </ol>
      <p>
        When the browser says the network is back, jot doesn't wait for the next retry, unless you
        chose to work offline:
      </p>
      <Code source={SNIPPETS.reconnect} />
      <h2>Where offline edits live</h2>
      <p>
        In memory. There's no Yjs 14 IndexedDB provider yet, so a note's unsynced edits stay in the
        page until the socket is back, and closing its tab while offline loses them. A full note is
        the one exception to "nothing is lost": an edit that would pass{' '}
        <DocLink slug="size">2 MB</DocLink> is refused when it arrives.
      </p>
    </>
  );
}
