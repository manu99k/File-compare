// Standard Code 39 (ISO/IEC 16388) bar/space encoding: 9 elements (5 bars, 4 spaces)
// 'n' = narrow (1u), 'w' = wide (2.5u)
const CODE39_TABLE: Record<string, string> = {
  '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn',
  '4': 'nnnwwnnnw', '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw',
  '8': 'wnnwnnwnn', '9': 'nnwwnnwnn', 'A': 'wnnnnwnnw', 'B': 'nnwnnwnnw',
  'C': 'wnwnnwnnn', 'D': 'nnnnwwnnw', 'E': 'wnnnwwnnn', 'F': 'nnwnwwnnn',
  'G': 'nnnnnwwnw', 'H': 'wnnnnwwnn', 'I': 'nnwnnwwnn', 'J': 'nnnnwwwnn',
  'K': 'wnnnnnnww', 'L': 'nnwnnnnww', 'M': 'wnwnnnnwn', 'N': 'nnnnwnnww',
  'O': 'wnnnwnnwn', 'P': 'nnwnwnnwn', 'Q': 'nnnnnnwww', 'R': 'wnnnnnwwn',
  'S': 'nnwnnnwwn', 'T': 'nnnnwnwwn', 'U': 'wwnnnnnnw', 'V': 'nwwnnnnnw',
  'W': 'wwwnnnnnn', 'X': 'nwnnwnnnw', 'Y': 'wwnnwnnnn', 'Z': 'nwwnwnnnn',
  '-': 'nwnnnnwnw', '.': 'wwnnnnwnn', ' ': 'nwwnnnwnn', '$': 'nwnwnwnnn',
  '/': 'nwnwnnnwn', '+': 'nwnnnwnwn', '%': 'nnnwnwnwn', '*': 'nwnnwnwnn',
};

export interface BarcodeBarRect {
  x: number;
  w: number;
}

/**
 * Generates normalized x/w bar positions in [0..1] for Code 39 strings.
 */
export function encodeCode39Bars(rawValue: string): BarcodeBarRect[] {
  const cleaned = rawValue.toUpperCase().replace(/[^0-9A-Z\-. $/+%*]/g, '');
  const wrapped = cleaned.startsWith('*') && cleaned.endsWith('*') && cleaned.length >= 2
    ? cleaned
    : `*${cleaned || '000000'}*`;

  const bars: BarcodeBarRect[] = [];
  let cursor = 0;

  for (let i = 0; i < wrapped.length; i++) {
    const ch = wrapped[i];
    const pat = CODE39_TABLE[ch] || CODE39_TABLE['0'];
    for (let j = 0; j < 9; j++) {
      const unitW = pat[j] === 'w' ? 2.4 : 1.0;
      if (j % 2 === 0) {
        bars.push({ x: cursor, w: unitW });
      }
      cursor += unitW;
    }
    if (i < wrapped.length - 1) {
      cursor += 1.0; // inter-character narrow gap
    }
  }

  const total = Math.max(1, cursor);
  return bars.map((b) => ({ x: b.x / total, w: b.w / total }));
}
