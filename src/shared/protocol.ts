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
