import * as stylex from '@stylexjs/stylex';

import { colors } from '../../theme/tokens.stylex';
import { Code } from '../Code';
import { REPO_URL, SNIPPETS } from '../sources';
import {
  B,
  C,
  Callout,
  DocLink,
  H2,
  Li,
  P,
  PageHeader,
  prose,
  Source,
  SourceLink,
  Ul,
} from '../ui';

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
      <P>
        Every item Yjs stores carries the id of the client that inserted it. Yjs 14 adds{' '}
        <B>attributions</B>: a map from those ids to anything you like, here a person, that renders
        alongside the content. jot computes blame in the browser from the document it already has;
        the relay doesn't change.
      </P>
      <P>
        In a note, ⋯ → Show blame underlines each run in its author's colour and names the authors
        in the margin. The "Blame" chip in the dock opens a legend with each person's share in
        characters; click a name to focus them. Hovering text says who wrote it and when they were
        last active. After you reconnect from Work offline, blame shows for four seconds, so you can
        see what merged.
      </P>
      <ol {...stylex.props(prose.list, styles.steps)}>
        {BLAME_STEPS.map(([title, body]) => (
          <li key={title} {...stylex.props(prose.text, styles.step)}>
            <b {...stylex.props(prose.b, styles.stepTitle)}>{title}</b>
            {body}
          </li>
        ))}
      </ol>
      <H2>People, not tabs</H2>
      <P>
        Yjs gives every tab a new client id, so a client id alone isn't a person. jot keeps a second
        root in the note, <C>jot-people</C>, beside <C>lexical-y</C>: one attribute per client id,
        holding a person id, a name, a colour, a kind (person, demo or ai, with who asked for an
        AI's edit) and when they were last seen.
      </P>
      <Code source={SNIPPETS.registry} />
      <Ul>
        <Li>
          <B>"You" is decided by this browser, never by the note.</B> Each browser keeps a person id
          and the client ids its own sessions registered. An entry for one of those client ids is
          always you; an entry claiming your person id from any other client id is someone else.
          There are no accounts, so anyone can write any entry: names are whatever people chose, and
          a last-seen time more than five minutes in the future counts as never seen, so a forged
          entry can't outrank honest ones for good.
        </Li>
        <Li>
          <B>What it costs.</B> A session writes its entry on its first edit, not on a visit, and
          refreshes its last-seen time at most every ten minutes while editing. An entry is about 85
          bytes; each refresh leaves about 26 bytes behind for good (the old value's tombstone, and
          the split it makes in the writer's run of items), about 160 bytes per person per hour of
          editing. It all counts towards the <DocLink slug="size">2 MB</DocLink>.
        </Li>
      </Ul>
      <H2>Attributions</H2>
      <P>
        Every inserted id still in the document, split by client, grouped by the person the registry
        names, and attributed with <C>createContentAttribute('insert', personId)</C>. Clients
        missing from the registry stay unattributed.
      </P>
      <Code source={SNIPPETS.contentMap} />
      <P>
        Rendering the <C>lexical-y</C> root with <C>createAttributionsRenderer</C> gives the{' '}
        <DocLink slug="content-in-yjs">usual tree</DocLink>, with{' '}
        <C>{"attribution: { insert: ['ana'] }"}</C> on every text run. jot walks it into lines of
        runs (a length and a person) the way the inspector walks it into rows.
      </P>
      <Code source={SNIPPETS.computeBlame} />
      <H2>Never guess</H2>
      <Ul>
        <Li>
          <B>Moves and joins.</B> The binding writes a moved line as a deletion and an insertion, so
          whoever moved it wrote it again, and blame names them. <C>toDelta</C> renders storage
          order, which then is Lexical's order. Notes from jot's earliest builds, written before{' '}
          <C>@lexical/y</C> froze its layout, can hold move records (<C>↷</C>), which show a range
          of lines somewhere else; such a note opens read only, and blame walks its stored items to
          find every line a record covers, and the line a join shows in, and leaves those unpainted.
          If that walk and the delta disagree at all, nothing is painted.
        </Li>
        <Li>
          <B>Pairing lines.</B> Blame's lines pair with Lexical's line elements (a walk of the
          editor state for blocks whose children are inline). A text unique on both sides pairs
          wherever it is; a repeated text pairs only in order, when both sides hold it equally
          often. A line whose text doesn't match its element is skipped.
        </Li>
        <Li>
          <B>Deleted text isn't shown.</B> jot garbage-collects it to stay under 2 MB, so blame
          shows who wrote what's in the note now; there's no version history to step through.
        </Li>
      </Ul>
      <H2>Painting without touching Lexical's DOM</H2>
      <P>
        A TreeWalker maps each run's offsets onto the line's text nodes (a line break counts as one
        character), and the runs become <C>StaticRange</C>s in one <C>Highlight</C> per person. A
        constructed style sheet gives each <C>::highlight(jot-blame-N)</C> a 2px underline in that
        person's colour token; focusing a person fades the others.
      </P>
      <Code source={SNIPPETS.underline} />
      <P>
        The margin is an overlay beside the column: a bar for each run of lines with the same main
        author, named where there's room. While blame shows, it all recomputes 150ms after the last
        change, and at least once a second while changes keep coming. The code is in{' '}
        <SourceLink href={`${REPO_URL}/tree/main/src/client/editor/blame`}>
          src/client/editor/blame/
        </SourceLink>
        .
      </P>
      <Callout title="Missing, never wrong">
        Where blame can't be sure (a line an early note's move record covers, a line it can't pair
        with Lexical's, text written before its author registered) it shows nothing, rather than the
        wrong person.
      </Callout>
    </>
  );
}

export function Ai() {
  return (
    <>
      <PageHeader crumb="Features / AI as a collaborator" title="AI as a collaborator" />
      <P>
        Ask AI, in the dock, rewrites the selected blocks, or the one with the caret, with a model
        that runs on your device: Chrome's built-in Gemini Nano, or a small open model in the
        browser through WebLLM. The answer isn't pasted in as your edit. jot AI writes it as a
        collaborator of its own, a Yjs peer inside your tab, so it merges with whatever anyone types
        meanwhile, reaches every window through the relay, and is named in{' '}
        <DocLink slug="blame">blame</DocLink>, asked by you.
      </P>
      <H2>Three models, one setting</H2>
      <P>
        ⋯ → AI model lists them, with where each runs, what it downloads and whether it's here. jot
        picks one that fits the device, and remembers your choice in this browser.
      </P>
      <Ul>
        <Li>
          <B>Chrome built-in:</B> Gemini Nano through the Prompt API, in Chrome and Edge on desktop.
          Chrome downloads and keeps it. The default wherever it's ready.
        </Li>
        <Li>
          <B>Small:</B> Qwen2.5 0.5B Instruct in WebLLM, 300 MB. The default on phones, tablets and
          devices with 4 GB of memory or less, wherever WebGPU runs.
        </Li>
        <Li>
          <B>Larger:</B> Qwen3 1.7B in WebLLM, 990 MB. Better edits; the default on laptops and
          desktops without Chrome's model.
        </Li>
      </Ul>
      <P>
        Without WebGPU or Chrome's model, Ask AI says why and offers nothing else. Small models are
        small: lists and spelling work, shortening and renumbering often don't.
      </P>
      <H2>Chrome's model</H2>
      <Code source={SNIPPETS.prompt} />
      <Ul>
        <Li>
          <B>Opening the field sends nothing.</B> It asks the browser whether the model is there,
          for English text in and out.
        </Li>
        <Li>
          <B>Only Ask sends.</B> Creating the model is what starts its download, which needs a
          click; the field shows the progress. One request runs at a time, and Esc cancels it (the
          abort signal reaches both <C>create</C> and <C>prompt</C>), writing nothing.
        </Li>
        <Li>
          <B>It must fit.</B> Where the browser can tell, <C>measureInputUsage()</C> checks the
          passage against the context window, under a 12,000-character ceiling. A reply is capped at
          20,000 characters and refused when the note has no room left for it.
        </Li>
      </Ul>
      <H2>WebLLM, in a worker</H2>
      <Code source={SNIPPETS.webllmWorker} />
      <Ul>
        <Li>
          <B>Nothing downloads without a yes.</B> The first Ask with a WebLLM model asks "Ask AI
          needs a 300 MB model on this device (Qwen2.5 0.5B). Download it?", and warns about mobile
          data on a phone. The model comes from Hugging Face into the browser's cache, never from
          jot's server, with its progress in the field; Esc stops the worker and the download.
        </Li>
        <Li>
          <B>The page stays light.</B> Only the worker imports WebLLM, and it starts on the first
          Ask, never on page load. What is downloaded the page reads from Cache Storage itself. The
          model stays loaded for five idle minutes, then the worker stops and the GPU memory is
          free.
        </Li>
        <Li>
          <B>It must fit.</B> The models have a 4,096-token window, shared by the passage and its
          rewrite: the passage may be up to 5,544 characters, and a reply that ran out of room is
          refused rather than written half done.
        </Li>
        <Li>
          <B>Delete it.</B> ⋯ → AI model deletes a downloaded model from the browser. If the browser
          evicted it (Safari does), the next Ask asks again before downloading.
        </Li>
      </Ul>
      <H2>What it rewrites</H2>
      <P>
        Whole top-level blocks: every block the selection touches, or the block with the caret. A
        caret anywhere in a list takes the whole list, and the field says so ("Rewrites the whole
        list") before anything is sent. Tables are refused, since Markdown can't carry them here.
        The target is kept as a Yjs cursor, so it survives other people's edits and resolves in jot
        AI's own editor too.
      </P>
      <H2>Markdown in, Markdown out</H2>
      <P>
        The blocks go to the model as Markdown, exported with the editor's own transformers, and the
        reply is parsed back with <C>$generateNodesFromMarkdownString</C> to replace them. A model
        may wrap its answer in a fence, so one is unwrapped only when it's tagged <C>markdown</C>{' '}
        and holds no other fence; an untagged fence stays a code block. Links the model writes keep
        only http, https and mailto targets.
      </P>
      <Code source={SNIPPETS.cleanReply} />
      <H2>Never overwrite a change</H2>
      <P>
        The model can take seconds. When it's ready, jot AI reads the target from its own editor:
        the Markdown for the model, and a lossless snapshot of the blocks. When the reply comes, it
        writes only if the snapshot is unchanged; otherwise the field says the text changed and
        nothing is written. Markdown alone wouldn't notice an underline, an alignment or a run of
        spaces.
      </P>
      <Code source={SNIPPETS.snapshotBlocks} />
      <H2>jot AI, a peer in the tab</H2>
      <P>
        jot AI joins only once the model is ready, not during a download: a fresh <C>Y.Doc</C>, so a
        fresh client id, starting from a copy of the note, and a headless Lexical editor (no root
        element) running <C>YCollabExtension</C>. The two documents stay in step through{' '}
        <C>update</C> events, with origins so nothing echoes back. Its own <C>Awareness</C> is
        relayed into the note's, so its violet caret shows to everyone, on the blocks it's working
        on.
      </P>
      <Code source={SNIPPETS.aiPeer} />
      <Ul>
        <Li>
          <B>Blame.</B> jot AI's registry entry has kind <C>ai</C>, one per asker (
          <C>ai-&lt;person id&gt;</C>) with <C>askedBy</C>, written with its first change, so a
          cancelled request leaves nothing in the note. When it writes, the asker is registered too
          (<C>writeLocalEntry</C>, as this browser's own session), so blame says "asked by You" in
          their tab and their name elsewhere. Its edit goes through its own binding, which keeps the
          characters a rewrite leaves unchanged, so blame credits jot AI with exactly what changed.
        </Li>
        <Li>
          <B>Leaving.</B> A peer mirrors every change to the note while it lives, so jot AI leaves a
          minute after its last request, and joins again, with a new client id, for the next.
        </Li>
        <Li>
          <B>Undo.</B> jot AI's edit is another client's edit, so your undo doesn't revert it.
        </Li>
      </Ul>
      <P>
        The code is in{' '}
        <SourceLink href={`${REPO_URL}/tree/main/src/client/editor/ai`}>
          src/client/editor/ai/
        </SourceLink>{' '}
        and <Source path="src/client/editor/peers/peer.ts">src/client/editor/peers/peer.ts</Source>.
      </P>
    </>
  );
}

export function Size() {
  return (
    <>
      <PageHeader crumb="Features / Size and limits" title="Size and limits" />
      <P>
        A note holds up to 2 MB of Yjs state, because a note is one SQLite row and Cloudflare caps a
        row at 2 MB. At 1.6 MB the page says the note is almost full; when an edit no longer fits,
        the note goes read only.
      </P>
      <H2>Measuring</H2>
      <P>
        A note's size is the length of <C>Y.encodeStateAsUpdate(doc)</C>: the whole state, as
        stored. The relay reports it in a message of jot's own (type 64). After each save, and when
        it refuses an update, the figure is measured. On connect it's an upper bound: the size at
        the last measure plus the bytes applied since, which can run ahead of the truth during the
        two seconds before a save. The client also measures its own copy a second after changes and
        when the server confirms its edits, which covers edits the server hasn't seen yet, and goes
        by the larger of the two (<Source path="src/client/editor/session.ts">session.ts</Source>).
      </P>
      <P>
        The status pill shows it ("Synced · 238 KB"), and ⋯ → Note info shows it against the cap
        with a meter. Both turn amber at 1.6 MB and red when the note is full.
      </P>
      <H2>Checking every update cheaply</H2>
      <P>
        Measuring the merged state on every keystroke would be wasteful, so the relay keeps an upper
        bound: the size at the last measure, plus the bytes applied since, plus the update and 64
        bytes of overhead.
      </P>
      <Code source={SNIPPETS.fitsUnderCap} />
      <P>
        Only when the bound fails does it measure exactly, by merging the update into the state. An
        update that would pass 2 MB isn't applied, and its sender is told.
      </P>
      <Code source={SNIPPETS.roomUpdate} />
      <H2>Compaction</H2>
      <P>
        The relay's document has garbage collection on, and every save writes{' '}
        <C>encodeStateAsUpdate</C> of it, so deleted text never piles up in storage: a note typed
        and erased all day stays small.
      </P>
      <Code source={SNIPPETS.roomSave} />
      <H2>Expiry</H2>
      <P>
        Every visit sets the note's alarm to 90 days out. If it fires while someone is connected, it
        reschedules; otherwise the note's storage is deleted.
      </P>
    </>
  );
}

const styles = stylex.create({
  steps: {
    display: 'grid',
    gridTemplateColumns: {
      default: 'repeat(4, minmax(0, 1fr))',
      '@media (max-width: 860px)': 'minmax(0, 1fr)',
    },
    gap: 10,
    maxWidth: 'none',
    paddingLeft: 0,
    listStyleType: 'none',
  },
  step: {
    margin: 0,
    paddingBlock: 10,
    paddingInline: 12,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colors['--rule'],
    borderRadius: 12,
    fontSize: 13.5,
    lineHeight: 1.5,
  },
  stepTitle: {
    display: 'block',
    marginBottom: 3,
    fontSize: 14,
  },
});
