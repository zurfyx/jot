import * as Y from '@y/y';

/**
 * Two copies of one document edit apart, then exchange what the other is
 * missing. Each sends only the updates past the other's state vector, and
 * both end up with the same content, whatever order the updates arrive in.
 */
export function editApartThenMerge() {
  const you = new Y.Doc();
  const ana = new Y.Doc();
  you.get('notes').insert(0, 'Bring snacks.');
  Y.applyUpdate(ana, Y.encodeStateAsUpdate(you)); // both start from the same text

  // Offline: neither sees the other's edit yet.
  you.get('notes').insert(0, 'Friday: ');
  ana.get('notes').insert(13, ' And plates.');

  // Back online: sync step 1 sends a state vector, step 2 answers with the difference.
  const toAna = Y.encodeStateAsUpdate(you, Y.encodeStateVector(ana));
  const toYou = Y.encodeStateAsUpdate(ana, Y.encodeStateVector(you));
  Y.applyUpdate(ana, toAna);
  Y.applyUpdate(you, toYou);

  return [you.get('notes').toString(), ana.get('notes').toString()];
}
