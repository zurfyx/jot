import { generateNoteId, notePath } from '../../shared/ids';
import { navigate } from '../router';
import { JoinField } from './JoinField';

const GITHUB_URL = 'https://github.com/zurfyx/jot';

export function Landing() {
  return (
    <div className="landing">
      <header className="landing-top">
        <a className="brand" href="/">
          jot
        </a>
        <a className="quiet-link" href={GITHUB_URL}>
          GitHub
        </a>
      </header>

      <main>
        <section className="hero">
          <div className="hero-story">
            <h1>Write together, live.</h1>
            <p className="lede">
              A full-page note anyone with the link can edit at the same time. A prototype of
              Lexical's new collaboration engine.
            </p>
            <NotePreview />
          </div>

          <div className="action-panel">
            <h2>Start or join</h2>
            <button
              type="button"
              className="button-primary button-block"
              onClick={() => navigate(notePath(generateNoteId()))}
            >
              Start a new note
            </button>
            <p className="or">or join with a link or code</p>
            <JoinField />
          </div>
        </section>

        <section className="about" aria-label="About jot">
          <div>
            <h3>What it is</h3>
            <p>
              Lexical's new collaboration engine on Yjs 14, open source, before its npm release.
            </p>
          </div>
          <div>
            <h3>How it works</h3>
            <p>
              Each note's link is its key: no accounts, and anyone with it can edit. Notes are
              deleted after 90 days without visits, so don't paste anything private.
            </p>
          </div>
          <div>
            <h3>Try this</h3>
            <ul>
              <li>Open a note in two windows and type in both.</li>
              <li>Split or join a line while the other types.</li>
              <li>Go offline, keep writing, reconnect.</li>
            </ul>
          </div>
        </section>
      </main>

      <footer className="landing-foot">
        <span>© 2026 Gerard Rovira · MIT License</span>
        <a className="quiet-link" href={GITHUB_URL}>
          GitHub
        </a>
      </footer>
    </div>
  );
}

/** A still picture of a note with a collaborator's caret. */
function NotePreview() {
  return (
    <figure className="preview" aria-label="A note being edited by two people">
      <p className="preview-title">Launch plan</p>
      <p>
        Who owns the migration?
        <span className="preview-caret" aria-hidden="true">
          <span>Ana</span>
        </span>
      </p>
      <p className="preview-muted">Do we pin the release candidate?</p>
    </figure>
  );
}
