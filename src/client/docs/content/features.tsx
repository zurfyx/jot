import { Code } from '../Code';
import { REPO_URL, SNIPPETS } from '../sources';
import { Callout, DocLink, PageHeader, Source } from '../ui';

const BLAME_STEPS: [string, string][] = [
  ['1 · Who is who', 'A people registry in the note maps Yjs client ids to people.'],
  ['2 · Attribute', "Each person's inserted ids become one content map."],
  ['3 · Render', 'toDelta returns every run of text with its author.'],
  ['4 · Paint', 'Underlines and margin names beside Lexical, never in it.'],
];

export function Blame() {
  return (
    <>
      <PageHeader crumb="Features / Blame and history" title="Blame and history" />
      <p>
        Every item Yjs stores carries the id of the client that inserted it. Yjs 14 adds{' '}
        <b>attributions</b>: a map from those ids to anything you like, here a person, that renders
        alongside the content. jot computes blame in the browser from the document it already has;
        the relay doesn't change.
      </p>
      <p>
        In a note, ⋯ → Show blame underlines each run in its author's colour and names the authors
        in the margin. The "Blame" chip in the dock opens a legend with each person's share in
        characters; click a name to focus them. Hovering text says who wrote it and when they were
        last active. After you reconnect from Work offline, blame shows for four seconds, so you can
        see what merged.
      </p>
      <ol className="docs-steps">
        {BLAME_STEPS.map(([title, body]) => (
          <li key={title}>
            <b>{title}</b>
            {body}
          </li>
        ))}
      </ol>
      <h2>People, not tabs</h2>
      <p>
        Yjs gives every tab a new client id, so a client id alone isn't a person. jot keeps a second
        root in the note, <code>jot-people</code>, beside <code>lexical-y</code>: one attribute per
        client id, holding a person id, a name, a colour, a kind (person, demo or ai, with who asked
        for an AI's edit) and when they were last seen.
      </p>
      <Code source={SNIPPETS.registry} />
      <ul>
        <li>
          <b>"You" is decided by this browser, never by the note.</b> Each browser keeps a person id
          and the client ids its own sessions registered. An entry for one of those client ids is
          always you; an entry claiming your person id from any other client id is someone else.
          There are no accounts, so anyone can write any entry: names are whatever people chose, and
          a last-seen time more than five minutes in the future counts as never seen, so a forged
          entry can't outrank honest ones for good.
        </li>
        <li>
          <b>What it costs.</b> A session writes its entry on its first edit, not on a visit, and
          refreshes its last-seen time at most every ten minutes while editing. An entry is about 85
          bytes; each refresh leaves about 26 bytes behind for good (the old value's tombstone, and
          the split it makes in the writer's run of items), about 160 bytes per person per hour of
          editing. It all counts towards the <DocLink slug="size">2 MB</DocLink>.
        </li>
      </ul>
      <h2>Attributions</h2>
      <p>
        Every inserted id still in the document, split by client, grouped by the person the registry
        names, and attributed with <code>createContentAttribute('insert', personId)</code>. Clients
        missing from the registry stay unattributed.
      </p>
      <Code source={SNIPPETS.contentMap} />
      <p>
        Rendering the <code>lexical-y</code> root with <code>createAttributionsRenderer</code> gives
        the <DocLink slug="content-in-yjs">usual tree</DocLink>, with{' '}
        <code>{"attribution: { insert: ['ana'] }"}</code> on every text run. jot walks it into lines
        of runs (a length and a person) the way the inspector walks it into rows.
      </p>
      <Code source={SNIPPETS.computeBlame} />
      <h2>Never guess</h2>
      <ul>
        <li>
          <b>Moves and joins.</b> <code>toDelta</code> renders storage order, but in layout 2 a move
          record (<code>↷</code>) shows a range of lines somewhere else, and a join shows pieces of
          other lines inside one. When the tree holds a record, a walk of the stored items finds
          every line its range covers, and the line a join shows in, and those stay unpainted. If
          that walk and the delta disagree at all, nothing is painted.
        </li>
        <li>
          <b>Pairing lines.</b> Blame's lines pair with Lexical's line elements (a walk of the
          editor state for blocks whose children are inline). A text unique on both sides pairs
          wherever it is; a repeated text pairs only in order, when both sides hold it equally
          often. A line whose text doesn't match its element is skipped.
        </li>
        <li>
          <b>Deleted text isn't shown.</b> jot garbage-collects it to stay under 2 MB, so blame
          shows who wrote what's in the note now; there's no version history to step through.
        </li>
      </ul>
      <h2>Painting without touching Lexical's DOM</h2>
      <p>
        A TreeWalker maps each run's offsets onto the line's text nodes (a line break counts as one
        character), and the runs become <code>StaticRange</code>s in one <code>Highlight</code> per
        person. A constructed style sheet gives each <code>::highlight(jot-blame-N)</code> a 2px
        underline in that person's colour token; focusing a person fades the others.
      </p>
      <Code source={SNIPPETS.underline} />
      <p>
        The margin is an overlay beside the column: a bar for each run of lines with the same main
        author, named where there's room. While blame shows, it all recomputes 150ms after the last
        change, and at least once a second while changes keep coming. The code is in{' '}
        <a className="docs-source" href={`${REPO_URL}/tree/main/src/client/editor/blame`}>
          <code>src/client/editor/blame/</code>
        </a>
        .
      </p>
      <Callout title="Missing, never wrong">
        Where blame can't be sure (a moved or joined line, a repeated line after a move, text
        written before its author registered) it shows nothing, rather than the wrong person.
      </Callout>
    </>
  );
}

export function Ai() {
  return (
    <>
      <PageHeader crumb="Features / AI as a collaborator" title="AI as a collaborator" />
      <p>
        Ask AI, in the dock, rewrites the selected blocks, or the one with the caret, with Chrome's
        built-in model: Gemini Nano, on your device, through the Prompt API. The answer isn't pasted
        in as your edit. jot AI writes it as a collaborator of its own, a Yjs peer inside your tab,
        so it merges with whatever anyone types meanwhile, reaches every window through the relay,
        and is named in <DocLink slug="blame">blame</DocLink>, asked by you.
      </p>
      <h2>The model, on the device</h2>
      <Code source={SNIPPETS.prompt} />
      <ul>
        <li>
          <b>Opening the field sends nothing.</b> It asks the browser whether the model is there,
          for English text in and out. Without it, Ask AI says it needs Chrome's built-in AI and
          offers nothing else.
        </li>
        <li>
          <b>Only Ask sends.</b> Creating the model is what starts its download, which needs a
          click; the field shows the progress. One request runs at a time, and Esc cancels it (the
          abort signal reaches both <code>create</code> and <code>prompt</code>), writing nothing.
        </li>
        <li>
          <b>It must fit.</b> Where the browser can tell, <code>measureInputUsage()</code> checks
          the passage against the context window, under a 12,000-character ceiling. A reply is
          capped at 20,000 characters and refused when the note has no room left for it.
        </li>
      </ul>
      <h2>What it rewrites</h2>
      <p>
        Whole top-level blocks: every block the selection touches, or the block with the caret. A
        caret anywhere in a list takes the whole list, and the field says so ("Rewrites the whole
        list") before anything is sent. Tables are refused, since Markdown can't carry them here.
        The target is kept as a Yjs cursor, so it survives other people's edits and resolves in jot
        AI's own editor too.
      </p>
      <h2>Markdown in, Markdown out</h2>
      <p>
        The blocks go to the model as Markdown, exported with the editor's own transformers, and the
        reply is parsed back with <code>$generateNodesFromMarkdownString</code> to replace them. A
        model may wrap its answer in a fence, so one is unwrapped only when it's tagged{' '}
        <code>markdown</code> and holds no other fence; an untagged fence stays a code block. Links
        the model writes keep only http, https and mailto targets.
      </p>
      <Code source={SNIPPETS.cleanReply} />
      <h2>Never overwrite a change</h2>
      <p>
        The model can take seconds. When it's ready, jot AI reads the target from its own editor:
        the Markdown for the model, and a lossless snapshot of the blocks. When the reply comes, it
        writes only if the snapshot is unchanged; otherwise the field says the text changed and
        nothing is written. Markdown alone wouldn't notice an underline, an alignment or a run of
        spaces.
      </p>
      <Code source={SNIPPETS.snapshotBlocks} />
      <h2>jot AI, a peer in the tab</h2>
      <p>
        jot AI joins only once the model is ready, not during a download: a fresh <code>Y.Doc</code>
        , so a fresh client id, starting from a copy of the note, and a headless Lexical editor (no
        root element) running <code>YCollabExtension</code>. The two documents stay in step through{' '}
        <code>update</code> events, with origins so nothing echoes back. Its own{' '}
        <code>Awareness</code> is relayed into the note's, so its violet caret shows to everyone, on
        the blocks it's working on.
      </p>
      <Code source={SNIPPETS.aiPeer} />
      <ul>
        <li>
          <b>Blame.</b> jot AI's registry entry has kind <code>ai</code>, one per asker (
          <code>ai-&lt;person id&gt;</code>) with <code>askedBy</code>, written with its first
          change, so a cancelled request leaves nothing in the note. When it writes, the asker is
          registered too (<code>writeLocalEntry</code>, as this browser's own session), so blame
          says "asked by You" in their tab and their name elsewhere. Its edit goes through its own
          binding, which keeps the characters a rewrite leaves unchanged, so blame credits jot AI
          with exactly what changed.
        </li>
        <li>
          <b>Leaving.</b> A peer mirrors every change to the note while it lives, so jot AI leaves a
          minute after its last request, and joins again, with a new client id, for the next.
        </li>
        <li>
          <b>Undo.</b> jot AI's edit is another client's edit, so your undo doesn't revert it.
        </li>
      </ul>
      <p>
        The code is in{' '}
        <a className="docs-source" href={`${REPO_URL}/tree/main/src/client/editor/ai`}>
          <code>src/client/editor/ai/</code>
        </a>{' '}
        and <Source path="src/client/editor/peers/peer.ts">src/client/editor/peers/peer.ts</Source>.
      </p>
    </>
  );
}

export function Size() {
  return (
    <>
      <PageHeader crumb="Features / Size and limits" title="Size and limits" />
      <p>
        A note holds up to 2 MB of Yjs state, because a note is one SQLite row and Cloudflare caps a
        row at 2 MB. At 1.6 MB the page says the note is almost full; when an edit no longer fits,
        the note goes read only.
      </p>
      <h2>Measuring</h2>
      <p>
        A note's size is the length of <code>Y.encodeStateAsUpdate(doc)</code>: the whole state, as
        stored. The relay reports its stored size in a message of jot's own (type 64) on connect,
        after each save, and when it refuses an update. The client also measures its own copy a
        second after changes and when the server confirms its edits, which covers edits the server
        hasn't seen yet, and goes by the larger of the two (
        <Source path="src/client/editor/session.ts">session.ts</Source>).
      </p>
      <p>
        The status pill shows it ("Synced · 238 KB"), and ⋯ → Note info shows it against the cap
        with a meter. Both turn amber at 1.6 MB and red when the note is full.
      </p>
      <h2>Checking every update cheaply</h2>
      <p>
        Measuring the merged state on every keystroke would be wasteful, so the relay keeps an upper
        bound: the size at the last measure, plus the bytes applied since, plus the update and 64
        bytes of overhead.
      </p>
      <Code source={SNIPPETS.fitsUnderCap} />
      <p>
        Only when the bound fails does it measure exactly, by merging the update into the state. An
        update that would pass 2 MB isn't applied, and its sender is told.
      </p>
      <Code source={SNIPPETS.roomUpdate} />
      <h2>Compaction</h2>
      <p>
        The relay's document has garbage collection on, and every save writes{' '}
        <code>encodeStateAsUpdate</code> of it, so deleted text never piles up in storage: a note
        typed and erased all day stays small.
      </p>
      <Code source={SNIPPETS.roomSave} />
      <h2>Expiry</h2>
      <p>
        Every visit sets the note's alarm to 90 days out. If it fires while someone is connected, it
        reschedules; otherwise the note's storage is deleted.
      </p>
    </>
  );
}
