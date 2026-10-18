import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';

export const alt = 'Domino: some pills are treating other pills. AI agents on a FalkorDB graph find prescribing cascades.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const TILES = [
  { name: 'Amlodipine', sub: 'blood pressure', pips: 1 },
  { name: 'Furosemide', sub: 'for the swelling', pips: 2 },
  { name: 'Oxybutynin', sub: 'for the bladder', pips: 3 },
  { name: 'Donepezil', sub: 'for the memory', pips: 4 },
];

export default async function OpengraphImage() {
  const font = (f: string) => readFile(join(process.cwd(), 'src/assets/fonts', f));
  const [serif, serifItalic, sans, sansBold] = await Promise.all([
    font('Fraunces-SemiBold.ttf'),
    font('Fraunces-SemiBoldItalic.ttf'),
    font('Geist-Regular.ttf'),
    font('Geist-SemiBold.ttf'),
  ]);
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '64px 72px',
        background:
          'radial-gradient(900px 500px at 90% -10%, rgba(255,91,58,0.22), transparent 60%), radial-gradient(700px 420px at -10% 110%, rgba(165,150,255,0.14), transparent 60%), #0d0c10',
        color: '#f4efe4',
        fontFamily: 'Geist',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 26, fontFamily: 'Geist', letterSpacing: 0 }}>
        <div style={{ width: 22, height: 32, borderRadius: 5, background: '#f4efe4', transform: 'rotate(-14deg)' }} />
        <span style={{ fontFamily: 'Fraunces', fontSize: 34 }}>Domino</span>
        <span style={{ color: '#a39e93', fontSize: 20 }}>· agents on a FalkorDB graph</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', fontSize: 92, lineHeight: 1.0, letterSpacing: -2.5, fontFamily: 'Fraunces' }}>
        <span>Some pills are</span>
        <span style={{ display: 'flex', gap: 22 }}>
          treating <span style={{ color: '#ff5b3a', fontStyle: 'italic', fontFamily: 'Fraunces' }}>other pills.</span>
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        {TILES.map((t, i) => (
          <div key={t.name} style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            <div
              style={{
                width: 132,
                height: 150,
                borderRadius: 14,
                background: 'linear-gradient(180deg,#fbf8f1,#ece5d6)',
                color: '#17151a',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                padding: '16px 10px 10px',
                boxShadow: i === 0 ? '0 0 0 3px #ff5b3a' : 'none',
                fontFamily: 'Geist',
              }}
            >
              <span style={{ fontSize: 20, fontFamily: 'Fraunces' }}>{t.name}</span>
              <span style={{ fontSize: 13, color: '#6f6b64', marginTop: 2 }}>{t.sub}</span>
              <div style={{ width: 100, height: 2, background: '#17151a', marginTop: 14 }} />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, width: 70, justifyContent: 'center', marginTop: 14 }}>
                {Array.from({ length: t.pips }, (_, k) => (
                  <div key={k} style={{ width: 11, height: 11, borderRadius: 11, background: i === 0 ? '#ff5b3a' : '#17151a' }} />
                ))}
              </div>
            </div>
            {i < TILES.length - 1 && <span style={{ color: '#ff5b3a', fontSize: 34 }}>→</span>}
          </div>
        ))}
        <div style={{ display: 'flex', flexDirection: 'column', marginLeft: 36, fontFamily: 'Geist', fontSize: 22, color: '#d9d3c6', gap: 8 }}>
          <span style={{ display: 'flex', gap: 10 }}>
            <span style={{ color: '#f4efe4', fontWeight: 600 }}>9 → 4</span>
            <span>medicines</span>
          </span>
          <span style={{ display: 'flex', gap: 10 }}>
            <span style={{ color: '#f4efe4', fontWeight: 600 }}>4 → 0</span>
            <span>anticholinergic burden</span>
          </span>
          <span style={{ color: '#a39e93', fontSize: 18 }}>Graph Hacks 2026 · synthetic data</span>
        </div>
      </div>
    </div>,
    {
      ...size,
      fonts: [
        { name: 'Fraunces', data: serif, style: 'normal', weight: 600 },
        { name: 'Fraunces', data: serifItalic, style: 'italic', weight: 600 },
        { name: 'Geist', data: sans, style: 'normal', weight: 400 },
        { name: 'Geist', data: sansBold, style: 'normal', weight: 600 },
      ],
    },
  );
}
