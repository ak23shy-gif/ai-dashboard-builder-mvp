'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, Lightbulb } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

type TextBoxCardProps = {
  title: string;
  content: string;
};

export function TextBoxCard({ title, content }: TextBoxCardProps) {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <Card className="min-w-0 border-slate-200/80 shadow-none transition hover:border-primary/25 hover:shadow-md">
      <CardHeader className="border-b border-slate-100 pb-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Lightbulb className="h-4 w-4" />
          </div>
          <CardTitle className="truncate">{title}</CardTitle>
        </div>
        <Button className="h-8 w-8 shrink-0" onClick={() => setIsOpen((current) => !current)} size="icon" variant="ghost" title={isOpen ? 'Minimise' : 'Maximise'}>
          {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
      </CardHeader>
      {isOpen && (
        <CardContent className="p-5">
          <p className="whitespace-pre-line text-sm leading-7 text-muted-foreground">{content}</p>
        </CardContent>
      )}
    </Card>
  );
}
