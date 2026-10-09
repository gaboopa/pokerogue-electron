export function dialogSize(height, corrections = 0, overflowing = false) {
  if (overflowing && corrections >= 2) return null;
  return { height: Math.ceil(height), corrections: corrections + Number(overflowing) };
}
