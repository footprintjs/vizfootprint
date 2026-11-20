import type { RouteCandidate, RouteNode, RouteOptions, RoutePolicy, RoutePort } from './types.js';

/** Capture configuration once, keeping each callback's declared receiver. */
export function capturePort(port: RoutePort, overrides?: Partial<RoutePolicy>) {
  if (port === undefined || port === null) throw new TypeError('A routing port with a scorer and decision is required');
  const scorer = port.scorer;
  if (scorer === undefined || scorer === null) throw new TypeError('The routing port scorer is required');
  const name = scorer.name;
  const score = scorer.score;
  const decide = port.decide;
  const declared = port.policy;
  if (typeof name !== 'string' || typeof score !== 'function') throw new TypeError('The routing port scorer needs a name and score function');
  if (typeof decide !== 'function') throw new TypeError('The routing port decide function is required');
  if (declared === undefined || declared === null) throw new TypeError('The routing port policy is required');
  // Both objects are caller-owned. Reading their known fields once captures the
  // evidence before score() can change them; unknown fields never enter it.
  const supplied = { nearTieMargin: declared.nearTieMargin, menuSize: declared.menuSize, floor: declared.floor };
  const keys = ['nearTieMargin', 'menuSize', 'floor'] as const;
  const replaced = new Set(keys.filter(key => overrides !== undefined && Object.hasOwn(overrides, key)));
  const replace = (key: keyof RoutePolicy): number | undefined =>
    replaced.has(key) ? overrides![key] : supplied[key];
  const nearTieMargin = replace('nearTieMargin');
  const menuSize = replace('menuSize');
  const floor = replace('floor');
  if (typeof nearTieMargin !== 'number' || typeof menuSize !== 'number' || (floor !== undefined && typeof floor !== 'number')) {
    throw new TypeError('The routing port policy needs numeric nearTieMargin, menuSize and optional floor');
  }
  const hasFloor = Object.hasOwn(declared, 'floor') || replaced.has('floor');
  const owned: RoutePolicy = { nearTieMargin, menuSize, ...(hasFloor ? { floor } : {}) };
  return { name, policy: owned,
    score: (...args: Parameters<typeof score>): ReturnType<typeof score> => Reflect.apply(score, scorer, args),
    decide: (...args: Parameters<typeof decide>): ReturnType<typeof decide> => Reflect.apply(decide, port, args),
  };
}

export function captureNodes(nodes: readonly RouteNode[]): RouteNode[] {
  return nodes.map(node => {
    const { id, viewId, kinds, does, examples } = node;
    return { id, viewId, kinds: [...kinds], does,
      ...(examples !== undefined || Object.hasOwn(node, 'examples') ? { examples: examples === undefined ? undefined : [...examples] } : {}),
    };
  });
}

export function candidatesFor(nodes: readonly RouteNode[]): RouteCandidate[] {
  return nodes.map(node => ({ id: node.id, text: node.does, examples: [...(node.examples ?? [])] }));
}

/** The scorer receives a disposable copy, never the IDs used to validate it. */
export function copyCandidates(candidates: readonly RouteCandidate[]): RouteCandidate[] {
  return candidates.map(({ id, text, examples }) => ({ id, text, examples: [...examples] }));
}

/** Read call options before awaiting foreign code. */
export function captureOptions(options: RouteOptions) {
  const { incumbent, policy, signal } = options;
  return { incumbent, policy, signal };
}
