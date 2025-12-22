'use client';

import React from 'react';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

export type AspectRatio = '9:16' | '16:9' | '1:1';

export type AspectRatioSelectProps = {
  value: AspectRatio;
  onChange: (next: AspectRatio) => void;
  label?: string;
  className?: string;
};

export default function AspectRatioSelect({
  value,
  onChange,
  label = 'Aspect Ratio',
  className,
}: AspectRatioSelectProps) {
  return (
    <div className={cn('space-y-2', className)}>
      <Label>{label}</Label>
      <Select value={value} onValueChange={(v) => onChange(v as AspectRatio)}>
        <SelectTrigger>
          <SelectValue placeholder="Select aspect ratio" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="9:16">9:16 (Portrait)</SelectItem>
          <SelectItem value="16:9">16:9 (Landscape)</SelectItem>
          <SelectItem value="1:1">1:1 (Square)</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
