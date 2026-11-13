// 赛程魔方 · 魔方 Logo（3×3 魔方脸，八面配色 + 青色中心）
import { cn } from '@/lib/utils';

const TILES = [
  'var(--cube-1)', 'var(--cube-2)', 'var(--cube-3)',
  'var(--cube-4)', 'var(--site-accent)', 'var(--cube-5)',
  'var(--cube-6)', 'var(--cube-7)', 'var(--cube-8)',
];

export function CubeLogo({ size = 32, className }: { size?: number; className?: string }) {
  const tile = 13;
  const gap = 2.5;
  const pad = 2;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      className={cn('shrink-0', className)}
      role="img"
      aria-label="赛程魔方"
    >
      <rect x="0.5" y="0.5" width="47" height="47" rx="10" fill="#0d1322" stroke="var(--site-border)" />
      {TILES.map((color, i) => {
        const row = Math.floor(i / 3);
        const col = i % 3;
        const x = pad + col * (tile + gap);
        const y = pad + row * (tile + gap);
        return <rect key={i} x={x} y={y} width={tile} height={tile} rx="3" fill={color} />;
      })}
    </svg>
  );
}