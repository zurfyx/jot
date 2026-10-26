import {
  $create,
  $getState,
  $setState,
  DecoratorNode,
  type LexicalEditor,
  type LexicalNode,
} from 'lexical';
import { createElement, type ReactNode } from 'react';

import { ImageView } from './ImageView';
import {
  altState,
  dimension,
  heightState,
  IMAGE_NODE_TYPE,
  srcState,
  startedState,
  uploadState,
  widthState,
} from './states';

/**
 * An image in a note (D26). The node holds no bytes: only the image's path
 * on jot, its alt text and its size, all in NodeState, so `@lexical/y`
 * stores it whole (a decorator is stored as its own node, its state as
 * `s:<key>` attributes).
 *
 * Every value is parsed as untrusted input, since any peer can write any
 * attribute: `src` keeps only a jot image path (`/api/n/<id>/images/<key>`),
 * never a URL; the view then shows it only when the id is this note's.
 */

export interface ImageData {
  src: string;
  alt: string;
  width: number;
  height: number;
  upload: string;
  started: number;
}

export class ImageNode extends DecoratorNode<ReactNode> {
  $config() {
    return this.config(IMAGE_NODE_TYPE, {
      extends: DecoratorNode,
      stateConfigs: [
        { stateConfig: srcState },
        { stateConfig: altState },
        { stateConfig: widthState },
        { stateConfig: heightState },
        { stateConfig: uploadState },
        { stateConfig: startedState },
      ],
    });
  }

  createDOM(): HTMLElement {
    const element = document.createElement('div');
    element.className = 'jot-image-block';
    element.contentEditable = 'false';
    return element;
  }

  updateDOM(): false {
    return false;
  }

  isInline(): false {
    return false;
  }

  getTextContent(): string {
    return '';
  }

  /** The node's values as they are in this version (no getLatest: safe while reconciling). */
  data(): ImageData {
    return {
      src: $getState(this, srcState, 'direct'),
      alt: $getState(this, altState, 'direct'),
      width: $getState(this, widthState, 'direct'),
      height: $getState(this, heightState, 'direct'),
      upload: $getState(this, uploadState, 'direct'),
      started: $getState(this, startedState, 'direct'),
    };
  }

  decorate(editor: LexicalEditor): ReactNode {
    return createElement(ImageView, { editor, nodeKey: this.getKey(), ...this.data() });
  }
}

export function $createImageNode(data: Partial<ImageData>): ImageNode {
  const node = $create(ImageNode);
  if (data.src !== undefined) $setState(node, srcState, srcState.parse(data.src));
  if (data.alt !== undefined) $setState(node, altState, altState.parse(data.alt));
  if (data.width !== undefined) $setState(node, widthState, dimension(data.width));
  if (data.height !== undefined) $setState(node, heightState, dimension(data.height));
  if (data.upload !== undefined) $setState(node, uploadState, uploadState.parse(data.upload));
  if (data.started !== undefined) $setState(node, startedState, startedState.parse(data.started));
  return node;
}

export function $isImageNode(node: LexicalNode | null | undefined): node is ImageNode {
  return node instanceof ImageNode;
}
