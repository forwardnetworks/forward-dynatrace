// Dynatrace's settings service rejects a schema whose PATTERN constraint puts a greedy
// quantifier inside a regex group ("Please use lazy quantifiers within your capture group").
// CI never saw this: v0.13.7 passed every repository check and then failed to install on a tenant.
//
// A quantifier is greedy here when it is `+`, `*`, or a ranged `{n,}` / `{n,m}` that is not
// followed by `?`. A bare `?` and an exact `{n}` are fine, and so is anything outside a group.
//
// Not checked, because the rule's exact scope is unknown: a quantifier applied to the group itself, such as
// `(?:a)+`, and a greedy `?` inside a group. Extend this if Dynatrace is found to reject either.

export const greedyQuantifierInGroup = (pattern: string): string | undefined => {
  let depth = 0;
  let inClass = false;
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (inClass) {
      if (char === "]") inClass = false;
      continue;
    }
    if (char === "[") {
      inClass = true;
      continue;
    }
    if (char === "(") {
      depth += 1;
      continue;
    }
    if (char === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0) continue;
    let quantifier: string | undefined;
    let end = index;
    if (char === "+" || char === "*") {
      quantifier = char;
    } else if (char === "{") {
      const ranged = /^\{\d+,\d*\}/u.exec(pattern.slice(index));
      if (ranged) {
        quantifier = ranged[0];
        end = index + ranged[0].length - 1;
      }
    }
    if (quantifier !== undefined) {
      if (pattern[end + 1] !== "?") return quantifier;
      index = end + 1;
    }
  }
  return undefined;
};

export const collectPatterns = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.flatMap(collectPatterns);
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) =>
      key === "pattern" && typeof child === "string" ? [child] : collectPatterns(child),
    );
  }
  return [];
};
