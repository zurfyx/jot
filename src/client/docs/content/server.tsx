import {
  CLOSE_MALFORMED,
  MESSAGE_AWARENESS,
  MESSAGE_NOTE_STATUS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
} from '../../../shared/protocol';
import { Code } from '../Code';
import { LEXICAL_Y_HEADLESS, SNIPPETS } from '../sources';
import { DocLink, PageHeader, Source } from '../ui';

const MESSAGES: [number, string, string, string][] = [
  [MESSAGE_SYNC, 'sync', 'both', 'y-protocols sync: step 1 (a state vector), step 2, update'],
  [MESSAGE_AWARENESS, 'awareness', 'both', 'y-protocols awareness update'],
  [MESSAGE_QUERY_AWARENESS, 'query awareness', 'to server', 'none; answered with every state'],
  [MESSAGE_NOTE_STATUS, 'note status', 'to client', 'stored bytes, flags (1: update refused)'],
];

/** The relay's shape: browsers, the Worker, one Durable Object per note, SQLite. */
function RelayDiagram() {
  return (
    <figure className="docs-diagram" aria-label="Architecture diagram">
      <div className="arch-col">
        <div className="arch-box">
          <b>
            <i className="is-you" aria-hidden="true" />
            You
          </b>
          <span>a browser: Lexical, @lexical/y</span>
        </div>
        <div className="arch-box">
          <b>
            <i className="is-ana" aria-hidden="true" />
            Ana
          </b>
          <span>a browser: @y/websocket</span>
        </div>
      </div>
      <span className="arch-arrow" aria-hidden="true">
        wss
      </span>
      <div className="arch-box">
        <b>Worker</b>
        <span>routes /api/n/:id/ws, serves the app</span>
      </div>
      <span className="arch-arrow" aria-hidden="true">
        idFromName
      </span>
      <div className="arch-box is-room">
        <b>NoteRoom</b>
        <span>one Durable Object per note, Y.Doc in memory</span>
      </div>
      <span className="arch-arrow" aria-hidden="true">
        one row
      </span>
      <div className="arch-box">
        <b>SQLite</b>
        <span>the state, a 90-day alarm</span>
      </div>
    </figure>
  );
}

export function Relay() {
  return (
    <>
      <PageHeader crumb="Server / The relay on Cloudflare" title="The relay on Cloudflare" />
      <p>
        Each note is one Durable Object: a single-threaded room that holds the Yjs document in
        memory, relays updates between sockets, and saves the state as one SQLite row. The relay is
        Yjs 14 too (<code>@y/y</code>, not yrs), so the server reads exactly what the clients write.
        Its document has Yjs's format cleanup turned off (<code>doc.cleanupFormatting = false</code>
        ), as <code>@lexical/y</code> requires of any server that stores state: with it on, the room
        would delete format items the clients keep, such as those around text someone deleted, and
        send the deletions out as an edit of its own.
      </p>
      <RelayDiagram />
      <h2>Routing</h2>
      <p>
        The Worker checks the note id (22 base64url characters, 128 random bits: the link is the
        key), then hands the WebSocket upgrade to the note's object. Image uploads go to the same
        object, which counts the note's images and stores the file in R2; the Worker serves images
        back from R2 itself. Everything else is static assets, and unknown paths fall back to the
        app (<Source path="src/worker/index.ts">src/worker/index.ts</Source>).
      </p>
      <h2>The room</h2>
      <p>
        Sockets are accepted with the Hibernation API: an idle note is evicted from memory while its
        sockets stay open, and the next message runs the constructor again, which reloads the
        document from SQLite. On connect the room sends sync step 1, everyone's awareness and the
        note's size.
      </p>
      <Code source={SNIPPETS.roomFetch} />
      <h2>The protocol</h2>
      <p>
        The y-websocket protocol, plus one message of jot's own (
        <Source path="src/shared/protocol.ts">protocol.ts</Source>). Every frame starts with a
        varuint message type.
      </p>
      <div className="docs-table-wrap">
        <table className="docs-table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Message</th>
              <th>Direction</th>
              <th>Body</th>
            </tr>
          </thead>
          <tbody>
            {MESSAGES.map(([type, name, direction, body]) => (
              <tr key={type}>
                <td>
                  <code>{type}</code>
                </td>
                <td>{name}</td>
                <td>{direction}</td>
                <td>{body}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        Every applied update goes to every socket, the sender's included: <code>@y/websocket</code>{' '}
        counts its own updates as confirmed when they come back. A malformed frame closes only its
        own socket, with code {CLOSE_MALFORMED}.
      </p>
      <h2>Storage</h2>
      <p>
        A save writes the whole state two seconds after the first unsaved change, and at once when
        the last socket leaves. <DocLink slug="size">Size and limits</DocLink> covers the cap,
        compaction and expiry. The whole room is{' '}
        <Source path="src/worker/room.ts">src/worker/room.ts</Source>.
      </p>
    </>
  );
}

export function ServerSideEditing() {
  return (
    <>
      <PageHeader crumb="Server / Server-side editing" title="Server-side editing" />
      <p>
        <code>@lexical/y/headless</code> reads and writes a note without a browser: seed a new note
        from a template, append a line from a webhook, or export Markdown. Each helper opens the
        state in a headless editor bound to a <code>Y.Doc</code> of its own, with the same
        extensions as your clients, and hands back plain bytes.
      </p>
      <Code source={SNIPPETS.serverEdit} />
      <h2>The three helpers</h2>
      <ul>
        <li>
          <code>seedYState(config, $build)</code>: a new document's state. Seeding identical content
          twice gives the same bytes, and the two seeds merge into one copy.
        </li>
        <li>
          <code>editYState(state, config, $edit)</code>: runs one editor update and returns the
          update it wrote (<code>null</code> when nothing changed), the new state, and any warnings.
        </li>
        <li>
          <code>readYState(state, config, $read)</code>: returns whatever <code>$read</code>{' '}
          returns. Nothing is written.
        </li>
      </ul>
      <h2>Refusals</h2>
      <p>
        <code>editYState</code> writes only to the layout root unless <code>allowedRoots</code> says
        otherwise. It throws a <code>YHeadlessError</code> with a code:{' '}
        <code>'not-initialized'</code> for a note that was never seeded, <code>'read-only'</code>{' '}
        for a newer layout or node types the editor doesn't register, and{' '}
        <code>'foreign-roots'</code> for an update that writes anywhere else. If updates pass
        through yrs older than 0.28, set <code>clientIDRange: 'uint32'</code>.
      </p>
      <h2>In a relay like jot's</h2>
      <p>
        jot's relay doesn't run Lexical: it relays and stores Yjs updates and nothing else. To edit
        from the server, a room would pass <code>Y.encodeStateAsUpdate(this.doc)</code> to{' '}
        <code>editYState</code> and apply the update it returns to its document. The room's update
        handler then broadcasts it to every socket, like a client's. See{' '}
        <a href={LEXICAL_Y_HEADLESS}>
          <code>headless.ts</code>
        </a>{' '}
        at the Lexical commit jot pins for the full API.
      </p>
    </>
  );
}
