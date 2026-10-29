import {
  CLOSE_MALFORMED,
  MESSAGE_AWARENESS,
  MESSAGE_NOTE_STATUS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
} from '../../../shared/protocol';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';

import { colors, docs, fonts } from '../../theme/tokens.stylex';
import { Code } from '../Code';
import type { DocsTint } from '../pages';
import { TINT } from '../tint';
import { LEXICAL_Y_HEADLESS, SNIPPETS } from '../sources';
import { C, DocLink, H2, Li, P, PageHeader, prose, Source, Ul } from '../ui';

const MESSAGES: [number, string, string, string][] = [
  [MESSAGE_SYNC, 'sync', 'both', 'y-protocols sync: step 1 (a state vector), step 2, update'],
  [MESSAGE_AWARENESS, 'awareness', 'both', 'y-protocols awareness update'],
  [MESSAGE_QUERY_AWARENESS, 'query awareness', 'to server', 'none; answered with every state'],
  [MESSAGE_NOTE_STATUS, 'note status', 'to client', 'stored bytes, flags (1: update refused)'],
];

/** The relay's shape: browsers, the Worker, one Durable Object per note, SQLite. */
function RelayDiagram() {
  return (
    <figure aria-label="Architecture diagram" {...stylex.props(styles.diagram)}>
      <div {...stylex.props(styles.column)}>
        <Box title="You" tint="you">
          a browser: Lexical, @lexical/y
        </Box>
        <Box title="Ana" tint="ana">
          a browser: @y/websocket
        </Box>
      </div>
      <Arrow>wss</Arrow>
      <Box title="Worker" alone>
        routes /api/n/:id/ws, serves the app
      </Box>
      <Arrow>idFromName</Arrow>
      <Box title="NoteRoom" alone room>
        one Durable Object per note, Y.Doc in memory
      </Box>
      <Arrow>one row</Arrow>
      <Box title="SQLite" alone>
        the state, a 90-day alarm
      </Box>
    </figure>
  );
}

function Box({
  title,
  tint,
  alone = false,
  room = false,
  children,
}: {
  title: string;
  tint?: DocsTint;
  /** A box in the diagram's row, not in a column of boxes. */
  alone?: boolean;
  room?: boolean;
  children: ReactNode;
}) {
  return (
    <div {...stylex.props(styles.box, alone && styles.rowBox, room && styles.room)}>
      <b {...stylex.props(prose.b, styles.boxTitle)}>
        {tint !== undefined && <i aria-hidden="true" {...stylex.props(styles.dot, TINT[tint])} />}
        {title}
      </b>
      <span {...stylex.props(styles.boxText)}>{children}</span>
    </div>
  );
}

function Arrow({ children }: { children: ReactNode }) {
  return (
    <span aria-hidden="true" {...stylex.props(styles.arrow)}>
      {children}
    </span>
  );
}

export function Relay() {
  return (
    <>
      <PageHeader crumb="Server / The relay on Cloudflare" title="The relay on Cloudflare" />
      <P>
        Each note is one Durable Object: a single-threaded room that holds the Yjs document in
        memory, relays updates between sockets, and saves the state as one SQLite row. The relay is
        Yjs 14 too (<C>@y/y</C>, not yrs), so the server reads exactly what the clients write. Its
        document comes from <C>createYDoc()</C> in <C>@lexical/y/headless</C>: garbage collected,
        with Yjs's format cleanup turned off, as <C>@lexical/y</C> requires of any server that
        stores state. With cleanup on, the room would delete format items the clients keep, such as
        those around text someone deleted, and send the deletions out as an edit of its own.
      </P>
      <RelayDiagram />
      <H2>Routing</H2>
      <P>
        The Worker checks the note id (22 base64url characters, 128 random bits: the link is the
        key), then hands the WebSocket upgrade to the note's object. Everything else is static
        assets, and unknown paths fall back to the app (
        <Source path="src/worker/index.ts">src/worker/index.ts</Source>).
      </P>
      <H2>The room</H2>
      <P>
        Sockets are accepted with the Hibernation API: an idle note is evicted from memory while its
        sockets stay open, and the next message runs the constructor again, which reloads the
        document from SQLite. On connect the room sends sync step 1, everyone's awareness and the
        note's size.
      </P>
      <Code source={SNIPPETS.roomFetch} />
      <H2>The protocol</H2>
      <P>
        The y-websocket protocol, plus one message of jot's own (
        <Source path="src/shared/protocol.ts">protocol.ts</Source>). Every frame starts with a
        varuint message type.
      </P>
      <div {...stylex.props(styles.tableWrap)}>
        <table {...stylex.props(styles.table)}>
          <thead>
            <tr>
              {['Type', 'Message', 'Direction', 'Body'].map((title) => (
                <th key={title} {...stylex.props(styles.cell, styles.th)}>
                  {title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MESSAGES.map(([type, name, direction, body]) => (
              <tr key={type}>
                <td {...stylex.props(styles.cell)}>
                  <C>{type}</C>
                </td>
                <td {...stylex.props(styles.cell)}>{name}</td>
                <td {...stylex.props(styles.cell)}>{direction}</td>
                <td {...stylex.props(styles.cell)}>{body}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <P>
        Every applied update goes to every socket, the sender's included: <C>@y/websocket</C> counts
        its own updates as confirmed when they come back. A malformed frame closes only its own
        socket, with code {CLOSE_MALFORMED}.
      </P>
      <H2>Storage</H2>
      <P>
        A save writes the whole state two seconds after the first unsaved change, and at once when
        the last socket leaves. <DocLink slug="size">Size and limits</DocLink> covers the cap,
        compaction and expiry. The whole room is{' '}
        <Source path="src/worker/room.ts">src/worker/room.ts</Source>.
      </P>
    </>
  );
}

export function ServerSideEditing() {
  return (
    <>
      <PageHeader crumb="Server / Server-side editing" title="Server-side editing" />
      <P>
        <C>@lexical/y/headless</C> reads and writes a note without a browser: seed a new note from a
        template, append a line from a webhook, or export Markdown. Each helper opens the state in a
        headless editor bound to a <C>Y.Doc</C> of its own, with the same extensions as your
        clients, and hands back plain bytes.
      </P>
      <Code source={SNIPPETS.serverEdit} />
      <H2>The three helpers</H2>
      <Ul>
        <Li>
          <C>seedYState(config, $build)</C>: a new document's state. Seeding identical content twice
          gives the same bytes, and the two seeds merge into one copy.
        </Li>
        <Li>
          <C>
            editYState(state, config, $edit, {'{'} writer {'}'})
          </C>
          : runs one editor update and returns the update it wrote (<C>null</C> when nothing
          changed), the new state, the client id it wrote under, and any warnings. <C>writer</C> is
          required: a <C>createYWriter('jot AI')</C> made once per process continues one client id
          per note, and <C>null</C> writes under a new anonymous id.
        </Li>
        <Li>
          <C>readYState(state, config, $read)</C>: returns whatever <C>$read</C> returns. Nothing is
          written.
        </Li>
      </Ul>
      <H2>Refusals</H2>
      <P>
        <C>editYState</C> writes only to the layout root unless <C>allowedRoots</C> says otherwise.
        It throws a <C>YHeadlessError</C> with a code, among them <C>'not-initialized'</C> for a
        note that was never seeded, <C>'read-only'</C> for a newer schema version or layout, node
        types the editor doesn't register or content its classes throw on (the error's{' '}
        <C>warnings</C> say which), and <C>'foreign-roots'</C> for an update that writes anywhere
        else. If updates pass through yrs older than 0.28, set <C>clientIDRange: 'uint32'</C>.
      </P>
      <H2>In a relay like jot's</H2>
      <P>
        jot's relay doesn't run Lexical: it relays and stores Yjs updates and nothing else. To edit
        from the server, a room would pass <C>Y.encodeStateAsUpdate(this.doc)</C> to{' '}
        <C>editYState</C> with its writer and apply the update it returns to its document. The
        room's update handler then broadcasts it to every socket, like a client's. See{' '}
        <a href={LEXICAL_Y_HEADLESS}>
          <C>headless.ts</C>
        </a>{' '}
        at the Lexical commit jot pins for the full API.
      </P>
    </>
  );
}

const NARROW = '@media (max-width: 860px)';

const styles = stylex.create({
  // A row on desktop, a column on a phone, so its text never shrinks.
  diagram: {
    display: 'flex',
    flexDirection: { default: null, [NARROW]: 'column' },
    alignItems: { default: 'center', [NARROW]: 'stretch' },
    gap: 10,
    marginTop: 22,
    marginInline: 0,
    marginBottom: 26,
  },
  column: {
    display: 'grid',
    gap: 10,
    flex: { default: '1 1 0', [NARROW]: 'none' },
    minWidth: 0,
  },
  rowBox: {
    flex: { default: '1 1 0', [NARROW]: 'none' },
    minWidth: 0,
  },
  box: {
    paddingBlock: 10,
    paddingInline: 14,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colors['--rule-strong'],
    borderRadius: 12,
    fontSize: 12.5,
    lineHeight: 1.45,
  },
  room: {
    backgroundColor: docs['--docs-tint-ana'],
  },
  boxTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    marginBottom: 2,
    fontSize: 13.5,
  },
  boxText: {
    display: 'block',
    color: colors['--muted'],
  },
  dot: {
    flex: 'none',
    width: 7,
    height: 7,
    borderRadius: 2,
  },
  arrow: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    color: colors['--muted'],
    fontFamily: fonts['--mono'],
    fontSize: 11,
    whiteSpace: 'nowrap',
    '::after': {
      content: { default: "'→'", [NARROW]: "'↓'" },
      fontFamily: fonts['--sans'],
      fontSize: 18,
      lineHeight: 1,
    },
  },
  tableWrap: {
    overflowX: 'auto',
    marginTop: 14,
    marginInline: 0,
    marginBottom: 18,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 14.5,
  },
  cell: {
    paddingTop: 9,
    paddingRight: 14,
    paddingBottom: 9,
    paddingLeft: 0,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: colors['--rule'],
    color: colors['--body'],
    textAlign: 'left',
    verticalAlign: 'top',
  },
  th: {
    color: colors['--muted'],
    fontSize: 13,
    fontWeight: 600,
  },
});
