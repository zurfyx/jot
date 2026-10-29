import * as stylex from '@stylexjs/stylex';
import { lazy, Suspense } from 'react';

import { Code } from '../Code';
import { frame } from '../inspectorFrame';
import { LEXICAL_Y_WIRE_FORMAT, SNIPPETS } from '../sources';
import { B, C, DocLink, H2, Li, Ol, P, PageHeader, Source, Ul } from '../ui';

// Lexical and Yjs load only when this page is opened.
const Inspector = lazy(() => import('../Inspector'));

export function ContentInYjs() {
  return (
    <>
      <PageHeader crumb="Concepts / How content lives in Yjs" title="How content lives in Yjs" />
      <P>
        The whole note is one Yjs node, <C>lexical-y</C>. Text stays text. Each line ends in a{' '}
        <B>¶ marker</B> that carries the line's type and fields, and blocks that aren't lines, like
        tables, become nested nodes. Type in the editor and watch the root change; hover a line or a
        row to pair them.
      </P>
      <Suspense fallback={<div aria-hidden="true" {...stylex.props(frame.box, frame.loading)} />}>
        <Inspector />
      </Suspense>
      <H2>Reading the tree</H2>
      <Ul>
        <Li>
          <B>The root's attributes:</B> <C>lexical-y:1</C> = <C>true</C> records the layout version
          the note needs, <C>lexical-y-schema:1</C> = <C>true</C> the app's schema version (one
          attribute per version that wrote to the note), and <C>k:&lt;type&gt;</C> how each element
          type is stored, recorded on its first write. A client opens the note read only when the
          highest version recorded is newer than its own.
        </Li>
        <Li>
          <B>Text</B> carries its formats: <C>f:bold</C>, <C>f:italic</C>. A link is a format
          wrapper, <C>w:link</C>, whose value holds the link's fields.
        </Li>
        <Li>
          <B>A ¶ marker</B> ends a line: <C>t</C> is its type (left out for a paragraph) and{' '}
          <C>p:&lt;field&gt;</C> its schema fields, like a heading's <C>p:tag</C>.
        </Li>
        <Li>
          <B>List items</B> are lines in a group: <C>g</C> names the group's type, <C>g:listType</C>{' '}
          its identity, and <C>l</C> the item's level.
        </Li>
        <Li>
          <B>
            <C>b:&lt;type&gt;</C> nodes
          </B>{' '}
          hold blocks that aren't lines, such as a table, its rows and its cells, each with lines of
          its own. Try typing <C>- </C> or <C>## </C> at the start of a line.
        </Li>
      </Ul>
      <H2>Why lines, not nodes</H2>
      <P>
        Typing, splitting and joining lines are text edits: Enter inserts a marker, and Backspace at
        the start of a line deletes one. Yjs merges them the way it merges any text, so two people
        splitting the same paragraph at once both keep their text. Indenting a list item changes its
        marker's level, not its place in a tree.
      </P>
      <H2>Storage kinds</H2>
      <P>
        <C>@lexical/y</C> derives how each element type is stored from the node structure its class
        declares in <C>$config()</C>, first match wins: a block with inline children is a{' '}
        <B>line</B>; an inline element with <C>mergeAdjacent</C> is a <B>format</B>; a block whose
        children are only lines, with <C>mergeAdjacent</C>, is a <B>group</B>; anything else is{' '}
        <B>nested</B>. The first three also need everything the class stores to be in its schema and
        NodeState, since a marker or a format can only carry those. A class that doesn't qualify
        falls back to nested, which stores the node as its own Yjs node and is always safe.{' '}
        <C>describeStorage()</C> prints the result for your editor.
      </P>
      <Code source={SNIPPETS.inspect} />
      <P>
        These names are frozen as layout 1. Changing one makes a new layout version, which older
        clients open read only. The full wire format is in the{' '}
        <a href={LEXICAL_Y_WIRE_FORMAT}>
          <C>@lexical/y</C> README
        </a>
        .
      </P>
    </>
  );
}

export function Presence() {
  return (
    <>
      <PageHeader crumb="Concepts / Presence and cursors" title="Presence and cursors" />
      <P>
        Who's here and where their caret is aren't part of the note. They travel in Yjs{' '}
        <B>awareness</B>: a small, short-lived state per client that the provider relays, and that
        disappears when the client leaves.
      </P>
      <Code source={SNIPPETS.presence} />
      <H2>Cursors that survive edits</H2>
      <P>
        <C>binding.getCursor()</C> turns the Lexical selection into Yjs relative positions, anchored
        to characters rather than offsets: a caret to the character on its left, a range to its
        first and last characters. A peer resolves them against its own copy with{' '}
        <C>binding.$resolveCursor()</C>, inside a read, so a caret stays put while others type
        before it. It returns <C>null</C> when the position can't be resolved.
      </P>
      <H2>In jot</H2>
      <Ul>
        <Li>
          Each browser keeps a name, like "Calm Otter", and a colour: an index into eight peer
          colour tokens, so colours follow light and dark (
          <Source path="src/client/editor/presence.ts">presence.ts</Source>).
        </Li>
        <Li>
          <Source path="src/client/editor/RemoteCarets.tsx">RemoteCarets.tsx</Source> draws each
          peer's caret and selection over the page from <C>createDOMRange</C>. The name shows while
          the caret moves, and shrinks to the bar after three seconds.
        </Li>
        <Li>
          The same states give the avatars at the top right and Note info's "Here now", where
          someone whose caret moved in the last minute is editing, and anyone else is idle (
          <Source path="src/client/editor/people.tsx">people.tsx</Source>).
        </Li>
        <Li>
          Awareness comes from strangers, so names and colours are checked before they're drawn: a
          name is cut to 40 characters, and a colour is wrapped into the palette.
        </Li>
      </Ul>
      <H2>Collaborators inside the tab</H2>
      <P>
        A peer doesn't need another browser. The example note's demo collaborators, "Ana (demo)" and
        "jot AI (demo)", and <DocLink slug="ai">jot AI</DocLink> are in-tab peers: each has its own{' '}
        <C>Y.Doc</C> and client id, a headless editor, and an <C>Awareness</C> of its own. Their
        awareness changes are applied to the note's, which the provider sends like any other, so
        their carets show in every window. The example runs its demo only in the tab that created
        it; other windows see it through the relay (
        <Source path="src/client/editor/peers/peer.ts">peers/peer.ts</Source>).
      </P>
      <H2>On the relay</H2>
      <P>
        The Durable Object relays awareness without y-protocols' <C>Awareness</C> class, whose timer
        would keep the object from hibernating. It keeps each client's last state, forwards changes,
        and announces a client's removal when its socket closes (
        <Source path="src/worker/awareness.ts">awareness.ts</Source>). Clients time out stale states
        on their own.
      </P>
    </>
  );
}

export function Offline() {
  return (
    <>
      <PageHeader crumb="Concepts / Offline and merging" title="Offline and merging" />
      <P>
        Two copies of a Yjs document merge whatever each did while apart: each sends what the other
        is missing, and both end up with the same content, in any order. That's all reconnecting is.
      </P>
      <Code source={SNIPPETS.merge} />
      <H2>Work offline</H2>
      <P>
        jot makes this something you can try: ⋯ → Work offline, or a click on the status pill,
        closes the note's socket and keeps it editable. The pill counts what's waiting ("Offline · 3
        edits waiting") until you press Reconnect; once the server has confirmed every edit, it says
        "Back online · merged" for a few seconds. Open the note in two windows, take one offline,
        type in both, and reconnect.
      </P>
      <Code source={SNIPPETS.workOffline} />
      <H2>What happens on reconnect</H2>
      <Ol>
        <Li>The socket reopens. On a lost network the provider retries with backoff.</Li>
        <Li>
          The server sends <B>sync step 1</B>: its state vector, a compact summary of what it has.
        </Li>
        <Li>
          The client answers with <B>sync step 2</B>: every update past that vector, its offline
          edits included. It sends its own step 1, and the server answers the same way.
        </Li>
        <Li>
          The server applies the client's updates and sends them to every socket, the sender's
          included: <C>@y/websocket</C> takes its own updates coming back as confirmation.
        </Li>
      </Ol>
      <P>
        When the browser says the network is back, jot doesn't wait for the next retry, unless you
        chose to work offline:
      </P>
      <Code source={SNIPPETS.reconnect} />
      <H2>Where offline edits live</H2>
      <P>
        In memory. There's no Yjs 14 IndexedDB provider yet, so a note's unsynced edits stay in the
        page until the socket is back, and closing its tab while offline loses them. A full note is
        the one exception to "nothing is lost": an edit that would pass{' '}
        <DocLink slug="size">2 MB</DocLink> is refused when it arrives.
      </P>
    </>
  );
}
