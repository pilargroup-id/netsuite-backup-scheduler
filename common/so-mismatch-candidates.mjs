// Pure parser of verified SO checker mismatch examples. No writes or side effects.
export function parseSoMismatchCandidates(output, maxIds = 8) {
  if (typeof output !== 'string') return {ok:false,reason:'INVALID_OUTPUT',ids:[]};
  const matches = [...output.matchAll(/^Mismatch examples:\s*([^\r\n]+)$/gm)];
  if (matches.length !== 1) return {ok:false,reason:'MISSING_OR_AMBIGUOUS_EXAMPLES',ids:[]};
  const parts = matches[0][1].split(/,\s*/).map(x=>x.trim());
  if (!parts.length || parts.length > 100 || parts.some(x=>!x)) return {ok:false,reason:'INVALID_EXAMPLES',ids:[]};
  const ids = new Set();
  for (const part of parts) {
    // MISSING LINE/EXTRA LINE are mismatched keys, not evidence of deleted transactions.
    const match = /^(?:HEADER|LINE|EXTRA LINE|MISSING LINE)\s+([1-9]\d{0,14})(?::[1-9]\d*)?$/.exec(part);
    if (!match) return {ok:false,reason:`UNRECOGNIZED_EXAMPLE:${part}`,ids:[]};
    ids.add(match[1]);
  }
  if (!ids.size || ids.size > maxIds) return {ok:false,reason:'TOO_MANY_IDS',ids:[]};
  return {ok:true,reason:'PARSED',ids:[...ids]};
}
