/**
 * Wire protocol between the client's `@y/websocket` provider and the note's
 * Durable Object: the y-websocket message types (sync and awareness), plus
 * one message of jot's own that reports the note's stored size.
 *
 * Every message starts with a varuint message type.
 */

/** y-websocket: a y-protocols sync message (step 1, step 2 or update). */
export const MESSAGE_SYNC = 0;
/** y-websocket: a y-protocols awareness update. */
export const MESSAGE_AWARENESS = 1;
/** y-websocket: auth (permission denied). jot does not send it. */
export const MESSAGE_AUTH = 2;
/** y-websocket: asks for every known awareness state. */
export const MESSAGE_QUERY_AWARENESS = 3;

/**
 * jot: the note's stored size. Body: varuint bytes, varuint flags.
 * Sent on connect, after each save, and when an update is rejected.
 */
export const MESSAGE_NOTE_STATUS = 64;

/** Flag: the server rejected an update because the note is full. */
export const NOTE_STATUS_REJECTED = 1;

/**
 * jot: the note's verdict on this session (the generation fence, D34).
 * Body: varuint verdict (FENCE_*), varstring the note's generation, varuint
 * 1 when the client may seed an empty note. Sent first, and only to a socket
 * that presented the handshake: a client from before the fence does not skip
 * an unknown message's body (`@y/websocket` reads it as further messages).
 */
export const MESSAGE_NOTE_FENCE = 65;

/** Sync both ways. */
export const FENCE_ADMIT = 0;
/** A replica with nothing of its own: the server's sync step 2 is the whole note. */
export const FENCE_BOOTSTRAP = 1;
/** Edits made against another generation: no sync; hand them off, then connect again. */
export const FENCE_STALE = 2;
/** This release cannot read or seed the note: reload. */
export const FENCE_REFUSE_LAYOUT = 3;

/**
 * The second root of a note's Y.Doc, beside `lexical-y`: the people registry
 * that maps Yjs client ids to people, for blame (D19). The relay stores it
 * like any other content.
 */
export const PEOPLE_ROOT = 'jot-people';

/** y-protocols sync message subtypes. */
export const SYNC_STEP_1 = 0;
export const SYNC_STEP_2 = 1;
export const SYNC_UPDATE = 2;

/** WebSocket close codes the Durable Object uses. */
export const CLOSE_MALFORMED = 1007;
export const CLOSE_GOING_AWAY = 1001;
export const CLOSE_INTERNAL_ERROR = 1011;
/** The note moved on (a new incarnation or a migration): every socket reconnects through the fence (D34). */
export const CLOSE_NOTE_UPGRADED = 4000;
