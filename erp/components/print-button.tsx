'use client';

import { Button } from './ui';

/** Друк засобами браузера: PDF він зробить сам, окрема бібліотека тут зайва. */
export function PrintButton({ label = 'Друк' }: { label?: string }) {
  return (
    <Button type="button" onClick={() => window.print()}>
      {label}
    </Button>
  );
}
