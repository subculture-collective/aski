import { useMemo } from 'react';
import { blockRects } from '../shared/cells.ts';
import type { ColorRun } from '../shared/color.ts';
import type { Colors } from '../shared/recipe.ts';
// Block characters drawn as rectangles on whole-pixel cells, so neighbours meet without seams.
export function Seamless({ runs, colors, columns, rows }: { runs: ColorRun[]; colors: Colors; columns: number; rows: number }) {
  const rects = useMemo(() => blockRects(runs, colors), [runs, colors]);
  const width = columns * 8, height = rows * 16;
  return <div className="seamless" data-testid="seamless">
    <svg role="img" aria-label="Seamless block preview" width={width} height={height} viewBox={`0 0 ${width} ${height}`} shapeRendering="crispEdges">
      <rect width={width} height={height} fill={colors.background} />
      {rects.map((rect, index) => <rect key={index} x={rect.x} y={rect.y} width={rect.width} height={rect.height} fill={rect.fill} fillOpacity={rect.opacity === 1 ? undefined : rect.opacity} />)}
    </svg>
  </div>;
}
